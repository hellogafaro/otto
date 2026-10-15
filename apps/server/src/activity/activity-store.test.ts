import { AuthSessionId, BotId, CommandId, LibraryFileId, ProjectId, TaskId } from "@otto/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerConfig } from "../config.ts";
import { OrchestrationEngineLive } from "../orchestration/layers/orchestration-engine.ts";
import { OrchestrationProjectionPipelineLive } from "../orchestration/layers/projection-pipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../orchestration/layers/projection-snapshot-query.ts";
import { OrchestrationEngineService } from "../orchestration/services/orchestration-engine.ts";
import * as ThreadBackgroundLiveness from "../orchestration/thread-background-liveness.ts";
import * as ThreadPlanProgress from "../orchestration/thread-plan-progress.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../persistence/layers/orchestration-command-receipts.ts";
import { OrchestrationEventStoreLive } from "../persistence/layers/orchestration-event-store.ts";
import { SqlitePersistenceMemory } from "../persistence/layers/sqlite.ts";
import * as RepositoryIdentityResolver from "../project/repository-identity-resolver.ts";
import { ActivityStore, ActivityStoreLive } from "./activity-store.ts";

const projectId = ProjectId.make("activity-project");

const taskId = TaskId.make("activity-task");

const ada = AuthSessionId.make("session-ada");

const bob = AuthSessionId.make("session-bob");

const createdAt = "2026-01-01T00:00:00.000Z";

const task = { entityType: "task" as const, entityId: taskId };

const Infrastructure = Layer.mergeAll(
  OrchestrationProjectionPipelineLive.pipe(Layer.provideMerge(OrchestrationEventStoreLive)),
  OrchestrationProjectionSnapshotQueryLive,
  OrchestrationCommandReceiptRepositoryLive,
  ActivityStoreLive,
).pipe(
  Layer.provide(ThreadBackgroundLiveness.layer),
  Layer.provide(ThreadPlanProgress.layer),
  Layer.provide(RepositoryIdentityResolver.layer),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "otto-activity-test-" })),
  Layer.provideMerge(NodeServices.layer),
);

const TestLayer = OrchestrationEngineLive.pipe(Layer.provideMerge(Infrastructure));

type Command = Parameters<OrchestrationEngineService["Service"]["dispatch"]>[0];

const dispatch = (command: Command) =>
  Effect.flatMap(Effect.service(OrchestrationEngineService), (engine) =>
    engine.dispatch(command, { actor: { personId: ada, canManageGroups: false } }),
  );

const entries = Effect.flatMap(Effect.service(ActivityStore), (store) => store.list(task)).pipe(
  Effect.map((result) => result.entries),
);

/** A project with one task Ada created, in a fresh database. */
const withTask = <A, E, R>(test: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    yield* dispatch({
      type: "project.create",
      commandId: CommandId.make("activity-project-create"),
      projectId,
      title: "Launch",
      workspaceRoot: "/tmp/otto-activity",
      createdAt,
    });

    yield* dispatch({
      type: "task.create",
      commandId: CommandId.make("activity-task-create"),
      taskId,
      projectId,
      title: "Write the launch post",
      createdAt,
    });

    return yield* test;
  }).pipe(Effect.provide(TestLayer));

it.live("records who created a task and what each update changed", () =>
  withTask(
    Effect.gen(function* () {
      yield* dispatch({
        type: "task.update",
        commandId: CommandId.make("activity-task-status"),
        taskId,
        status: "in_progress",
        description: "A long draft",
      });

      yield* dispatch({
        type: "task.update",
        commandId: CommandId.make("activity-task-same-status"),
        taskId,
        status: "in_progress",
      });

      expect(yield* entries).toEqual([
        expect.objectContaining({ type: "created", actor: { type: "person", id: ada } }),
        expect.objectContaining({
          type: "changed",
          actor: { type: "person", id: ada },
          changes: { status: { from: "backlog", to: "in_progress" }, description: true },
        }),
      ]);
    }),
  ),
);

it.live("shows logged time until its entry is removed", () =>
  withTask(
    Effect.gen(function* () {
      yield* dispatch({
        type: "task.time.add",
        commandId: CommandId.make("activity-time-add"),
        taskId,
        entryId: "entry-1",
        duration: 30 * 60_000,
        description: "Outline",
        createdAt: "2026-01-02T00:00:00.000Z",
      });

      expect((yield* entries).at(-1)).toMatchObject({
        type: "time_logged",
        actor: { type: "person", id: ada },
        duration: 30 * 60_000,
        description: "Outline",
      });

      yield* dispatch({
        type: "task.time.remove",
        commandId: CommandId.make("activity-time-remove"),
        taskId,
        entryId: "entry-1",
      });

      expect((yield* entries).map((entry) => entry.type)).toEqual(["created"]);
    }),
  ),
);

/** Posts a comment the way the activity RPC and bot tools do: as a task event. */
const comment = (input: {
  readonly id: string;
  readonly entityId?: string;
  readonly content: string;
  readonly fileIds?: ReadonlyArray<LibraryFileId>;
  readonly by?: { readonly type: "bot"; readonly id: BotId };
}) =>
  Effect.flatMap(Effect.service(OrchestrationEngineService), (engine) =>
    engine.dispatch(
      {
        type: "task.comment.add",
        commandId: CommandId.make(`comment:${input.id}`),
        taskId: TaskId.make(input.entityId ?? taskId),
        commentId: input.id,
        content: input.content,
        fileIds: [...(input.fileIds ?? [])],
        by: input.by ?? { type: "person", id: ada },
        createdAt: "2026-01-03T00:00:00.000Z",
      },
      input.by ? {} : { actor: { personId: ada, canManageGroups: false } },
    ),
  );

it.live("lets only a comment's author delete it", () =>
  withTask(
    Effect.gen(function* () {
      const store = yield* Effect.service(ActivityStore);

      yield* comment({
        id: "comment-1",
        content: 'Ask <mention type="person" id="session-bob">Bob</mention> to review',
        fileIds: [LibraryFileId.make("file-1")],
      });

      expect(yield* store.getComment("comment-1")).toMatchObject({
        type: "comment",
        actor: { type: "person", id: ada },
        fileIds: ["file-1"],
      });

      const cannotDelete = yield* Effect.flip(
        store.removeComment({ id: "comment-1", personId: bob }),
      );

      expect(cannotDelete.message).toBe("Only the person who wrote this comment can change it.");

      yield* store.removeComment({ id: "comment-1", personId: ada });

      expect((yield* entries).map((entry) => entry.type)).toEqual(["created"]);
    }),
  ),
);

it.live("records a bot's comment as the bot, and a person's as the signed-in person", () =>
  withTask(
    Effect.gen(function* () {
      const nova = BotId.make("bot-nova");

      yield* comment({ id: "from-bot", content: "Started on it.", by: { type: "bot", id: nova } });

      expect((yield* entries).at(-1)).toMatchObject({
        type: "comment",
        actor: { type: "bot", id: nova },
        content: "Started on it.",
      });
    }),
  ),
);

it.live("refuses empty comments and comments on a task that doesn't exist", () =>
  withTask(
    Effect.gen(function* () {
      const empty = yield* Effect.flip(comment({ id: "empty", content: "" }));

      expect(empty.message).toContain("A comment needs text or a file.");

      const missing = yield* Effect.flip(
        comment({ id: "missing", entityId: "missing-task", content: "Hello" }),
      );

      expect(missing.message).toContain("missing-task");
    }),
  ),
);
