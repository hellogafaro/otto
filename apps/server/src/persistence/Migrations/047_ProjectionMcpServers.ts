import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_mcp_servers (
      mcp_server_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      transport TEXT NOT NULL CHECK (transport IN ('stdio', 'url')),
      command TEXT,
      args_json TEXT,
      url TEXT,
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (
        (transport = 'stdio' AND command IS NOT NULL AND url IS NULL) OR
        (transport = 'url' AND command IS NULL AND args_json IS NULL AND url IS NOT NULL)
      )
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_mcp_servers_created_at
    ON projection_mcp_servers(created_at, mcp_server_id)
  `;
});
