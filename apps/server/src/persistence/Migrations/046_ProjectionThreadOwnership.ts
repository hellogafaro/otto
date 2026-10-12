import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE projection_threads ADD COLUMN bot_id TEXT`;
  yield* sql`ALTER TABLE projection_threads ADD COLUMN group_id TEXT`;

  yield* sql`
    CREATE INDEX idx_projection_threads_bot_id
    ON projection_threads(bot_id)
  `;
  yield* sql`
    CREATE INDEX idx_projection_threads_group_id
    ON projection_threads(group_id)
  `;
});
