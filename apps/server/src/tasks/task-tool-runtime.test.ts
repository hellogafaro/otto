import {
  AuthSessionId,
  BotId,
  CommandId,
  LibraryFileId,
  ProjectId,
  TaskId,
  ThreadId,
} from "@otto/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ActivityStore, ActivityStoreLive } from "../activity/activity-store.ts";
import { ServerSecretStore } from "../auth/server-secret-store.ts";
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

const ben = AuthSessionId.make("user-ben");

const listPeople = () =>
  Effect.succeed([
    { userId: ada, displayName: "Ada", email: "ada@example.test", image: null },
    { userId: ben, displayName: "Ben", email: "ben@example.test", image: null },
  ]);

const secret = new Uint8Array(32).fill(7);

const TestSecretStore = Layer.mock(ServerSecretStore)({
  getOrCreateRandom: () => Effect.succeed(secret),
});

const TestLayer = OrchestrationEngineLive.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      OrchestrationProjectionPipelineLive.pipe(Layer.provideMerge(OrchestrationEventStoreLive)),
      OrchestrationProjectionSnapshotQueryLive,
      OrchestrationCommandReceiptRepositoryLive,
      ActivityStoreLive,
      TestSecretStore,
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

    return yield* test(yield* makeTaskToolRuntime({ listPeople, timeZone: () => "Europe/Madrid" }));
  }).pipe(Effect.provide(TestLayer));

/** The id a create returned, or a failure naming the error it returned instead. */
const idOf = (result: { readonly taskId: string } | { readonly error: string }) => {
  if ("error" in result) throw new Error(`Expected a task, got ${result.error}.`);

  return TaskId.make(result.taskId);
};

const week = { today: "2026-02-01", weekEnd: "2026-02-01" };

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

      const taskId = idOf(created);

      expect(yield* tools.search(caller, { terms: [], assignee: "me", ...week })).toMatchObject([
        { taskId },
      ]);

      expect(yield* tools.search(caller, { terms: ["launch"], ...week })).toMatchObject([
        { taskId },
      ]);

      expect(yield* tools.search(caller, { terms: ["invoice"], ...week })).toEqual([]);

      expect(yield* tools.update(caller, { taskId, dueDate: "2026-02-01" })).toMatchObject({
        updated: true,
        dueDate: "2026-02-01",
      });

      expect(yield* tools.search(caller, { terms: [], due: "today", ...week })).toMatchObject([
        { taskId },
      ]);

      expect(
        yield* tools.search(caller, {
          terms: [],
          due: "overdue",
          today: "2026-02-02",
          weekEnd: "2026-02-08",
        }),
      ).toMatchObject([{ taskId }]);

      expect(yield* tools.search(caller, { terms: [], due: "none", ...week })).toEqual([]);

      expect(
        yield* tools.createComment(caller, {
          taskId,
          content: `Done <b>soon</b>, <mention type="person" id="${ada}">whoever</mention> @person:stranger`,
        }),
      ).toMatchObject({ created: true });

      const read = yield* tools.read(caller, { taskId });

      expect(read).toMatchObject({
        commentCount: 1,
        comments: [
          {
            type: "comment",
            by: { key: `bot:${nova}`, name: "Nova" },
            content: `Done <b>soon</b>, <mention type="person" id="${ada}">Ada</mention> @person:stranger`,
          },
        ],
        history: [
          { type: "changed", changes: { dueDate: { from: null, to: "2026-02-01" } } },
          { type: "created", by: { key: `bot:${nova}`, name: "Nova" } },
        ],
        createdBy: { key: `bot:${nova}`, name: "Nova" },
      });
    }),
  ),
);

it.live("sets, finds and clears a priority", () =>
  withTools((tools) =>
    Effect.gen(function* () {
      const taskId = idOf(
        yield* tools.create(caller, { title: "Fix the login", projectId, priority: "high" }),
      );

      expect(yield* tools.update(caller, { taskId, priority: "low" })).toMatchObject({
        priority: "low",
      });

      expect(yield* tools.search(caller, { terms: [], priority: ["low"], ...week })).toMatchObject([
        { taskId, priority: "low" },
      ]);

      expect(yield* tools.search(caller, { terms: [], priority: ["high"], ...week })).toEqual([]);

      expect(yield* tools.update(caller, { taskId, priority: null })).toMatchObject({
        priority: null,
      });
    }),
  ),
);

