import {
  Actor,
  AuthSessionId,
  IsoDateTime,
  OrchestrationTask,
  TASK_PRIORITIES,
  TaskAssignees,
  TaskDueDate,
  TaskId,
  type TaskListQuery,
  type TaskListSort,
  TaskTimeDuration,
  type TaskTimeEntry,
  TaskTimeEntryId,
  WORK_STATUS_ORDER,
  WorkParticipant,
  WorkResources,
  WorkStatus,
} from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
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

const ActorJson = Schema.NullOr(Schema.fromJsonString(Actor));

const ProjectionTaskDbRow = OrchestrationTask.mapFields(Struct.omit(["timeEntries"])).mapFields(
  Struct.assign({
    owner: Schema.NullOr(Schema.fromJsonString(WorkParticipant)),
    assignees: Schema.fromJsonString(TaskAssignees),
    resources: Schema.fromJsonString(WorkResources),
    createdBy: ActorJson,
    updatedBy: ActorJson,
    completedBy: ActorJson,
  }),
);

/** Every task column under the name `OrchestrationTask` gives it. */
const TASK_COLUMNS = `
  task_id AS id,
  project_id AS "projectId",
  title,
  description,
  owner_json AS owner,
  assignees_json AS assignees,
  resources_json AS resources,
  due_date AS "dueDate",
  repeat,
  priority,
  status,
  created_by_json AS "createdBy",
  updated_by_json AS "updatedBy",
  completed_at AS "completedAt",
  completed_by_json AS "completedBy",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const TimeEntryDbRow = Schema.Struct({
  id: TaskTimeEntryId,
  taskId: TaskId,
  duration: TaskTimeDuration,
  description: Schema.String,
  personId: AuthSessionId,
  date: TaskDueDate,
  createdBy: Schema.fromJsonString(Actor),
  createdAt: IsoDateTime,
});

const TimeEntryListDbRow = TimeEntryDbRow.mapFields(
  Struct.assign({
    sortKey: Schema.fromJsonString(Schema.Array(Schema.Union([Schema.String, Schema.Number]))),
  }),
);

/** Qualified, so the timesheet query can join the tasks for their project. */
const TIME_ENTRY_COLUMNS = `
  projection_timesheets.entry_id AS id,
  projection_timesheets.task_id AS "taskId",
  projection_timesheets.duration_ms AS duration,
  projection_timesheets.description,
  projection_timesheets.person_id AS "personId",
  projection_timesheets.work_date AS date,
  projection_timesheets.created_by_json AS "createdBy",
  projection_timesheets.created_at AS "createdAt"
