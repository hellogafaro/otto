import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_routines)`;

  if (!columns.some((column) => column.name === "thread_mode")) {
    // Otto: 'target' posts every run into the routine chat; 'per-run' starts a new chat.
    yield* sql`ALTER TABLE projection_routines ADD COLUMN thread_mode TEXT NOT NULL DEFAULT 'target'`;
  }
});