it.live("completes and reopens a task, and sets a person as its owner", () =>
  withTools((tools) =>
    Effect.gen(function* () {
      const taskId = idOf(yield* tools.create(caller, { title: "Ship it", projectId }));

      const completed = yield* tools.update(caller, {
        taskId,
        status: "completed",
        owner: `person:${ada}`,
      });

      expect(completed).toMatchObject({
        status: "completed",
        owner: { key: `person:${ada}`, name: "Ada" },
        completedBy: { key: `bot:${nova}`, name: "Nova" },
      });
      expect((completed as { completedAt: string | null }).completedAt).not.toBeNull();

      expect(yield* tools.update(caller, { taskId, status: "in_progress" })).toMatchObject({
        status: "in_progress",
        completedAt: null,
        completedBy: null,
      });

      const read = yield* tools.read(caller, { taskId });

      const history = (read as { history: ReadonlyArray<{ changes?: object; by: unknown }> })
        .history;

      expect(history).toContainEqual(
        expect.objectContaining({
          by: { key: `bot:${nova}`, name: "Nova" },
          changes: expect.objectContaining({
            owner: { from: null, to: { kind: "person", personId: ada, displayName: "Ada" } },
          }),
        }),
      );

      expect(yield* tools.update(caller, { taskId, owner: `bot:${nova}` })).toMatchObject({
        error: "invalid_fields",
        fields: [{ field: "owner", reason: `bot:${nova} is a bot; owner must be a person` }],
      });
    }),
  ),
);

it.live(
  "keeps left-out fields, clears null ones, and changes nothing when a field is invalid",
  () =>
    withTools((tools) =>
      Effect.gen(function* () {
        const taskId = idOf(
          yield* tools.create(caller, {
            title: "Plan the offsite",
            projectId,
            dueDate: "2026-03-01",
            description: "Venue and dates",
          }),
        );

        expect(
          yield* tools.update(caller, { taskId, title: "Plan the spring offsite" }),
        ).toMatchObject({ title: "Plan the spring offsite", dueDate: "2026-03-01" });

        expect(
          yield* tools.update(caller, { taskId, dueDate: null, description: null }),
        ).toMatchObject({ dueDate: null });

        expect(yield* tools.read(caller, { taskId })).toMatchObject({ description: "" });

        expect(
          yield* tools.update(caller, {
            taskId,
            title: "Renamed",
            assignees: ["person:stranger"],
            owner: `bot:${nova}`,
          }),
        ).toEqual({
          error: "invalid_fields",
          message: "Nothing changed; fix the fields listed.",
          fields: [
            {
              field: "assignees",
              reason: "no one in the organization has the key person:stranger",
            },
            { field: "owner", reason: `bot:${nova} is a bot; owner must be a person` },
          ],
        });

        expect(yield* tools.read(caller, { taskId })).toMatchObject({
          title: "Plan the spring offsite",
        });

        expect(yield* tools.read(caller, { taskId: TaskId.make("missing") })).toMatchObject({
          error: "not_found",
        });
      }),
    ),
);

