import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Otto: one memories table replaces the entity-memory tables and their full-text index.
// Their rows and the Markdown memory files are not carried over.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`DROP TRIGGER IF EXISTS otto_memory_fts_insert`;
  yield* sql`DROP TRIGGER IF EXISTS otto_memory_fts_update`;
  yield* sql`DROP TRIGGER IF EXISTS otto_memory_fts_delete`;
  yield* sql`DROP TABLE IF EXISTS otto_memory_fts`;
  yield* sql`DROP TABLE IF EXISTS otto_memory_decision_receipts`;
  yield* sql`DROP TABLE IF EXISTS otto_memory_candidates`;
  yield* sql`DROP TABLE IF EXISTS otto_memory_derived_copies`;
  yield* sql`DROP TABLE IF EXISTS otto_memory_revisions`;

  yield* sql`
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL CHECK (scope IN ('person', 'bot', 'group', 'project', 'workspace')),
      scope_id TEXT NOT NULL,
      text TEXT NOT NULL CHECK (length(text) <= 280),
      status TEXT NOT NULL CHECK (status IN ('active', 'pending')),
      replaces_id TEXT REFERENCES memories (id) ON DELETE CASCADE,
      bot_id TEXT,
      person_id TEXT,
      thread_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (length(trim(text)) > 0 OR (status = 'pending' AND replaces_id IS NOT NULL))
    )
  `;
  yield* sql`CREATE INDEX memories_scope ON memories (scope, scope_id, status)`;
});
