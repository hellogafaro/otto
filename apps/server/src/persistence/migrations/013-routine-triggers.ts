import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Otto: A routine starts on its schedule or on an event in a connected app; null is the
// schedule. Runs an app event starts record `app`, and a claim keeps its event so a run
// claimed before a restart still starts with it. SQLite cannot alter a CHECK, so the run
// tables are rebuilt with the same rows and indexes.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE projection_routines ADD COLUMN trigger_json TEXT`;

  yield* sql`
    CREATE TABLE projection_routine_runs_next (
        run_id TEXT PRIMARY KEY,
        routine_id TEXT NOT NULL,
        procedure_version INTEGER NOT NULL,
        trigger TEXT NOT NULL CHECK (trigger IN ('dry-run', 'manual', 'scheduled', 'missed', 'app')),
        scheduled_for TEXT,
        status TEXT NOT NULL CHECK (
          status IN (
            'queued', 'running', 'waiting-for-approval', 'completed', 'failed', 'canceled', 'blocked'
    )
        ),
        thread_ref TEXT,
        result_json TEXT,
        failure_json TEXT,
        usage_ref TEXT,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (routine_id, scheduled_for)
    )
  `;
  yield* sql`INSERT INTO projection_routine_runs_next SELECT * FROM projection_routine_runs`;
  yield* sql`DROP TABLE projection_routine_runs`;
  yield* sql`ALTER TABLE projection_routine_runs_next RENAME TO projection_routine_runs`;
  yield* sql`
    CREATE INDEX idx_projection_routine_runs_history
      ON projection_routine_runs(routine_id, scheduled_for DESC)
  `;

  yield* sql`
    CREATE TABLE routine_run_claims_next (
        run_id TEXT PRIMARY KEY,
        routine_id TEXT NOT NULL,
        trigger TEXT NOT NULL CHECK (trigger IN ('dry-run', 'manual', 'scheduled', 'missed', 'app')),
        scheduled_for TEXT,
        status TEXT NOT NULL CHECK (status IN ('claimed', 'dispatched', 'completed', 'failed', 'canceled', 'blocked')),
        thread_id TEXT,
        failure TEXT,
        claimed_at TEXT NOT NULL,
        completed_at TEXT,
        updated_at TEXT NOT NULL,
        event_json TEXT,
        UNIQUE (routine_id, scheduled_for)
    )
  `;
  yield* sql`
    INSERT INTO routine_run_claims_next (
      run_id, routine_id, trigger, scheduled_for, status, thread_id, failure, claimed_at,
      completed_at, updated_at
    )
    SELECT run_id, routine_id, trigger, scheduled_for, status, thread_id, failure, claimed_at,
      completed_at, updated_at
    FROM routine_run_claims
  `;
  yield* sql`DROP TABLE routine_run_claims`;
  yield* sql`ALTER TABLE routine_run_claims_next RENAME TO routine_run_claims`;
});
