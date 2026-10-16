import { AuthSessionId, BotId, CommandId, ProjectId, TaskId, ThreadId } from "@otto/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ActivityStoreLive } from "../activity/activity-store.ts";
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
import { makeTaskToolRuntime } from "./task-tool-runtime.ts";

const projectId = ProjectId.make("tools-project");

const nova = BotId.make("bot-nova");

const ada = AuthSessionId.make("user-ada");

const createdAt = "2026-01-01T00:00:00.000Z";

const caller = { threadId: ThreadId.make("thread-nova"), botId: nova };

const listPeople = () =>
  Effect.succeed([{ userId: ada, displayName: "Ada", email: "ada@example.test" }]);

const TestLayer = OrchestrationEngineLive.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      OrchestrationProjectionPipelineLive.pipe(Layer.provideMerge(OrchestrationEventStoreLive)),
      OrchestrationProjectionSnapshotQueryLive,
      OrchestrationCommandReceiptRepositoryLive,
      ActivityStoreLive,
    ).pipe(
      Layer.provide(ThreadBackgroundLiveness.layer),
      Layer.provide(ThreadPlanProgress.layer),
      Layer.provide(RepositoryIdentityResolver.layer),
      Layer.provideMerge(SqlitePersistenceMemory),
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "otto-task-tools-" })),
      Layer.provideMerge(NodeServices.layer),
    ),
  ),
);

/** A project and the bot Nova in a fresh database, then the task tools as Nova. */
const withTools = <A, E, R>(
  test: (tools: Effect.Success<ReturnType<typeof makeTaskToolRuntime>>) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const engine = yield* Effect.service(OrchestrationEngineService);

    yield* engine.dispatch({
      type: "project.create",
      commandId: CommandId.make("tools-project-create"),
      projectId,
      title: "Launch",
      workspaceRoot: "/tmp/otto-task-tools",
      createdAt,
    });

    yield* engine.dispatch({
      type: "bot.create",
      commandId: CommandId.make("tools-bot-create"),
      botId: nova,
      name: "Nova",
      title: "Agent",
      avatar: { kind: "dither", seed: nova },
      engine: null,
      sandbox: "local",
      runtimeMode: "approval-required",
      groupId: null,
      createdAt,
    });

    return yield* test(yield* makeTaskToolRuntime(listPeople));
  }).pipe(Effect.provide(TestLayer));

it.live("creates, finds, updates and comments on a task as the bot", () =>
  withTools((tools) =>
    Effect.gen(function* () {
      const created = yield* tools.create(caller, {
        title: "Draft the launch post",
        projectId,
        assignees: ["me", `person:${ada}`],
        status: "in_progress",
      });

      expect(created).toMatchObject({
        created: true,
        status: "in_progress",
        project: "Launch",
        assignees: [
          { key: `bot:${nova}`, name: "Nova", you: true },
          { key: `person:${ada}`, name: "Ada" },
        ],
      });

      const taskId = TaskId.make((created as { taskId: string }).taskId);
      const mine = yield* tools.list(caller, { assignee: "me" });

      expect(mine).toMatchObject({
        total: 1,
        tasks: [{ taskId }],
        projects: [{ projectId, title: "Launch" }],
        people: [{ key: `person:${ada}`, name: "Ada" }],
      });

      expect(yield* tools.update(caller, { taskId, dueDate: "2026-02-01" })).toMatchObject({
        updated: true,
        dueDate: "2026-02-01",
      });

      expect(yield* tools.comment(caller, { taskId, content: "Done <b>soon</b>" })).toMatchObject({
        commented: true,
      });

      const read = yield* tools.read(caller, { taskId });

      expect(read).toMatchObject({
        activity: [
          { type: "created", by: "Nova" },
          { type: "changed", by: "Nova", changed: ["dueDate"] },
          { type: "comment", by: "Nova", content: "Done &lt;b&gt;soon&lt;/b&gt;" },
        ],
      });
    }),
  ),
);

it.live("leaves completing a task and its owner to people", () =>
  withTools((tools) =>
    Effect.gen(function* () {
      expect(
        yield* tools.create(caller, { title: "Ship it", projectId, status: "completed" }),
      ).toEqual({ error: expect.stringContaining("Only a person can mark a task completed.") });

      const created = yield* tools.create(caller, { title: "Ship it", projectId });
      const taskId = TaskId.make((created as { taskId: string }).taskId);

      expect(yield* tools.update(caller, { taskId, status: "completed" })).toEqual({
        error: expect.stringContaining("Only a person can mark a task completed."),
      });

      expect(yield* tools.update(caller, { taskId, assignees: ["person:stranger"] })).toEqual({
        error: "No one in the organization has the key 'person:stranger'.",
      });

      expect(yield* tools.read(caller, { taskId: TaskId.make("missing") })).toEqual({
        error: "That task doesn't exist.",
      });
    }),
  ),
);
