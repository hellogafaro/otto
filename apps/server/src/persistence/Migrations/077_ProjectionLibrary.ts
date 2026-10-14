import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** The Library: folders and files. File bytes live in the library directory. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_library_folders (
      folder_id TEXT PRIMARY KEY,
      parent_id TEXT,
      thread_id TEXT,
      title TEXT NOT NULL,
      visibility TEXT NOT NULL,
      created_by_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_by_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_library_folders_parent
    ON projection_library_folders(parent_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_library_files (
      file_id TEXT PRIMARY KEY,
      folder_id TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      extension TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      visibility TEXT NOT NULL,
      created_by_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_by_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_library_files_folder
    ON projection_library_files(folder_id)
  `;
});
