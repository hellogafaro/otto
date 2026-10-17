import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Otto: history compaction is billed as its own usage category. SQLite cannot alter a CHECK,
// so the table is rebuilt with the same columns, rows and indexes.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE otto_bot_usage_entries_next (
        reservation_id TEXT PRIMARY KEY,
        source_key TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        thread_id TEXT,
        turn_id TEXT,
        category TEXT NOT NULL,
        state TEXT NOT NULL,
        reserved_tokens INTEGER NOT NULL CHECK (reserved_tokens >= 0),
        held_tokens INTEGER NOT NULL DEFAULT 0 CHECK (held_tokens >= 0),
        input_tokens INTEGER,
        output_tokens INTEGER,
        reasoning_tokens INTEGER,
        provider TEXT,
        model TEXT,
        unavailable_reason TEXT,
        created_at TEXT NOT NULL,
        settled_at TEXT,
        cached_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0),
        cache_creation_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_creation_tokens >= 0),
        CHECK (category IN ('turn', 'tool', 'observer', 'reflector', 'compaction', 'extraction', 'recall', 'routine', 'delegated')),
        CHECK (state IN ('reserved', 'reported', 'unavailable', 'released')),
        UNIQUE (bot_id, source_key)
    )
  `;
  yield* sql`INSERT INTO otto_bot_usage_entries_next SELECT * FROM otto_bot_usage_entries`;
  yield* sql`DROP TABLE otto_bot_usage_entries`;
  yield* sql`ALTER TABLE otto_bot_usage_entries_next RENAME TO otto_bot_usage_entries`;
  yield* sql`
    CREATE INDEX idx_otto_bot_usage_entries_bot_created
      ON otto_bot_usage_entries (bot_id, created_at DESC)
  `;
  yield* sql`
    CREATE INDEX idx_otto_bot_usage_entries_thread_turn
      ON otto_bot_usage_entries (thread_id, turn_id)
  `;
  yield* sql`
    CREATE UNIQUE INDEX idx_otto_bot_usage_entries_bound_turn
      ON otto_bot_usage_entries (bot_id, thread_id, turn_id)
      WHERE category = 'turn' AND turn_id IS NOT NULL
  `;
});
