import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** Who connected each Composio account and whether it serves the workspace or just them. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS composio_accounts (
      connection_id TEXT PRIMARY KEY,
      created_by TEXT,
      created_by_name TEXT,
      visibility TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;
});
