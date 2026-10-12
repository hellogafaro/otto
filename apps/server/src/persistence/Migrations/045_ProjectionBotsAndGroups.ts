import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE projection_groups (
      group_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE projection_bots (
      bot_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      title TEXT NOT NULL,
      avatar_json TEXT NOT NULL,
      engine_json TEXT,
      sandbox TEXT,
      group_id TEXT,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX idx_projection_bots_group_id
    ON projection_bots(group_id)
  `;

  yield* sql`
    CREATE INDEX idx_projection_bots_archived_at
    ON projection_bots(archived_at)
  `;
});
