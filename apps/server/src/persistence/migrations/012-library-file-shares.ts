import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Otto: A Library file's public link (its id, who shared it and when); null when it has none.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE projection_library_files ADD COLUMN share_json TEXT`;
});
