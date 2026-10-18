import { AuthSessionId, RoutineId, ThreadId } from "@otto/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../persistence/layers/sqlite.ts";
import { RoutineRepository } from "./repository.ts";
import { RoutineRepositoryLive } from "./repository-live.ts";
import { getRoutine, listThreadRoutineRuns } from "./routine-reads.ts";

const ada = AuthSessionId.make("ada");

const grace = AuthSessionId.make("grace");

const chat = ThreadId.make("chat-1");

const seed = (
  id: string,
  fields: {
    readonly createdBy?: AuthSessionId;
    readonly visibility?: "user" | "organization";
    readonly deleted?: boolean;
    readonly targetThreadId?: string;
  } = {},
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const deletedAt = fields.deleted ? "2026-10-02T00:00:00.000Z" : null;

    yield* sql`
      INSERT INTO projection_routines (
        routine_id, bot_id, target_thread_id, project_id, job, procedure, procedure_version,
        approval_version, schedule_json, timezone, sandbox, approval_policy, enabled, lifecycle,
        created_by, visibility, created_at, updated_at, deleted_at
      ) VALUES (
        ${id}, 'nova', ${fields.targetThreadId ?? chat}, 'project-1', ${`Job ${id}`}, 'Write a note',
        1, 1, '{"kind":"daily","time":"09:00"}', 'UTC', 'local', 'approval-required', 1,
        ${fields.deleted ? "deleted" : "enabled"}, ${fields.createdBy ?? null},
        ${fields.visibility ?? "organization"}, '2026-10-01T00:00:00.000Z',
        '2026-10-01T00:00:00.000Z', ${deletedAt}
      )
    `;
    yield* sql`
      INSERT INTO projection_routine_runs (
        run_id, routine_id, procedure_version, trigger, status, started_at, created_at, updated_at
      ) VALUES (
        ${`${id}-run`}, ${id}, 1, 'manual', 'completed', '2026-10-01T09:00:00.000Z',
        '2026-10-01T09:00:00.000Z', '2026-10-01T09:00:00.000Z'
      )
    `;
  });

const get = (id: string, viewer = ada) =>
  Effect.gen(function* () {
    const routineRepository = yield* RoutineRepository;

    return yield* getRoutine({ routineId: RoutineId.make(id) }, viewer, routineRepository);
  });

const layer = it.layer(RoutineRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)));

layer("getRoutine", (it) => {
  it.effect("reads a routine only for someone who may see it", () =>
    Effect.gen(function* () {
      yield* seed("shared");
      yield* seed("ada-private", { createdBy: ada, visibility: "user" });
      yield* seed("grace-private", { createdBy: grace, visibility: "user" });
      yield* seed("legacy-private", { visibility: "user" });
      yield* seed("removed", { deleted: true });

      assert.strictEqual((yield* get("shared"))?.id, "shared");
      assert.strictEqual((yield* get("ada-private"))?.id, "ada-private");
      assert.strictEqual((yield* get("legacy-private"))?.id, "legacy-private");
      assert.isNull(yield* get("ada-private", grace));
      assert.strictEqual((yield* get("grace-private", grace))?.id, "grace-private");
      assert.isNull(yield* get("grace-private"));
      assert.isNull(yield* get("removed"));
      assert.isNull(yield* get("missing"));
    }),
  );
});

layer("listThreadRoutineRuns", (it) => {
  it.effect("leaves another person's private routine and its runs out of a chat's notes", () =>
    Effect.gen(function* () {
      yield* seed("thread-shared");
      yield* seed("thread-grace-private", { createdBy: grace, visibility: "user" });
      yield* seed("thread-removed", { deleted: true, createdBy: grace, visibility: "user" });
      yield* seed("thread-elsewhere", { targetThreadId: "chat-2" });

      const routineRepository = yield* RoutineRepository;

      const forAda = yield* listThreadRoutineRuns({ threadId: chat }, ada, routineRepository);
      assert.deepStrictEqual(
        forAda.routines.map((routine) => routine.id),
        ["thread-shared"],
      );
      assert.deepStrictEqual(
        forAda.receiptSources.map((source) => source.id),
        ["thread-removed"],
      );
      assert.deepStrictEqual(forAda.runs.map((run) => run.id).toSorted(), [
        "thread-removed-run",
        "thread-shared-run",
      ]);
      assert.strictEqual(forAda.nextCursor, null);

      const forGrace = yield* listThreadRoutineRuns({ threadId: chat }, grace, routineRepository);
      assert.deepStrictEqual(forGrace.routines.map((routine) => routine.id).toSorted(), [
        "thread-grace-private",
        "thread-shared",
      ]);
      assert.deepStrictEqual(forGrace.runs.map((run) => run.id).toSorted(), [
        "thread-grace-private-run",
        "thread-removed-run",
        "thread-shared-run",
      ]);
    }),
  );
});
