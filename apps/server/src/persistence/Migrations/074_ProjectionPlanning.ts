import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const projectColumns = yield* sql<{ readonly name: string }>`
    SELECT name FROM pragma_table_info('projection_projects')
  `;

  const has = (name: string) => projectColumns.some((column) => column.name === name);

  if (!has("description")) {
    yield* sql`ALTER TABLE projection_projects ADD COLUMN description TEXT`;
  }

  if (!has("owner_json")) {
    yield* sql`ALTER TABLE projection_projects ADD COLUMN owner_json TEXT`;
  }

  if (!has("resources_json")) {
    yield* sql`ALTER TABLE projection_projects ADD COLUMN resources_json TEXT`;
  }

  if (!has("status")) {
    yield* sql`ALTER TABLE projection_projects ADD COLUMN status TEXT`;
  }

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_tasks (
      task_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      owner_json TEXT,
      assignees_json TEXT NOT NULL,
      resources_json TEXT NOT NULL,
      due_date TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_tasks_project
    ON projection_tasks(project_id, updated_at)
  `;
});
