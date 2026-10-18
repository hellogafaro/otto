import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Otto: Chat settling is retired; archive and snooze park a chat instead. Its events no longer
// decode, so they are pruned with the projection columns only they wrote.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`DELETE FROM orchestration_events WHERE event_type IN ('thread.settled', 'thread.unsettled')`;
  yield* sql`ALTER TABLE projection_threads DROP COLUMN settled_override`;
  yield* sql`ALTER TABLE projection_threads DROP COLUMN settled_at`;
  yield* sql`ALTER TABLE projection_threads DROP COLUMN unsettled_at`;
});
