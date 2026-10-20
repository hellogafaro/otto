import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../migrations.ts";
import * as NodeSqliteClient from "../node-sqlite-client.ts";

const TestLayer = Layer.mergeAll(NodeSqliteClient.layerMemory());

it.layer(TestLayer)("018 task capabilities", (it) => {
  it.effect("keeps saved tasks, time and events, and fills in who did what", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 17 });

      yield* sql`
        INSERT INTO projection_tasks (
          task_id, project_id, title, description, owner_json, assignees_json, resources_json,
          due_date, repeat, status, created_at, updated_at
        ) VALUES
          ('task-done', 'launch', 'Done', '', NULL, '[]', '[]', NULL, NULL, 'completed',
            '2026-10-01T00:00:00.000Z', '2026-10-02T00:00:00.000Z'),
          ('task-open', 'launch', 'Open', '', NULL, '[]', '[]', NULL, NULL, 'pending',
            '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')
      `;

      yield* sql`
        INSERT INTO activity (
          id, entity_type, entity_id, type, actor_type, actor_id, content, data_json, created_at
        ) VALUES
          ('a-1', 'task', 'task-done', 'created', 'person', 'user-ada', '', '{}',
            '2026-10-01T00:00:00.000Z'),
          ('a-2', 'task', 'task-done', 'changed', 'person', 'user-ben', '',
            '{"changes":{"status":{"from":"pending","to":"completed"}}}',
            '2026-10-02T00:00:00.000Z')
      `;

      yield* sql`
        INSERT INTO projection_timesheets (
          entry_id, task_id, duration_ms, description, created_by, created_at
        ) VALUES ('entry-1', 'task-done', 1800000, 'Outline', 'user-ada', '2026-10-01T22:00:00.000Z')
      `;

      yield* sql`
        INSERT INTO orchestration_events (
          event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
          command_id, causation_event_id, correlation_id, actor_kind, payload_json, metadata_json
        ) VALUES
          ('e-1', 'task', 'task-done', 1, 'task.time-added', '2026-10-01T22:00:00.000Z',
            NULL, NULL, NULL, 'client', '{}', '{}'),
          ('e-2', 'task', 'task-done', 2, 'task.time-removed', '2026-10-01T23:00:00.000Z',
            NULL, NULL, NULL, 'client', '{}', '{}'),
          ('e-3', 'task', 'task-done', 3, 'task.commented', '2026-10-02T00:00:00.000Z',
            NULL, NULL, NULL, 'client', '{}', '{}'),
          ('e-4', 'task', 'task-done', 4, 'task.updated', '2026-10-02T00:00:00.000Z',
            NULL, NULL, NULL, 'client', '{}', '{}')
      `;

      yield* runMigrations();

      const tasks = yield* sql<{
        readonly id: string;
        readonly priority: string | null;
        readonly createdBy: string | null;
        readonly completedAt: string | null;
        readonly completedBy: string | null;
      }>`
        SELECT task_id AS id, priority, created_by_json AS "createdBy",
          completed_at AS "completedAt", completed_by_json AS "completedBy"
        FROM projection_tasks ORDER BY task_id
      `;

      assert.deepStrictEqual(tasks, [
        {
          id: "task-done",
          priority: null,
          createdBy: '{"type":"person","id":"user-ada"}',
          completedAt: "2026-10-02T00:00:00.000Z",
          completedBy: '{"type":"person","id":"user-ben"}',
        },
        { id: "task-open", priority: null, createdBy: null, completedAt: null, completedBy: null },
      ]);

      const entries = yield* sql<{
        readonly id: string;
        readonly personId: string;
        readonly date: string;
        readonly createdBy: string;
      }>`
        SELECT entry_id AS id, person_id AS "personId", work_date AS date,
          created_by_json AS "createdBy"
        FROM projection_timesheets
      `;

      assert.deepStrictEqual(entries, [
        {
          id: "entry-1",
          personId: "user-ada",
          date: "2026-10-01",
          createdBy: '{"type":"person","id":"user-ada"}',
        },
      ]);

      const events = yield* sql<{ readonly type: string }>`
        SELECT event_type AS type FROM orchestration_events ORDER BY stream_version
      `;

      assert.deepStrictEqual(
        events.map((event) => event.type),
        ["task.time-created", "task.time-deleted", "task.comment-created", "task.updated"],
      );
    }),
  );
});