`;

/** Time entries newest first: the day worked, then when it was logged. */
const TIME_ENTRY_SORT: ListSortSql = {
  natural: "desc",
  keys: [
    { sql: "projection_timesheets.work_date", direction: "desc" },
    { sql: "projection_timesheets.created_at", direction: "desc" },
    { sql: "projection_timesheets.entry_id", direction: "desc" },
  ],
};

const TaskListDbRow = ProjectionTaskDbRow.mapFields(
  Struct.assign({
    sortKey: Schema.fromJsonString(Schema.Array(Schema.Union([Schema.String, Schema.Number]))),
  }),
);

const TaskStatusCountRow = Schema.Struct({ status: WorkStatus, count: Schema.Int });

const STATUS_RANK = `CASE status ${WORK_STATUS_ORDER.map(
  (status, rank) => `WHEN '${status}' THEN ${rank}`,
).join(" ")} END`;

const PRIORITY_RANK = `CASE priority ${TASK_PRIORITIES.map(
  (priority, rank) => `WHEN '${priority}' THEN ${rank}`,
).join(" ")} ELSE ${TASK_PRIORITIES.length} END`;

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
  priority: {
    natural: "asc",
    keys: [
      { sql: "priority IS NULL", direction: "asc", fixed: true },
      { sql: PRIORITY_RANK, direction: "asc" },
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

  if (query.priority !== undefined && query.priority.length > 0) {
    conditions.push(`priority IN (${query.priority.map(() => "?").join(", ")})`);
    params.push(...query.priority);
  }

  if (query.dueFrom !== undefined) {
    conditions.push("due_date >= ?");
    params.push(query.dueFrom);
  }

  if (query.dueTo !== undefined) {
    conditions.push("due_date <= ?");
    params.push(query.dueTo);
  }

  if (query.title !== undefined) {
    conditions.push("instr(lower(title), lower(?)) > 0");
    params.push(query.title);
  }

  if (query.search !== undefined) {
    conditions.push(
      "(instr(lower(title), lower(?)) > 0 OR instr(lower(description), lower(?)) > 0)",
    );
    params.push(query.search, query.search);
  }

  return { conditions, params };
}

const actorJson = (actor: typeof Actor.Encoded | null | undefined) =>
  actor == null ? null : JSON.stringify(actor);

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
          priority,
          status,
          created_by_json,
          updated_by_json,
          completed_at,
          completed_by_json,
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
          ${row.priority},
          ${row.status},
          ${actorJson(row.createdBy)},
          ${actorJson(row.updatedBy)},
          ${row.completedAt},
          ${actorJson(row.completedBy)},
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
          priority = excluded.priority,
          status = excluded.status,
          created_by_json = excluded.created_by_json,
          updated_by_json = excluded.updated_by_json,
          completed_at = excluded.completed_at,
          completed_by_json = excluded.completed_by_json,
          updated_at = excluded.updated_at
      `,
  });

  const listRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionTaskDbRow,
    execute: () =>
      sql.unsafe(
        `SELECT ${TASK_COLUMNS} FROM projection_tasks ORDER BY created_at ASC, task_id ASC`,
      ),
  });

  const listEntryRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: TimeEntryDbRow,
    execute: () =>
      sql.unsafe(
        `SELECT ${TIME_ENTRY_COLUMNS} FROM projection_timesheets ORDER BY created_at ASC, entry_id ASC`,
      ),
  });

  const getRow = SqlSchema.findOneOption({
    Request: TaskId,
    Result: ProjectionTaskDbRow,
    execute: (taskId) =>
      sql.unsafe(`SELECT ${TASK_COLUMNS} FROM projection_tasks WHERE task_id = ?`, [taskId]),
  });

  const listTaskEntryRows = SqlSchema.findAll({
    Request: TaskId,
    Result: TimeEntryDbRow,
    execute: (taskId) =>
      sql.unsafe(
        `SELECT ${TIME_ENTRY_COLUMNS} FROM projection_timesheets WHERE task_id = ? ORDER BY created_at ASC, entry_id ASC`,
        [taskId],
      ),
  });

  const insertEntryRow = (entry: TaskTimeEntry) =>
    sql`
      INSERT INTO projection_timesheets (
        entry_id, task_id, duration_ms, description, person_id, work_date, created_by_json,
        created_at
      )
      VALUES (
        ${entry.id}, ${entry.taskId}, ${entry.duration}, ${entry.description}, ${entry.personId},
        ${entry.date}, ${JSON.stringify(entry.createdBy)}, ${entry.createdAt}
      )
      ON CONFLICT (entry_id) DO NOTHING
    `;

  const deleteEntryRow = (entryId: string) =>
    sql`DELETE FROM projection_timesheets WHERE entry_id = ${entryId}`;

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

  const get: ProjectionTaskRepositoryShape["get"] = (taskId) =>
    Effect.all([getRow(taskId), listTaskEntryRows(taskId)]).pipe(
      Effect.map(([task, timeEntries]) => Option.map(task, (row) => ({ ...row, timeEntries }))),
      Effect.mapError(toPersistenceSqlError("ProjectionTaskRepository.get:query")),
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
              ${TASK_COLUMNS},
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
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("ProjectionTaskRepository.insertTimeEntry:query")),
    );

  const deleteTimeEntry: ProjectionTaskRepositoryShape["deleteTimeEntry"] = (entryId) =>
    deleteEntryRow(entryId).pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("ProjectionTaskRepository.deleteTimeEntry:query")),
    );

  const deleteTask: ProjectionTaskRepositoryShape["delete"] = (taskId) =>
    Effect.all([
      sql`DELETE FROM projection_timesheets WHERE task_id = ${taskId}`,
      sql`DELETE FROM projection_tasks WHERE task_id = ${taskId}`,
    ]).pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("ProjectionTaskRepository.delete:query")),
    );

  const listTimeEntries: ProjectionTaskRepositoryShape["listTimeEntries"] = ({
    filter,
    limit,
    after,
  }) => {
    const page = listPageSql(TIME_ENTRY_SORT, undefined, after);
    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (filter.taskId !== undefined) {
      conditions.push("projection_timesheets.task_id = ?");
      params.push(filter.taskId);
    }

    if (filter.personId !== undefined) {
      conditions.push("projection_timesheets.person_id = ?");
      params.push(filter.personId);
    }

    if (filter.projectId !== undefined) {
      conditions.push("projection_tasks.project_id = ?");
      params.push(filter.projectId);
    }

    if (filter.from !== undefined) {
      conditions.push("projection_timesheets.work_date >= ?");
      params.push(filter.from);
    }

    if (filter.to !== undefined) {
      conditions.push("projection_timesheets.work_date <= ?");
      params.push(filter.to);
    }

    const where = conditions.length === 0 ? "1 = 1" : conditions.join(" AND ");
    const from = `projection_timesheets JOIN projection_tasks ON projection_tasks.task_id = projection_timesheets.task_id`;

    const rows = SqlSchema.findAll({
      Request: Schema.Void,
      Result: TimeEntryListDbRow,
      execute: () =>
        sql.unsafe(
          `
            SELECT ${TIME_ENTRY_COLUMNS}, ${page.sortKey} AS "sortKey"
            FROM ${from}
            WHERE ${page.after ? `${where} AND ${page.after.condition}` : where}
            ORDER BY ${page.orderBy}
            LIMIT ?
          `,
          [...params, ...(page.after?.params ?? []), limit + 1],
        ),
    });

    const total = SqlSchema.findAll({
      Request: Schema.Void,
      Result: Schema.Struct({ total: Schema.Number }),
      execute: () =>
        sql.unsafe(
          `SELECT COALESCE(SUM(projection_timesheets.duration_ms), 0) AS total FROM ${from} WHERE ${where}`,
          params,
        ),
    });

    return Effect.all([rows(), total()]).pipe(
      Effect.map(([entryRows, [sum]]) => ({
        rows: entryRows.map(({ sortKey, ...entry }) => ({ entry, key: sortKey })),
        totalDuration: sum?.total ?? 0,
      })),
      Effect.mapError(toPersistenceSqlError("ProjectionTaskRepository.listTimeEntries:query")),
    );
  };

  return {
    upsert,
    listAll,
    get,
    list,
    insertTimeEntry,
    deleteTimeEntry,
    delete: deleteTask,
    listTimeEntries,
  } satisfies ProjectionTaskRepositoryShape;
});

export const ProjectionTaskRepositoryLive = Layer.effect(
  ProjectionTaskRepository,
  makeProjectionTaskRepository,
);
