import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Otto: memory starts over as the team's or one person's, line by line, each true everywhere or
// in one project. Lines expire unless they come up again. Nothing from the old memories carries over.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`DROP TABLE IF EXISTS memories`;

  yield* sql`
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      resource TEXT NOT NULL,
      project_id TEXT,
      text TEXT NOT NULL CHECK (length(trim(text)) > 0 AND length(text) <= 280),
      thread_id TEXT,
      edited_by TEXT,
      created_at TEXT NOT NULL,
      confirmed_at TEXT NOT NULL
    )
  `;

  yield* sql`CREATE INDEX memories_resource ON memories (resource, project_id)`;

  // How far each chat's messages have been reviewed for memory.
  yield* sql`
    CREATE TABLE memory_reviews (
      thread_id TEXT PRIMARY KEY,
      reviewed_through TEXT NOT NULL
    )
  `;
});
