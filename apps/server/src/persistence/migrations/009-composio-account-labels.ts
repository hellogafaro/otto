import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Otto: The label a person typed for a connected account. Composio gets an owner-scoped alias,
// so older rows without a label keep showing the bare alias Composio holds.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE composio_accounts ADD COLUMN label TEXT`;
});
