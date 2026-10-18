import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../migrations.ts";
import * as NodeSqliteClient from "../node-sqlite-client.ts";

const TestLayer = Layer.mergeAll(NodeSqliteClient.layerMemory());

it.layer(TestLayer)("013 routine triggers", (it) => {
  it.effect("keeps every routine run and claim and lets app runs in", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 12 });

      yield* sql`
        INSERT INTO projection_routine_runs (
          run_id, routine_id, procedure_version, trigger, scheduled_for, status, thread_ref,
          result_json, failure_json, usage_ref, started_at, completed_at, created_at, updated_at
        ) VALUES (
          'run-1', 'routine-1', 2, 'scheduled', '2026-08-31T13:00:00.000Z', 'completed',
          'thread-1', '{"summary":"Done."}', NULL, NULL, '2026-08-31T13:00:00.000Z',
          '2026-08-31T13:05:00.000Z', '2026-08-31T13:00:00.000Z', '2026-08-31T13:05:00.000Z'
        )
      `;

      yield* sql`
        INSERT INTO routine_run_claims (
          run_id, routine_id, trigger, scheduled_for, status, thread_id, failure, claimed_at,
          completed_at, updated_at
        ) VALUES (
          'run-1', 'routine-1', 'scheduled', '2026-08-31T13:00:00.000Z', 'completed', 'thread-1',
          NULL, '2026-08-31T13:00:00.000Z', '2026-08-31T13:05:00.000Z', '2026-08-31T13:05:00.000Z'
        )
      `;

      yield* runMigrations();

      const runs = yield* sql<{ readonly runId: string; readonly result: string }>`
        SELECT run_id AS "runId", result_json AS result FROM projection_routine_runs
      `;

      const claims = yield* sql<{ readonly runId: string; readonly event: string | null }>`
        SELECT run_id AS "runId", event_json AS event FROM routine_run_claims
      `;

      assert.deepStrictEqual(runs, [{ runId: "run-1", result: '{"summary":"Done."}' }]);
      assert.deepStrictEqual(claims, [{ runId: "run-1", event: null }]);

      yield* sql`
        INSERT INTO routine_run_claims (
          run_id, routine_id, trigger, scheduled_for, status, claimed_at, updated_at, event_json
        ) VALUES
          ('run-2', 'routine-1', 'app', NULL, 'claimed', '2026-09-01T00:00:00.000Z',
            '2026-09-01T00:00:00.000Z', '{"id":"msg_1","data":{}}'),
          ('run-3', 'routine-1', 'app', NULL, 'claimed', '2026-09-01T00:00:00.000Z',
            '2026-09-01T00:00:00.000Z', '{"id":"msg_2","data":{}}')
      `;

      const routines = yield* sql<{ readonly name: string }>`
        SELECT name FROM pragma_table_info('projection_routines') WHERE name = 'trigger_json'
      `;

      const indexes = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'index' AND name = 'idx_projection_routine_runs_history'
      `;

      assert.strictEqual(routines.length, 1);
      assert.strictEqual(indexes.length, 1);
    }),
  );
});
