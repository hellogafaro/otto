import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Otto: An uploaded project cover image, the Library file id; null draws a generated cover.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE projection_projects ADD COLUMN cover_file_id TEXT`;
});
