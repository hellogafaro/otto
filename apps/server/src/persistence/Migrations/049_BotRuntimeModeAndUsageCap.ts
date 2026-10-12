import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_bots
    ADD COLUMN runtime_mode TEXT NOT NULL DEFAULT 'full-access'
  `;
  yield* sql`ALTER TABLE projection_bots ADD COLUMN usage_cap_json TEXT`;
});
