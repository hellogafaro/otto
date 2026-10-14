import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** A bot's owner, like a task's: the person responsible for it. Existing bots have none. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE projection_bots ADD COLUMN owner_json TEXT`;
});
