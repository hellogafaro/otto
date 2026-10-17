import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Otto: The tools a person let a bot run without asking, from an approval's Always allow.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE projection_bots ADD COLUMN always_allowed_json TEXT NOT NULL DEFAULT '[]'`;
});
