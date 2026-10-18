import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Otto: a word index over finished chat messages, so a bot's search finds what was said in any
// chat it may read without scanning every message. Rows are keyed by message id, which, unlike
// rowid, survives a VACUUM.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE VIRTUAL TABLE message_search USING fts5(
      message_id UNINDEXED,
      text,
      tokenize = 'unicode61 remove_diacritics 2'
    )
  `;

  yield* sql`
    INSERT INTO message_search (message_id, text)
    SELECT message_id, text FROM projection_thread_messages
    WHERE is_streaming = 0 AND role IN ('user', 'assistant')
  `;

  yield* sql`
    CREATE TRIGGER message_search_insert
      AFTER INSERT ON projection_thread_messages
      WHEN NEW.is_streaming = 0 AND NEW.role IN ('user', 'assistant')
      BEGIN
        INSERT INTO message_search (message_id, text) VALUES (NEW.message_id, NEW.text);
      END
  `;

  yield* sql`
    CREATE TRIGGER message_search_update
      AFTER UPDATE OF message_id, text, is_streaming, role ON projection_thread_messages
      BEGIN
        DELETE FROM message_search WHERE message_id = OLD.message_id;
        INSERT INTO message_search (message_id, text)
        SELECT NEW.message_id, NEW.text
        WHERE NEW.is_streaming = 0 AND NEW.role IN ('user', 'assistant');
      END
  `;

  yield* sql`
    CREATE TRIGGER message_search_delete
      AFTER DELETE ON projection_thread_messages
      BEGIN
        DELETE FROM message_search WHERE message_id = OLD.message_id;
      END
  `;
});
