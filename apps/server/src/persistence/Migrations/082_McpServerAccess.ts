import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** Personal or workspace MCP servers, and who added each one. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE projection_mcp_servers ADD COLUMN visibility TEXT NOT NULL DEFAULT 'workspace'`;
  yield* sql`ALTER TABLE projection_mcp_servers ADD COLUMN created_by_json TEXT`;
});
