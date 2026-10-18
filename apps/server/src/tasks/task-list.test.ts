import {
  AuthSessionId,
  BotId,
  ProjectId,
  TaskId,
  type TaskListQuery,
  type WorkStatus,
} from "@otto/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { ServerSecretStore } from "../auth/server-secret-store.ts";
import { ProjectionTaskRepositoryLive } from "../persistence/layers/projection-tasks.ts";
import { SqlitePersistenceMemory } from "../persistence/layers/sqlite.ts";
import { ProjectionTaskRepository } from "../persistence/services/projection-tasks.ts";
import { listTasks } from "./task-list.ts";

const secret = new Uint8Array(32).fill(7);

const secretStore: Pick<ServerSecretStore["Service"], "getOrCreateRandom"> = {
  getOrCreateRandom: () => Effect.succeed(secret),
};

const ada = { kind: "person" as const, personId: AuthSessionId.make("ada"), displayName: "Ada" };

const nova = { kind: "bot" as const, botId: BotId.make("nova") };

const seed = (
  id: string,
  fields: {
    readonly status: WorkStatus;
    readonly updatedAt: string;
    readonly project?: string;
    readonly dueDate?: string;
    readonly owner?: typeof ada | typeof nova;
    readonly assignees?: ReadonlyArray<typeof ada | typeof nova>;
    readonly title?: string;
  },
) =>
  Effect.gen(function* () {
    const tasks = yield* ProjectionTaskRepository;

    yield* tasks.upsert({
      id: TaskId.make(id),
      projectId: ProjectId.make(fields.project ?? "launch"),
      title: fields.title ?? id,
      description: "",
      owner: fields.owner ?? null,
      assignees: fields.assignees ?? [],
      resources: [],
      dueDate: fields.dueDate ?? null,
      status: fields.status,
      timeEntries: [],
      createdAt: fields.updatedAt,
      updatedAt: fields.updatedAt,
    });
  });

const list = (query: TaskListQuery) =>
  Effect.gen(function* () {
    const projectionTasks = yield* ProjectionTaskRepository;

    return yield* listTasks(query, { projectionTasks, secretStore });
  });

const ids = (result: { readonly tasks: ReadonlyArray<{ readonly id: string }> }) =>
  result.tasks.map((task) => task.id);

const layer = it.layer(
  ProjectionTaskRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("listTasks", (it) => {
  it.effect("filters, orders and pages in SQL", () =>
    Effect.gen(function* () {
      yield* seed("a", {
        status: "pending",
        updatedAt: "2026-10-01T00:00:00.000Z",
        dueDate: "2026-10-20",
        owner: ada,
      });
      yield* seed("b", {
        status: "in_progress",
        updatedAt: "2026-10-02T00:00:00.000Z",
        assignees: [nova],
      });
      yield* seed("c", {
        status: "in_progress",
        updatedAt: "2026-10-03T00:00:00.000Z",
        dueDate: "2026-10-10",
        project: "ops",
        title: "Alpha",
      });
      yield* seed("d", {
        status: "completed",
        updatedAt: "2026-10-04T00:00:00.000Z",
        owner: nova,
        assignees: [ada],
      });
      yield* seed("e", { status: "archived", updatedAt: "2026-10-05T00:00:00.000Z" });

      const all = yield* list({});
      assert.deepStrictEqual(ids(all), ["c", "b", "a", "d"]);
      assert.strictEqual(all.nextCursor, null);
      assert.deepStrictEqual(
        all.statusCounts.toSorted((left, right) => left.status.localeCompare(right.status)),
        [
          { status: "completed", count: 1 },
          { status: "in_progress", count: 2 },
          { status: "pending", count: 1 },
        ],
      );

      assert.deepStrictEqual(ids(yield* list({ status: ["archived"] })), ["e"]);
      assert.deepStrictEqual(ids(yield* list({ owner: "person:ada" })), ["a"]);
      assert.deepStrictEqual(ids(yield* list({ assignee: "person:ada" })), ["d"]);
      assert.deepStrictEqual(ids(yield* list({ assignee: "bot:nova" })), ["b"]);
      assert.deepStrictEqual(ids(yield* list({ project: ProjectId.make("ops") })), ["c"]);
      assert.deepStrictEqual(ids(yield* list({ dueFrom: "2026-10-15" })), ["a"]);
      assert.deepStrictEqual(ids(yield* list({ dueTo: "2026-10-15" })), ["c"]);
      assert.deepStrictEqual(ids(yield* list({ sort: "due" })), ["c", "a", "b", "d"]);
      assert.deepStrictEqual(ids(yield* list({ sort: "due", order: "desc" })), [
        "a",
        "c",
        "d",
        "b",
      ]);
      assert.deepStrictEqual(ids(yield* list({ sort: "updated" })), ["d", "c", "b", "a"]);
      assert.deepStrictEqual(ids(yield* list({ sort: "title" })), ["a", "c", "b", "d"]);

      const pages: string[][] = [];
      let cursor: string | undefined;

      do {
        const page = yield* list({ sort: "status", limit: 1, ...(cursor ? { cursor } : {}) });
        pages.push(ids(page));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);

      assert.deepStrictEqual(pages, [["c"], ["b"], ["a"], ["d"]]);
    }),
  );

  it.effect("refuses a cursor from another view or a forged one", () =>
    Effect.gen(function* () {
      const first = yield* list({ sort: "updated", limit: 1 });
      const cursor = first.nextCursor;
      assert.isNotNull(cursor);

      const otherView = yield* Effect.flip(list({ sort: "title", limit: 1, cursor: cursor! }));
      assert.strictEqual(otherView._tag, "TaskListError");

      const forged = yield* Effect.flip(
        list({ sort: "updated", limit: 1, cursor: "x".repeat(60) }),
      );

      assert.strictEqual(forged._tag, "TaskListError");
    }),
  );
});
