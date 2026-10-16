import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Otto: chats created without a parent lost their creator and visibility in the projection,
// so "Only me" chats read as team chats. Restore both from the thread's own events.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    UPDATE projection_threads
    SET
      created_by = COALESCE(
        created_by,
        (
          SELECT json_extract(payload_json, '$.createdBy')
          FROM orchestration_events
          WHERE event_type = 'thread.created' AND stream_id = projection_threads.thread_id
        )
      ),
      visibility = COALESCE(
        (
          SELECT json_extract(payload_json, '$.visibility')
          FROM orchestration_events
          WHERE event_type IN ('thread.created', 'thread.meta-updated')
            AND stream_id = projection_threads.thread_id
            AND json_extract(payload_json, '$.visibility') IS NOT NULL
          ORDER BY sequence DESC
          LIMIT 1
        ),
        visibility
      )
    WHERE parent_thread_id IS NULL
  `;
});
