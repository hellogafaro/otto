import { AuthSessionId, BotId, type RoutineListQuery } from "@otto/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import type { ServerSecretStore } from "../auth/server-secret-store.ts";
import { SqlitePersistenceMemory } from "../persistence/layers/sqlite.ts";
import { RoutineRepository } from "./repository.ts";
import { RoutineRepositoryLive } from "./repository-live.ts";
import { listRoutines } from "./routine-list.ts";

const secret = new Uint8Array(32).fill(7);

const secretStore: Pick<ServerSecretStore["Service"], "getOrCreateRandom"> = {
  getOrCreateRandom: () => Effect.succeed(secret),
};

const ada = AuthSessionId.make("ada");

const grace = AuthSessionId.make("grace");

const seed = (
  id: string,
  fields: {
    readonly updatedAt: string;
    readonly approved?: boolean;
    readonly enabled?: boolean;
    readonly lifecycle?: string;
    readonly bot?: string;
    readonly job?: string;
    readonly nextRunAt?: string;
    readonly lastRunAt?: string;
    readonly createdBy?: AuthSessionId;
    readonly visibility?: "user" | "organization";
    readonly deletedAt?: string;
  },
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
      INSERT INTO projection_routines (
        routine_id, bot_id, target_thread_id, project_id, job, procedure, procedure_version,
        approval_version, schedule_json, timezone, sandbox, approval_policy, enabled, lifecycle,
        next_run_at, last_run_at, created_by, visibility, created_at, updated_at, deleted_at
      ) VALUES (
        ${id}, ${fields.bot ?? "nova"}, 'thread-1', 'project-1', ${fields.job ?? id},
        'Write a note', 2, ${fields.approved === false ? 1 : 2}, '{"kind":"daily","time":"09:00"}',
        'UTC', 'local', 'approval-required', ${fields.enabled === false ? 0 : 1},
        ${fields.lifecycle ?? "enabled"}, ${fields.nextRunAt ?? null}, ${fields.lastRunAt ?? null},
        ${fields.createdBy ?? null},
        ${fields.visibility ?? "organization"}, ${fields.updatedAt}, ${fields.updatedAt},
        ${fields.deletedAt ?? null}
      )
    `;
  });

const list = (query: RoutineListQuery, viewer = ada) =>
  Effect.gen(function* () {
    const routineRepository = yield* RoutineRepository;

    return yield* listRoutines(query, viewer, { routineRepository, secretStore });
  });

const ids = (result: { readonly routines: ReadonlyArray<{ readonly id: string }> }) =>
  result.routines.map((routine) => routine.id);

const layer = it.layer(RoutineRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)));

layer("listRoutines", (it) => {
  it.effect("filters, orders and pages in SQL", () =>
    Effect.gen(function* () {
      yield* seed("a", {
        updatedAt: "2026-10-01T00:00:00.000Z",
        nextRunAt: "2026-10-20T09:00:00.000Z",
        job: "Weekly report",
      });
      yield* seed("b", {
        updatedAt: "2026-10-02T00:00:00.000Z",
        approved: false,
        lifecycle: "draft",
        bot: "scout",
      });
      yield* seed("c", {
        updatedAt: "2026-10-03T00:00:00.000Z",
        enabled: false,
        lifecycle: "paused",
        job: "alpha check",
      });
      yield* seed("d", {
        updatedAt: "2026-10-04T00:00:00.000Z",
        lifecycle: "failed",
        nextRunAt: "2026-10-19T09:00:00.000Z",
      });
      yield* seed("e", {
        updatedAt: "2026-10-05T00:00:00.000Z",
        nextRunAt: "2026-10-21T09:00:00.000Z",
      });
      yield* seed("gone", {
        updatedAt: "2026-10-06T00:00:00.000Z",
        lifecycle: "deleted",
        deletedAt: "2026-10-06T00:00:00.000Z",
      });

      const all = yield* list({});
      assert.deepStrictEqual(ids(all), ["e", "a", "b", "c", "d"]);
      assert.strictEqual(all.nextCursor, null);
      assert.deepStrictEqual(
        all.statusCounts.toSorted((left, right) => left.status.localeCompare(right.status)),
        [
          { status: "active", count: 2 },
          { status: "draft", count: 1 },
          { status: "failed", count: 1 },
          { status: "paused", count: 1 },
        ],
      );

      assert.deepStrictEqual(ids(yield* list({ status: ["draft"] })), ["b"]);
      assert.deepStrictEqual(ids(yield* list({ status: ["paused", "failed"] })), ["c", "d"]);
      assert.deepStrictEqual(ids(yield* list({ bot: BotId.make("scout") })), ["b"]);
      assert.deepStrictEqual(ids(yield* list({ sort: "next" })), ["d", "a", "e", "b", "c"]);
      assert.deepStrictEqual(ids(yield* list({ sort: "next", order: "desc" })), [
        "e",
        "a",
        "d",
        "c",
        "b",
      ]);
      assert.deepStrictEqual(ids(yield* list({ sort: "updated" })), ["e", "d", "c", "b", "a"]);
      assert.deepStrictEqual(ids(yield* list({ sort: "created", order: "asc" })), [
        "a",
        "b",
        "c",
        "d",
        "e",
      ]);
      assert.deepStrictEqual(ids(yield* list({ sort: "title" })), ["c", "b", "d", "e", "a"]);

      const pages: string[][] = [];
      let cursor: string | undefined;

      do {
        const page = yield* list({ limit: 2, ...(cursor ? { cursor } : {}) });
        pages.push(ids(page));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);

      assert.deepStrictEqual(pages, [["e", "a"], ["b", "c"], ["d"]]);
    }),
  );

  it.effect("keeps a private routine to the person who set it up", () =>
    Effect.gen(function* () {
      yield* seed("mine", {
        updatedAt: "2026-10-08T00:00:00.000Z",
        createdBy: ada,
        visibility: "user",
      });
      yield* seed("shared", { updatedAt: "2026-10-07T00:00:00.000Z", createdBy: grace });

      const forAda = yield* list({ sort: "updated", limit: 1 });
      assert.deepStrictEqual(ids(forAda), ["mine"]);

      const forGrace = yield* list({ sort: "updated" }, grace);
      assert.notInclude(ids(forGrace), "mine");
      assert.include(ids(forGrace), "shared");
      assert.strictEqual(
        forGrace.statusCounts.reduce((total, entry) => total + entry.count, 0),
        ids(forGrace).length,
      );

      const replayed = yield* Effect.flip(
        list({ sort: "updated", limit: 1, cursor: forAda.nextCursor! }, grace),
      );

      assert.strictEqual(replayed._tag, "RoutineListError");
    }),
  );

  it.effect("refuses a cursor from another view or a forged one", () =>
    Effect.gen(function* () {
      const first = yield* list({ sort: "updated", limit: 1 });
      const cursor = first.nextCursor;
      assert.isNotNull(cursor);

      const otherView = yield* Effect.flip(list({ sort: "title", limit: 1, cursor: cursor! }));
      assert.strictEqual(otherView._tag, "RoutineListError");

      const forged = yield* Effect.flip(
        list({ sort: "updated", limit: 1, cursor: "x".repeat(60) }),
      );

      assert.strictEqual(forged._tag, "RoutineListError");
    }),
  );

  it.effect("finds by title and by when a routine runs, only among what the viewer sees", () =>
    Effect.gen(function* () {
      const updatedAt = "2026-10-09T00:00:00.000Z";
      yield* seed("standup", {
        updatedAt,
        job: "Send Standup notes",
        nextRunAt: "2026-10-18T20:00:00.000Z",
      });
      yield* seed("standup-private", {
        updatedAt,
        job: "Standup for Grace",
        createdBy: grace,
        visibility: "user",
        nextRunAt: "2026-10-18T07:00:00.000Z",
      });
      yield* seed("ran-today", {
        updatedAt,
        job: "Inbox sweep",
        nextRunAt: "2026-10-19T08:00:00.000Z",
        lastRunAt: "2026-10-18T08:00:00.000Z",
      });
      yield* seed("tomorrow", {
        updatedAt,
        job: "Morning standup",
        nextRunAt: "2026-10-19T00:00:00.000Z",
      });

      assert.deepStrictEqual(ids(yield* list({ search: "standup", sort: "title" })), [
        "tomorrow",
        "standup",
      ]);
      assert.deepStrictEqual(ids(yield* list({ search: "standup", sort: "title" }, grace)), [
        "tomorrow",
        "standup",
        "standup-private",
      ]);

      const today = { runFrom: "2026-10-18T00:00:00.000Z", runTo: "2026-10-19T00:00:00.000Z" };
      assert.deepStrictEqual(ids(yield* list({ ...today, sort: "next" })), [
        "standup",
        "ran-today",
      ]);
      assert.deepStrictEqual(ids(yield* list({ ...today, sort: "next" }, grace)), [
        "standup-private",
        "standup",
        "ran-today",
      ]);

      const first = yield* list({ ...today, sort: "next", limit: 1 });

      const otherDay = yield* Effect.flip(
        list({ runFrom: today.runTo, sort: "next", limit: 1, cursor: first.nextCursor! }),
      );

      assert.strictEqual(otherDay._tag, "RoutineListError");
    }),
  );
});
