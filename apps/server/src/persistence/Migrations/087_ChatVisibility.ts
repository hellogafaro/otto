import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Otto: Shared records say `organization`, never `workspace`, and chats keep their creator
 * and who sees them. A chat's creator is the person who sent its first message.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`UPDATE projection_library_folders SET visibility = 'organization' WHERE visibility = 'workspace'`;
  yield* sql`UPDATE projection_library_files SET visibility = 'organization' WHERE visibility = 'workspace'`;
  yield* sql`UPDATE projection_mcp_servers SET visibility = 'organization' WHERE visibility = 'workspace'`;
  yield* sql`UPDATE composio_accounts SET visibility = 'organization' WHERE visibility = 'workspace'`;

  const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_threads)`;

  if (!columns.some((column) => column.name === "created_by")) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN created_by TEXT`;

    yield* sql`
      UPDATE projection_threads SET created_by = (
        SELECT message.author_person_id FROM projection_thread_messages AS message
        WHERE message.thread_id = projection_threads.thread_id
          AND message.role = 'user' AND message.author_person_id IS NOT NULL
        ORDER BY message.created_at LIMIT 1
      )
    `;
  }

  if (!columns.some((column) => column.name === "visibility")) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN visibility TEXT NOT NULL DEFAULT 'organization'`;
  }
});
