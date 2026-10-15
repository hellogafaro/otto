import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Otto: A routine keeps the person who set it up, the creator of its chat, and who sees it.
 * Existing routines stay visible to the organization.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_routines)`;

  if (!columns.some((column) => column.name === "created_by")) {
    yield* sql`ALTER TABLE projection_routines ADD COLUMN created_by TEXT`;

    yield* sql`
      UPDATE projection_routines SET created_by = (
        SELECT thread.created_by FROM projection_threads AS thread
        WHERE thread.thread_id = projection_routines.target_thread_id
      )
    `;
  }

  if (!columns.some((column) => column.name === "visibility")) {
    yield* sql`ALTER TABLE projection_routines ADD COLUMN visibility TEXT NOT NULL DEFAULT 'organization'`;
  }
});
