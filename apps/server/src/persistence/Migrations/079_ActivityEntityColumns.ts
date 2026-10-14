import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * The first `activity` table named its subject `item_type`/`item_id`; it is now the entity.
 * A table created by migration 078 already has the new names and is left alone.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(activity)`;

  if (!columns.some((column) => column.name === "item_type")) return;

  yield* sql`ALTER TABLE activity RENAME COLUMN item_type TO entity_type`;
  yield* sql`ALTER TABLE activity RENAME COLUMN item_id TO entity_id`;
  yield* sql`DROP INDEX IF EXISTS idx_activity_item`;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_activity_entity
    ON activity(entity_type, entity_id, created_at)
  `;
});
