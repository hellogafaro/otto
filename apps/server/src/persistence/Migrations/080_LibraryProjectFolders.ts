import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** A project's own Library folder records its project, like a chat folder records its chat. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE projection_library_folders ADD COLUMN project_id TEXT`;
});
