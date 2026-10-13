import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** The timesheet: every time entry logged on a task, one row each. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_timesheets (
      entry_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_timesheets_task
    ON projection_timesheets(task_id, created_at)
  `;
});