it.live("logs, lists and deletes time, keeping each step in the history", () =>
  withTools((tools) =>
    Effect.gen(function* () {
      const first = idOf(yield* tools.create(caller, { title: "E1", projectId }));
      const second = idOf(yield* tools.create(caller, { title: "C11", projectId }));

      const logged = yield* tools.createTime(caller, {
        taskId: first,
        person: `person:${ada}`,
        minutes: 30,
        date: "2026-01-19",
      });

      expect(logged).toMatchObject({
        created: true,
        minutes: 30,
        date: "2026-01-19",
        person: { key: `person:${ada}`, name: "Ada" },
        createdBy: { key: `bot:${nova}`, name: "Nova" },
      });

      expect(
        yield* tools.deleteTime(caller, { entryId: (logged as { entryId: string }).entryId }),
      ).toMatchObject({ deleted: true });

      yield* tools.createTime(caller, {
        taskId: first,
        person: `person:${ada}`,
        minutes: 120,
        date: "2026-01-19",
      });

      yield* tools.createTime(caller, {
        taskId: second,
        person: `person:${ben}`,
        minutes: 30,
        date: "2026-01-19",
      });

      const read = yield* tools.read(caller, { taskId: first });

      expect(read).toMatchObject({ totalMinutes: 120, timeEntries: [{ minutes: 120 }] });
      expect(
        (read as { history: ReadonlyArray<{ type: string; minutes?: number }> }).history
          .filter((entry) => entry.type.startsWith("time_"))
          .map((entry) => [entry.type, entry.minutes]),
      ).toEqual([
        ["time_logged", 120],
        ["time_deleted", 30],
        ["time_logged", 30],
      ]);

      expect(
        yield* tools.listTime(caller, {
          person: `person:${ada}`,
          from: "2026-01-01",
          to: "2026-01-31",
        }),
      ).toMatchObject({ totalMinutes: 120, entries: [{ task: "E1", minutes: 120 }] });

      expect(yield* tools.listTime(caller, { from: "2026-01-19", to: "2026-01-19" })).toMatchObject(
        {
          totalMinutes: 150,
        },
      );

      expect(
        yield* tools.createTime(caller, {
          taskId: first,
          person: `person:${ada}`,
          minutes: 30,
          date: "2999-01-01",
        }),
      ).toMatchObject({ error: "future_date" });

      expect(
        yield* tools.createTime(caller, { taskId: first, person: "me", minutes: 30 }),
      ).toMatchObject({ error: "invalid_fields", fields: [{ field: "person" }] });
    }),
  ),
);

it.live("pages comments, edits its own and deletes anyone's, keeping the earlier text", () =>
  withTools((tools) =>
    Effect.gen(function* () {
      const taskId = idOf(yield* tools.create(caller, { title: "Retro", projectId }));

      for (const content of ["one", "two", "three"]) {
        yield* tools.createComment(caller, { taskId, content });
      }

      const firstPage = yield* tools.listComments(caller, { taskId, limit: 2, order: "oldest" });

      expect(firstPage).toMatchObject({
        commentCount: 3,
        comments: [{ content: "one" }, { content: "two" }],
      });

      const cursor = (firstPage as { cursor?: string }).cursor;
      expect(cursor).toBeDefined();

      const secondPage = yield* tools.listComments(caller, {
        taskId,
        limit: 2,
        order: "oldest",
        ...(cursor ? { cursor } : {}),
      });

      expect(secondPage).toMatchObject({ comments: [{ content: "three" }] });
      expect((secondPage as { cursor?: string }).cursor).toBeUndefined();

      const mine = (firstPage as { comments: ReadonlyArray<{ id: string }> }).comments[0]!.id;

      expect(
        yield* tools.updateComment(caller, { commentId: mine, content: "one, fixed" }),
      ).toMatchObject({ updated: true });

      const engine = yield* Effect.service(OrchestrationEngineService);

      yield* engine.dispatch({
        type: "task.comment.create",
        commandId: CommandId.make("person-comment"),
        taskId,
        commentId: "comment-ada",
        content: "From Ada",
        fileIds: [],
        by: { type: "person", id: ada },
        createdAt: "2026-01-02T00:00:00.000Z",
      });

      expect(
        yield* tools.updateComment(caller, { commentId: "comment-ada", content: "Hijacked" }),
      ).toMatchObject({ error: "not_author" });

      expect(yield* tools.deleteComment(caller, { commentId: "comment-ada" })).toMatchObject({
        deleted: true,
      });

      const read = yield* tools.read(caller, { taskId });

      expect(read).toMatchObject({ commentCount: 3 });
      expect((read as { history: ReadonlyArray<object> }).history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "comment_updated", previousContent: "one" }),
          expect.objectContaining({ type: "comment_deleted", content: "From Ada" }),
        ]),
      );
    }),
  ),
);

