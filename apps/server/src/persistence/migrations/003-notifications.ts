import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Otto: Each person's notifications: what happened, on which task or chat, and when they read it.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL,
      type TEXT NOT NULL,
      actor_type TEXT,
      actor_id TEXT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      title TEXT NOT NULL,
      excerpt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      read_at TEXT
    )
  `;

  yield* sql`CREATE INDEX notifications_person_created ON notifications (person_id, created_at)`;
});
