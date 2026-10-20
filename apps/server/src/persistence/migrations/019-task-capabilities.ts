import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Otto: Tasks gain a priority and keep who made, changed and completed them; time entries keep
 * whose time they are, the day it was worked and who logged it. Saved events take the create and
 * delete names, so history replays under them.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE projection_tasks ADD COLUMN priority TEXT`;
  yield* sql`ALTER TABLE projection_tasks ADD COLUMN created_by_json TEXT`;
  yield* sql`ALTER TABLE projection_tasks ADD COLUMN updated_by_json TEXT`;
  yield* sql`ALTER TABLE projection_tasks ADD COLUMN completed_at TEXT`;
  yield* sql`ALTER TABLE projection_tasks ADD COLUMN completed_by_json TEXT`;

  yield* sql`
    UPDATE projection_tasks SET created_by_json = (
      SELECT json_object('type', actor_type, 'id', actor_id)
      FROM activity
      WHERE entity_type = 'task' AND entity_id = projection_tasks.task_id
        AND type = 'created' AND actor_type IS NOT NULL AND actor_id IS NOT NULL
      LIMIT 1
    )
  `;

  yield* sql`
    UPDATE projection_tasks SET
      completed_at = (
        SELECT created_at FROM activity
        WHERE entity_type = 'task' AND entity_id = projection_tasks.task_id AND type = 'changed'
          AND json_extract(data_json, '$.changes.status.to') = 'completed'
        ORDER BY created_at DESC LIMIT 1
      ),
      completed_by_json = (
        SELECT CASE WHEN actor_type IS NULL OR actor_id IS NULL THEN NULL
          ELSE json_object('type', actor_type, 'id', actor_id) END
        FROM activity
        WHERE entity_type = 'task' AND entity_id = projection_tasks.task_id AND type = 'changed'
          AND json_extract(data_json, '$.changes.status.to') = 'completed'
        ORDER BY created_at DESC LIMIT 1
      )
    WHERE status = 'completed'
  `;

  yield* sql`
    CREATE TABLE projection_timesheets_next (
      entry_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      person_id TEXT NOT NULL,
      work_date TEXT NOT NULL,
      created_by_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;

  yield* sql`
    INSERT INTO projection_timesheets_next (
      entry_id, task_id, duration_ms, description, person_id, work_date, created_by_json,
      created_at
    )
    SELECT entry_id, task_id, duration_ms, description, created_by, substr(created_at, 1, 10),
      json_object('type', 'person', 'id', created_by), created_at
    FROM projection_timesheets
  `;

  yield* sql`DROP TABLE projection_timesheets`;
  yield* sql`ALTER TABLE projection_timesheets_next RENAME TO projection_timesheets`;

  yield* sql`
    CREATE INDEX idx_projection_timesheets_task ON projection_timesheets(task_id, created_at)
  `;

  yield* sql`
    CREATE INDEX idx_projection_timesheets_person ON projection_timesheets(person_id, work_date)
  `;

  yield* sql`
    UPDATE orchestration_events SET event_type = CASE event_type
      WHEN 'task.time-added' THEN 'task.time-created'
      WHEN 'task.time-removed' THEN 'task.time-deleted'
      WHEN 'task.commented' THEN 'task.comment-created'
    END
    WHERE event_type IN ('task.time-added', 'task.time-removed', 'task.commented')
  `;
});