it.live("links pages and tasks, refuses unknown ones, and deletes a task for good", () =>
  withTools((tools) =>
    Effect.gen(function* () {
      const other = idOf(yield* tools.create(caller, { title: "Brief", projectId }));

      const taskId = idOf(
        yield* tools.create(caller, {
          title: "Launch",
          projectId,
          resources: [
            { type: "url", url: "https://example.com/spec" },
            { type: "url", url: "https://example.com/spec" },
            { type: "task", linkedTaskId: other },
          ],
        }),
      );

      expect(yield* tools.read(caller, { taskId })).toMatchObject({
        resources: [
          { type: "url", url: "https://example.com/spec", title: "https://example.com/spec" },
          { type: "task", linkedTaskId: other, title: "Brief" },
        ],
      });

      expect(
        yield* tools.update(caller, {
          taskId,
          resources: [{ type: "file", fileId: LibraryFileId.make("file-missing") }],
        }),
      ).toMatchObject({ error: "invalid_fields", fields: [{ field: "resources" }] });

      yield* tools.createComment(caller, { taskId: other, content: "Notes" });
      yield* tools.createTime(caller, {
        taskId: other,
        person: `person:${ada}`,
        minutes: 45,
        date: "2026-01-05",
      });

      expect(yield* tools.delete(caller, { taskId: other })).toEqual({
        deleted: true,
        taskIds: [other],
      });

      expect(yield* tools.read(caller, { taskId: other })).toMatchObject({ error: "not_found" });
      expect(yield* tools.read(caller, { taskId })).toMatchObject({
        resources: [{ type: "url" }],
      });
      expect(yield* tools.listTime(caller, { person: `person:${ada}` })).toMatchObject({
        totalMinutes: 0,
        entries: [],
      });

      const project = yield* (yield* ActivityStore).list({
        entityType: "project",
        entityId: projectId,
      });

      expect(project.entries).toMatchObject([
        { type: "task_deleted", taskId: other, title: "Brief", actor: { type: "bot", id: nova } },
      ]);
    }),
  ),
);

it.live("closes out a batch with no person involved, logging each person's time", () =>
  withTools((tools) =>
    Effect.gen(function* () {
      const batch = [
        { title: "E1", minutes: 30, person: ada },
        { title: "E2", minutes: 30, person: ada },
        { title: "C2", minutes: 120, person: ada },
        { title: "C3", minutes: 30, person: ada },
        { title: "C4", minutes: 30, person: ada },
        { title: "C8", minutes: 120, person: ada },
        { title: "C11", minutes: 30, person: ben },
      ];

      for (const [index, item] of batch.entries()) {
        const taskId = idOf(
          yield* tools.create(caller, {
            title: item.title,
            projectId,
            status: "in_progress",
            dueDate: "2026-01-20",
            ...(index === 0 ? { repeat: "weekly" as const } : {}),
          }),
        );

        expect(yield* tools.update(caller, { taskId, status: "completed" })).toMatchObject({
          status: "completed",
        });
        expect(
          yield* tools.createTime(caller, {
            taskId,
            person: `person:${item.person}`,
            minutes: item.minutes,
            date: "2026-01-20",
          }),
        ).toMatchObject({ created: true });
      }

      const day = { from: "2026-01-20", to: "2026-01-20" };

      expect(yield* tools.listTime(caller, { person: `person:${ada}`, ...day })).toMatchObject({
        totalMinutes: 360,
      });
      expect(yield* tools.listTime(caller, { person: `person:${ben}`, ...day })).toMatchObject({
        totalMinutes: 30,
      });

      const week = { today: "2026-01-20", weekEnd: "2026-01-25" };

      expect(
        yield* tools.search(caller, { terms: ["e1"], status: ["pending"], ...week }),
      ).toMatchObject([{ title: "E1", status: "pending", repeat: "weekly" }]);
    }),
  ),
);
