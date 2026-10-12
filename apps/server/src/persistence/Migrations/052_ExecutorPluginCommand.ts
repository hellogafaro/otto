import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    UPDATE projection_mcp_servers
    SET command = 'bunx', args_json = '["-y","executor","mcp"]'
    WHERE mcp_server_id = 'builtin-executor'
      AND transport = 'stdio'
      AND command = 'executor.sh'
  `;
});
