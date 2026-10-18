import {
  OrchestrationTask,
  TaskAssignees,
  type TaskListQuery,
  type TaskListSort,
  TaskTimeEntry,
  WORK_STATUS_ORDER,
  WorkParticipant,
  WorkResources,
  WorkStatus,
} from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../errors.ts";
import { type ListSortSql, listPageSql, participantKeySql } from "../list-sql.ts";
import {
  ProjectionTask,
  ProjectionTaskRepository,
  type ProjectionTaskRepositoryShape,
} from "../services/projection-tasks.ts";

const ProjectionTaskDbRow = OrchestrationTask.mapFields(Struct.omit(["timeEntries"])).mapFields(
  Struct.assign({
    owner: Schema.NullOr(Schema.fromJsonString(WorkParticipant)),
    assignees: Schema.fromJsonString(TaskAssignees),
    resources: Schema.fromJsonString(WorkResources),
  }),
);

const TaskListDbRow = ProjectionTaskDbRow.mapFields(
  Struct.assign({
    sortKey: Schema.fromJsonString(Schema.Array(Schema.Union([Schema.String, Schema.Number]))),
  }),
);

const TaskStatusCountRow = Schema.Struct({ status: WorkStatus, count: Schema.Int });

const STATUS_RANK = `CASE status ${WORK_STATUS_ORDER.map(
  (status, rank) => `WHEN '${status}' THEN ${rank}`,
).join(" ")} END`;

/** Each sort's natural order and its keys; the task id breaks ties so every row has a place. */
const TASK_SORTS: Record<TaskListSort, ListSortSql> = {
  status: {
    natural: "asc",
    keys: [
      { sql: STATUS_RANK, direction: "asc" },
      { sql: "updated_at", direction: "desc" },
      { sql: "task_id", direction: "desc" },
    ],
  },
  due: {
    natural: "asc",
    keys: [
      { sql: "due_date IS NULL", direction: "asc", fixed: true },
      { sql: "COALESCE(due_date, '')", direction: "asc" },
      { sql: "task_id", direction: "asc" },
    ],
  },
  updated: {
    natural: "desc",
    keys: [
      { sql: "updated_at", direction: "desc" },
      { sql: "task_id", direction: "desc" },
    ],
  },
  created: {
    natural: "desc",
    keys: [
      { sql: "created_at", direction: "desc" },
      { sql: "task_id", direction: "desc" },
    ],
  },
  title: {
    natural: "asc",
    keys: [
      { sql: "lower(title)", direction: "asc" },
      { sql: "task_id", direction: "asc" },
    ],
  },
};

/** The filter as SQL conditions and their parameters; no status means everything but archived. */
function taskFilterSql(query: TaskListQuery) {
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (query.project !== undefined) {
    conditions.push("project_id = ?");
    params.push(query.project);
  }

  if (query.owner !== undefined) {
    conditions.push(`owner_json IS NOT NULL AND ${participantKeySql("owner_json")} = ?`);
    params.push(query.owner);
  }

  if (query.assignee !== undefined) {
    conditions.push(
      `EXISTS (SELECT 1 FROM json_each(assignees_json) AS assignee WHERE ${participantKeySql("assignee.value")} = ?)`,
    );
    params.push(query.assignee);
  }

  if (query.status !== undefined && query.status.length > 0) {
    conditions.push(`status IN (${query.status.map(() => "?").join(", ")})`);
    params.push(...query.status);
  } else {
    conditions.push("status <> 'archived'");
  }

  if (query.dueFrom !== undefined) {
    conditions.push("due_date >= ?");
    params.push(query.dueFrom);
  }

  if (query.dueTo !== undefined) {
    conditions.push("due_date <= ?");
    params.push(query.dueTo);
  }

  return { conditions, params };
}

const makeProjectionTaskRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: ProjectionTask,
    execute: (row) =>
      sql`
        INSERT INTO projection_tasks (
          task_id,
          project_id,
          title,
          description,
          owner_json,
          assignees_json,
          resources_json,
          due_date,
          repeat,
          status,
          created_at,
          updated_at
        )
        VALUES (
          ${row.id},
          ${row.projectId},
          ${row.title},
          ${row.description},
          ${row.owner !== null ? JSON.stringify(row.owner) : null},
          ${JSON.stringify(row.assignees)},
          ${JSON.stringify(row.resources)},
          ${row.dueDate},
          ${row.repeat},
          ${row.status},
          ${row.createdAt},
          ${row.updatedAt}
        )
        ON CONFLICT (task_id)
        DO UPDATE SET
          project_id = excluded.project_id,
          title = excluded.title,
          description = excluded.description,
          owner_json = excluded.owner_json,
          assignees_json = excluded.assignees_json,
          resources_json = excluded.resources_json,
          due_date = excluded.due_date,
          repeat = excluded.repeat,
          status = excluded.status,
          updated_at = excluded.updated_at
      `,
  });

  const listRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionTaskDbRow,
    execute: () =>
      sql`
        SELECT
          task_id AS id,
          project_id AS "projectId",
          title,
          description,
          owner_json AS owner,
          assignees_json AS assignees,
          resources_json AS resources,
          due_date AS "dueDate",
          repeat,
          status,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_tasks
        ORDER BY created_at ASC, task_id ASC
      `,
  });

  const listEntryRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: TaskTimeEntry,
    execute: () =>
      sql`
        SELECT
          entry_id AS id,
          task_id AS "taskId",
          duration_ms AS duration,
          description,
          created_by AS "createdBy",
          created_at AS "createdAt"
        FROM projection_timesheets
        ORDER BY created_at ASC, entry_id ASC
      `,
  });

  const insertEntryRow = SqlSchema.void({
    Request: TaskTimeEntry,
    execute: (entry) =>
      sql`
        INSERT INTO projection_timesheets (
          entry_id, task_id, duration_ms, description, created_by, created_at
        )
        VALUES (
          ${entry.id}, ${entry.taskId}, ${entry.duration}, ${entry.description},
          ${entry.createdBy}, ${entry.createdAt}
        )
        ON CONFLICT (entry_id) DO NOTHING
      `,
  });

  const deleteEntryRow = SqlSchema.void({
    Request: Schema.String,
    execute: (entryId) => sql`DELETE FROM projection_timesheets WHERE entry_id = ${entryId}`,
  });

  const upsert: ProjectionTaskRepositoryShape["upsert"] = (row) =>
    upsertRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionTaskRepository.upsert:query")),
    );

  const listAll: ProjectionTaskRepositoryShape["listAll"] = () =>
    Effect.all([listRows(), listEntryRows()]).pipe(
      Effect.map(([tasks, entries]) =>
        tasks.map((task) => ({
          ...task,
          timeEntries: entries.filter((entry) => entry.taskId === task.id),
        })),
      ),
      Effect.mapError(toPersistenceSqlError("ProjectionTaskRepository.listAll:query")),
    );

  const list: ProjectionTaskRepositoryShape["list"] = ({ query, limit, after }) => {
    const page = listPageSql(TASK_SORTS[query.sort ?? "status"], query.order, after);
    const filter = taskFilterSql(query);

    const conditions = page.after
      ? [...filter.conditions, page.after.condition]
      : filter.conditions;

    const params = page.after ? [...filter.params, ...page.after.params] : filter.params;

    const rows = SqlSchema.findAll({
      Request: Schema.Void,
      Result: TaskListDbRow,
      execute: () =>
        sql.unsafe(
          `
            SELECT
              task_id AS id,
              project_id AS "projectId",
              title,
              description,
              owner_json AS owner,
              assignees_json AS assignees,
              resources_json AS resources,
              due_date AS "dueDate",
              repeat,
              status,
              created_at AS "createdAt",
              updated_at AS "updatedAt",
              ${page.sortKey} AS "sortKey"
            FROM projection_tasks
            WHERE ${conditions.join(" AND ")}
            ORDER BY ${page.orderBy}
            LIMIT ?
          `,
          [...params, limit + 1],
        ),
    });

    const counts = SqlSchema.findAll({
      Request: Schema.Void,
      Result: TaskStatusCountRow,
      execute: () =>
        sql.unsafe(
          `
            SELECT status, COUNT(*) AS count
            FROM projection_tasks
            WHERE ${filter.conditions.join(" AND ")}
            GROUP BY status
          `,
          filter.params,
        ),
    });

    return Effect.all([rows(), counts()]).pipe(
      Effect.map(([taskRows, statusCounts]) => ({
        rows: taskRows.map(({ sortKey, ...task }) => ({ task, key: sortKey })),
        statusCounts,
      })),
      Effect.mapError(toPersistenceSqlError("ProjectionTaskRepository.list:query")),
    );
  };

  const insertTimeEntry: ProjectionTaskRepositoryShape["insertTimeEntry"] = (entry) =>
    insertEntryRow(entry).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionTaskRepository.insertTimeEntry:query")),
    );

  const deleteTimeEntry: ProjectionTaskRepositoryShape["deleteTimeEntry"] = (entryId) =>
    deleteEntryRow(entryId).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionTaskRepository.deleteTimeEntry:query")),
    );

  return {
    upsert,
    listAll,
    list,
    insertTimeEntry,
    deleteTimeEntry,
  } satisfies ProjectionTaskRepositoryShape;
});

export const ProjectionTaskRepositoryLive = Layer.effect(
  ProjectionTaskRepository,
  makeProjectionTaskRepository,
);
