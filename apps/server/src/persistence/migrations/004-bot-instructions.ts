import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Otto: A bot's own instructions replace the retired personality tone; bot events still carry
// the old tone, so the projection loses nothing it could not rebuild.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE projection_bots ADD COLUMN instructions TEXT`;
  yield* sql`ALTER TABLE projection_bots DROP COLUMN personality_tone`;
});
