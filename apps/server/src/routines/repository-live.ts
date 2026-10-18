import { flow } from "effect/Function";
import {
  AuthSessionId,
  Visibility,
  BotId,
  McpServerId,
  ProjectId,
  ThreadId,
  RoutineId,
  RoutineRunId,
  SkillAssignmentId,
  SkillId,
  RoutineSandbox,
  RoutineThreadMode,
  RoutineApprovalPolicy,
  RoutineFailureKind,
  RoutineRun,
  RoutineHourInterval,
  RoutineRunTrigger,
  RoutineTrigger,
  ROUTINE_STATUSES,
  type RoutineListSort,
  type RoutineListView,
  RoutineStatus,
} from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { toPersistenceSqlError } from "../persistence/errors.ts";
import { listPageSql, type ListSortSql } from "../persistence/list-sql.ts";
import { RoutineRepository, type RoutineClaim, type RoutineRepositoryShape } from "./repository.ts";

const RoutineRow = Schema.Struct({
  id: RoutineId,
  botId: BotId,
  targetThreadId: ThreadId,
  projectId: ProjectId,
  job: Schema.String,
  procedure: Schema.String,
  procedureVersion: Schema.Number,
  approvalVersion: Schema.NullOr(Schema.Number),
  schedule: Schema.fromJsonString(
    Schema.Union([
      Schema.Struct({
        kind: Schema.Literal("hourly"),
        everyHours: RoutineHourInterval,
        time: Schema.String,
      }),
      Schema.Struct({ kind: Schema.Literals(["daily", "weekdays"]), time: Schema.String }),
      Schema.Struct({
        kind: Schema.Literal("weekly"),
        weekdays: Schema.Array(
          Schema.Literals([
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
            "sunday",
          ]),
        ),
        time: Schema.String,
      }),
      Schema.Struct({
        kind: Schema.Literals(["monthly", "quarterly"]),
        day: Schema.Number,
        time: Schema.String,
      }),
      Schema.Struct({
        kind: Schema.Literal("yearly"),
        month: Schema.Number,
        day: Schema.Number,
        time: Schema.String,
      }),
    ]),
  ),
  timezone: Schema.String,
  trigger: Schema.fromJsonString(RoutineTrigger),
  skillAssignmentIds: Schema.fromJsonString(Schema.Array(SkillAssignmentId)),
  connectorDependencies: Schema.fromJsonString(Schema.Array(McpServerId)),
  sandbox: RoutineSandbox,
  approvalPolicy: RoutineApprovalPolicy,
  delegateToBotId: Schema.NullOr(BotId),
  createdBy: Schema.NullOr(AuthSessionId),
  visibility: Visibility,
  threadMode: RoutineThreadMode,
  enabled: Schema.Number,
  lifecycle: Schema.Literals([
    "draft",
    "approved",
    "enabled",
    "running",
    "paused",
    "blocked",
    "failed",
    "completed",
    "deleted",
  ]),
  nextRunAt: Schema.NullOr(Schema.String),
  lastRunAt: Schema.NullOr(Schema.String),
  latestResult: Schema.NullOr(Schema.fromJsonString(Schema.Struct({ summary: Schema.String }))),
  latestFailure: Schema.NullOr(
    Schema.fromJsonString(Schema.Struct({ kind: RoutineFailureKind, message: Schema.String })),
  ),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  deletedAt: Schema.NullOr(Schema.String),
});

const RoutineRunRow = Schema.Struct({
  id: RoutineRunId,
  routineId: RoutineId,
  procedureVersion: Schema.Number,
  trigger: RoutineRunTrigger,
  scheduledFor: Schema.NullOr(Schema.String),
  status: Schema.Literals([
    "queued",
    "running",
    "waiting-for-approval",
    "completed",
    "failed",
    "canceled",
    "blocked",
  ]),
  threadRef: Schema.NullOr(ThreadId),
  result: Schema.NullOr(Schema.fromJsonString(Schema.Struct({ summary: Schema.String }))),
  failure: Schema.NullOr(
    Schema.fromJsonString(Schema.Struct({ kind: RoutineFailureKind, message: Schema.String })),
  ),
  usageRef: Schema.NullOr(Schema.String),
  startedAt: Schema.NullOr(Schema.String),
  completedAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

const SkillAssignmentRow = Schema.Struct({
  id: SkillAssignmentId,
  botId: BotId,
  skillId: SkillId,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

const decodeRoutine = Schema.decodeUnknownSync(RoutineRow);

const RoutineAppEventJson = Schema.fromJsonString(
  Schema.Struct({ id: Schema.String, data: Schema.Unknown }),
);

const encodeEvent = Schema.encodeSync(RoutineAppEventJson);

const decodeEvent = Schema.decodeUnknownSync(RoutineAppEventJson);

const decodeRun = flow(
  Schema.decodeUnknownSync(RoutineRunRow),
  Schema.decodeUnknownSync(RoutineRun),
);

const decodeSkillAssignment = Schema.decodeUnknownSync(SkillAssignmentRow);

const decodeListRow = Schema.decodeUnknownSync(
  RoutineRow.mapFields((fields) => ({
    ...fields,
    sortKey: Schema.fromJsonString(Schema.Array(Schema.Union([Schema.String, Schema.Number]))),
  })),
);

const decodeStatusCount = Schema.decodeUnknownSync(
  Schema.Struct({ status: RoutineStatus, count: Schema.Int }),
);

/** The status a routine's page shows: Draft until approved, then Failed, Active or Paused. */
const STATUS_SQL = `CASE WHEN approval_version IS NULL OR approval_version <> procedure_version THEN 'draft' WHEN lifecycle IN ('failed', 'blocked') THEN 'failed' WHEN enabled = 1 THEN 'active' ELSE 'paused' END`;

const STATUS_RANK = `CASE ${STATUS_SQL} ${ROUTINE_STATUSES.map(
  (status, rank) => `WHEN '${status}' THEN ${rank}`,
).join(" ")} END`;

/** Each sort's natural order and its keys; the routine id breaks ties so every row has a place. */
const ROUTINE_SORTS: Record<RoutineListSort, ListSortSql> = {
  status: {
    natural: "asc",
    keys: [
      { sql: STATUS_RANK, direction: "asc" },
      { sql: "updated_at", direction: "desc" },
      { sql: "routine_id", direction: "desc" },
    ],
  },
  next: {
    natural: "asc",
    keys: [
      { sql: "next_run_at IS NULL", direction: "asc", fixed: true },
      { sql: "COALESCE(next_run_at, '')", direction: "asc" },
      { sql: "routine_id", direction: "asc" },
    ],
  },
  updated: {
    natural: "desc",
    keys: [
      { sql: "updated_at", direction: "desc" },
      { sql: "routine_id", direction: "desc" },
    ],
  },
  created: {
    natural: "desc",
    keys: [
      { sql: "created_at", direction: "desc" },
      { sql: "routine_id", direction: "desc" },
    ],
  },
  title: {
    natural: "asc",
    keys: [
      { sql: "lower(job)", direction: "asc" },
      { sql: "routine_id", direction: "asc" },
    ],
  },
};

/**
 * The filter as SQL conditions and their parameters. Deleted routines never list, and a
 * private routine lists only for the person who set it up, as `canSeeRoutine` decides.
 */
function routineFilterSql(query: RoutineListView, viewer: string) {
  const conditions = [
    "deleted_at IS NULL",
    "lifecycle <> 'deleted'",
    "(visibility <> 'user' OR created_by IS NULL OR created_by = ?)",
  ];

  const params: Array<string | number> = [viewer];

  if (query.status !== undefined && query.status.length > 0) {
    conditions.push(`${STATUS_SQL} IN (${query.status.map(() => "?").join(", ")})`);
    params.push(...query.status);
  }

  if (query.bot !== undefined) {
    conditions.push("bot_id = ?");
    params.push(query.bot);
  }

  if (query.search !== undefined) {
    conditions.push("instr(lower(job), ?) > 0");
    params.push(query.search.toLowerCase());
  }

  if (query.runFrom !== undefined || query.runTo !== undefined) {
    const bounds = [
      ...(query.runFrom === undefined ? [] : [{ sql: ">= ?", value: query.runFrom }]),
      ...(query.runTo === undefined ? [] : [{ sql: "< ?", value: query.runTo }]),
    ];

    const within = (column: string) =>
      bounds.map((bound) => `${column} ${bound.sql}`).join(" AND ");

    conditions.push(`((${within("next_run_at")}) OR (${within("last_run_at")}))`);
    params.push(...bounds.map((bound) => bound.value), ...bounds.map((bound) => bound.value));
  }

  return { conditions, params };
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const readRoutines = (parameter?: string) =>
    parameter === undefined
      ? sql<typeof RoutineRow.Encoded>`
          SELECT routine_id AS id, bot_id AS "botId", target_thread_id AS "targetThreadId", thread_mode AS "threadMode",
            project_id AS "projectId", job,
            procedure, procedure_version AS "procedureVersion",
            approval_version AS "approvalVersion", schedule_json AS schedule, timezone,
            COALESCE(trigger_json, '{"type":"schedule"}') AS trigger,
            skill_assignment_ids_json AS "skillAssignmentIds",
            connector_dependencies_json AS "connectorDependencies", sandbox,
            approval_policy AS "approvalPolicy", delegate_to_bot_id AS "delegateToBotId",
            created_by AS "createdBy", visibility,
            enabled, lifecycle,
            next_run_at AS "nextRunAt", last_run_at AS "lastRunAt",
            latest_result_json AS "latestResult", latest_failure_json AS "latestFailure",
            created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"
          FROM projection_routines ORDER BY created_at, routine_id
        `
      : sql<typeof RoutineRow.Encoded>`
          SELECT routine_id AS id, bot_id AS "botId", target_thread_id AS "targetThreadId", thread_mode AS "threadMode",
            project_id AS "projectId", job,
            procedure, procedure_version AS "procedureVersion",
            approval_version AS "approvalVersion", schedule_json AS schedule, timezone,
            COALESCE(trigger_json, '{"type":"schedule"}') AS trigger,
            skill_assignment_ids_json AS "skillAssignmentIds",
            connector_dependencies_json AS "connectorDependencies", sandbox,
            approval_policy AS "approvalPolicy", delegate_to_bot_id AS "delegateToBotId",
            created_by AS "createdBy", visibility,
            enabled, lifecycle,
            next_run_at AS "nextRunAt", last_run_at AS "lastRunAt",
            latest_result_json AS "latestResult", latest_failure_json AS "latestFailure",
            created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"
          FROM projection_routines WHERE routine_id = ${parameter}
        `;

  const listAll: RoutineRepositoryShape["listAll"] = readRoutines().pipe(
    Effect.map((rows) =>
      rows.map((row) => {
        const decoded = decodeRoutine(row);

        return { ...decoded, enabled: decoded.enabled === 1 };
      }),
    ),
    Effect.mapError(toPersistenceSqlError("RoutineRepository.listAll")),
  );

  const list: RoutineRepositoryShape["list"] = ({ query, viewer, limit, after }) => {
    const keyset = listPageSql(ROUTINE_SORTS[query.sort ?? "status"], query.order, after);
    const filter = routineFilterSql(query, viewer);
    const conditions = [...filter.conditions, ...(keyset.after ? [keyset.after.condition] : [])];
    const params = [...filter.params, ...(keyset.after?.params ?? [])];

    const rows = sql.unsafe(
      `
        SELECT routine_id AS id, bot_id AS "botId", target_thread_id AS "targetThreadId", thread_mode AS "threadMode",
          project_id AS "projectId", job,
          procedure, procedure_version AS "procedureVersion",
          approval_version AS "approvalVersion", schedule_json AS schedule, timezone,
            COALESCE(trigger_json, '{"type":"schedule"}') AS trigger,
          skill_assignment_ids_json AS "skillAssignmentIds",
          connector_dependencies_json AS "connectorDependencies", sandbox,
          approval_policy AS "approvalPolicy", delegate_to_bot_id AS "delegateToBotId",
          created_by AS "createdBy", visibility,
          enabled, lifecycle,
          next_run_at AS "nextRunAt", last_run_at AS "lastRunAt",
          latest_result_json AS "latestResult", latest_failure_json AS "latestFailure",
          created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt",
          ${keyset.sortKey} AS "sortKey"
        FROM projection_routines
        WHERE ${conditions.join(" AND ")}
        ORDER BY ${keyset.orderBy}
        LIMIT ?
      `,
      [...params, limit + 1],
    );

    const counts = sql.unsafe(
      `
        SELECT ${STATUS_SQL} AS status, COUNT(*) AS count
        FROM projection_routines
        WHERE ${filter.conditions.join(" AND ")}
        GROUP BY 1
      `,
      filter.params,
    );

    return Effect.all([rows, counts]).pipe(
      Effect.map(([routineRows, statusRows]) => ({
        rows: routineRows.map((row) => {
          const { sortKey, ...routine } = decodeListRow(row);

          return { routine: { ...routine, enabled: routine.enabled === 1 }, key: sortKey };
        }),
        statusCounts: statusRows.map((row) => decodeStatusCount(row)),
      })),
      Effect.mapError(toPersistenceSqlError("RoutineRepository.list")),
    );
  };

  const listEnabled: RoutineRepositoryShape["listEnabled"] = listAll.pipe(
    Effect.map((routines) => routines.filter((routine) => routine.enabled)),
  );

  const getById: RoutineRepositoryShape["getById"] = (routineId) =>
    readRoutines(routineId).pipe(
      Effect.map((rows) => {
        if (rows[0] === undefined) return null;
        const decoded = decodeRoutine(rows[0]);

        return { ...decoded, enabled: decoded.enabled === 1 };
      }),
      Effect.mapError(toPersistenceSqlError("RoutineRepository.getById")),
    );

  const listRuns: RoutineRepositoryShape["listRuns"] = (routineId) =>
    sql<typeof RoutineRunRow.Encoded>`
      SELECT run_id AS id, routine_id AS "routineId", procedure_version AS "procedureVersion",
        trigger, scheduled_for AS "scheduledFor", status, thread_ref AS "threadRef",
        result_json AS result, failure_json AS failure, usage_ref AS "usageRef",
        started_at AS "startedAt", completed_at AS "completedAt", created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM projection_routine_runs
      WHERE routine_id = ${routineId}
      ORDER BY created_at DESC, run_id DESC
    `.pipe(
      Effect.map((rows) => rows.map((row) => decodeRun(row))),
      Effect.mapError(toPersistenceSqlError("RoutineRepository.listRuns")),
    );

  const listThreadRuns: RoutineRepositoryShape["listThreadRuns"] = (
    threadId,
    viewer,
    beforeRunId,
  ) =>
    sql<typeof RoutineRunRow.Encoded>`
      SELECT run.run_id AS id, run.routine_id AS "routineId",
        run.procedure_version AS "procedureVersion", run.trigger,
        run.scheduled_for AS "scheduledFor", run.status, run.thread_ref AS "threadRef",
        run.result_json AS result, run.failure_json AS failure, run.usage_ref AS "usageRef",
        run.started_at AS "startedAt", run.completed_at AS "completedAt",
        run.created_at AS "createdAt", run.updated_at AS "updatedAt"
      FROM projection_routine_runs AS run
      JOIN projection_routines AS routine ON routine.routine_id = run.routine_id
      WHERE routine.target_thread_id = ${threadId}
        AND (routine.deleted_at IS NOT NULL OR routine.visibility <> 'user'
          OR routine.created_by IS NULL OR routine.created_by = ${viewer})
        AND (${beforeRunId ?? null} IS NULL OR
          (run.created_at, run.run_id) < (
            SELECT previous.created_at, previous.run_id
            FROM projection_routine_runs AS previous
            WHERE previous.run_id = ${beforeRunId ?? null}
          ))
      ORDER BY run.created_at DESC, run.run_id DESC
      LIMIT 101
    `.pipe(
      Effect.map((rows) => {
        const runs = rows.slice(0, 100).map((row) => decodeRun(row));

        return { runs, nextCursor: rows.length > 100 ? (runs[99]?.id ?? null) : null };
      }),
      Effect.mapError(toPersistenceSqlError("RoutineRepository.listThreadRuns")),
    );

  const listThreadRoutines: RoutineRepositoryShape["listThreadRoutines"] = (threadId) =>
    sql<typeof RoutineRow.Encoded>`
      SELECT routine_id AS id, bot_id AS "botId", target_thread_id AS "targetThreadId", thread_mode AS "threadMode",
        project_id AS "projectId", job,
        procedure, procedure_version AS "procedureVersion",
        approval_version AS "approvalVersion", schedule_json AS schedule, timezone,
        COALESCE(trigger_json, '{"type":"schedule"}') AS trigger,
        skill_assignment_ids_json AS "skillAssignmentIds",
        connector_dependencies_json AS "connectorDependencies", sandbox,
        approval_policy AS "approvalPolicy", delegate_to_bot_id AS "delegateToBotId",
        created_by AS "createdBy", visibility,
        enabled, lifecycle,
        next_run_at AS "nextRunAt", last_run_at AS "lastRunAt",
        latest_result_json AS "latestResult", latest_failure_json AS "latestFailure",
        created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"
      FROM projection_routines
      WHERE target_thread_id = ${threadId}
      ORDER BY created_at, routine_id
      LIMIT 100
    `.pipe(
      Effect.map((rows) =>
        rows.map((row) => {
          const decoded = decodeRoutine(row);

          return { ...decoded, enabled: decoded.enabled === 1 };
        }),
      ),
      Effect.mapError(toPersistenceSqlError("RoutineRepository.listThreadRoutines")),
    );

  const listAllRuns: RoutineRepositoryShape["listAllRuns"] = sql<typeof RoutineRunRow.Encoded>`
    SELECT run_id AS id, routine_id AS "routineId", procedure_version AS "procedureVersion",
      trigger, scheduled_for AS "scheduledFor", status, thread_ref AS "threadRef",
      result_json AS result, failure_json AS failure, usage_ref AS "usageRef",
      started_at AS "startedAt", completed_at AS "completedAt", created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM projection_routine_runs
    WHERE run_id IN (
      SELECT run_id FROM (
        SELECT run_id,
          ROW_NUMBER() OVER (
            PARTITION BY routine_id ORDER BY created_at DESC, run_id DESC
          ) AS history_rank
        FROM projection_routine_runs
      ) WHERE history_rank <= 5
    ) OR status IN ('queued', 'running', 'waiting-for-approval')
    ORDER BY created_at, run_id
  `.pipe(
    Effect.map((rows) => rows.map((row) => decodeRun(row))),
    Effect.mapError(toPersistenceSqlError("RoutineRepository.listAllRuns")),
  );

  const getLatestThreadRef: RoutineRepositoryShape["getLatestThreadRef"] = (routineId) =>
    sql<{ readonly threadRef: string }>`
      SELECT thread_ref AS "threadRef"
      FROM projection_routine_runs
      WHERE routine_id = ${routineId} AND thread_ref IS NOT NULL
      ORDER BY created_at DESC, run_id DESC
      LIMIT 1
    `.pipe(
      Effect.map((rows) => (rows[0] === undefined ? null : ThreadId.make(rows[0].threadRef))),
      Effect.mapError(toPersistenceSqlError("RoutineRepository.getLatestThreadRef")),
    );

  const getActiveRunByThreadRef: RoutineRepositoryShape["getActiveRunByThreadRef"] = (
    threadRef,
    turnId = null,
  ) =>
    sql<typeof RoutineRunRow.Encoded>`
        SELECT run_id AS id, routine_id AS "routineId", procedure_version AS "procedureVersion",
          trigger, scheduled_for AS "scheduledFor", status, thread_ref AS "threadRef",
          result_json AS result, failure_json AS failure, usage_ref AS "usageRef",
          started_at AS "startedAt", completed_at AS "completedAt", created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_routine_runs
        WHERE thread_ref = ${threadRef}
          AND status IN ('queued', 'running', 'waiting-for-approval')
          AND EXISTS (
            SELECT 1 FROM projection_turns AS turn
            WHERE turn.thread_id = ${threadRef}
              AND turn.pending_message_id = 'routine:' || projection_routine_runs.run_id || ':message'
              AND (${turnId} IS NULL OR turn.turn_id = ${turnId})
              AND turn.state IN ('completed', 'error', 'interrupted')
          )
        ORDER BY updated_at DESC LIMIT 1
      `.pipe(
      Effect.map((rows) => (rows[0] === undefined ? null : decodeRun(rows[0]))),
      Effect.mapError(toPersistenceSqlError("RoutineRepository.getActiveRunByThreadRef")),
    );

  const listSkillAssignments: RoutineRepositoryShape["listSkillAssignments"] = sql<
    typeof SkillAssignmentRow.Encoded
  >`
    SELECT assignment_id AS id, bot_id AS "botId", skill_id AS "skillId", name,
      description, created_at AS "createdAt", updated_at AS "updatedAt"
    FROM projection_routine_skill_assignments
    ORDER BY created_at, assignment_id
  `.pipe(
    Effect.map((rows) => rows.map((row) => decodeSkillAssignment(row))),
    Effect.mapError(toPersistenceSqlError("RoutineRepository.listSkillAssignments")),
  );

  const claim: RoutineRepositoryShape["claim"] = (input) =>
    sql<{ readonly runId: string }>`
      INSERT INTO routine_run_claims (
        run_id, routine_id, trigger, scheduled_for, status, claimed_at, updated_at, event_json
      ) VALUES (
        ${input.runId}, ${input.routineId}, ${input.trigger}, ${input.scheduledFor},
        'claimed', ${input.claimedAt}, ${input.claimedAt},
        ${input.event == null ? null : encodeEvent(input.event)}
      )
      ON CONFLICT DO NOTHING
      RETURNING run_id AS "runId"
    `.pipe(
      Effect.map((rows) => rows.length === 1),
      Effect.mapError(toPersistenceSqlError("RoutineRepository.claim")),
    );

  const markDispatched: RoutineRepositoryShape["markDispatched"] = (runId, threadId) =>
    sql`
      UPDATE routine_run_claims
      SET status = 'dispatched', thread_id = ${threadId}, updated_at = CURRENT_TIMESTAMP
      WHERE run_id = ${runId}
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("RoutineRepository.markDispatched")),
    );

  const markBlocked: RoutineRepositoryShape["markBlocked"] = (runId, failure, completedAt) =>
    sql`
      UPDATE routine_run_claims
      SET status = 'blocked', failure = ${failure}, completed_at = ${completedAt},
        updated_at = ${completedAt}
      WHERE run_id = ${runId}
    `.pipe(Effect.asVoid, Effect.mapError(toPersistenceSqlError("RoutineRepository.markBlocked")));

  const markSettled: RoutineRepositoryShape["markSettled"] = (runId, status, completedAt) =>
    sql`
      UPDATE routine_run_claims
      SET status = ${status}, completed_at = ${completedAt}, updated_at = ${completedAt}
      WHERE run_id = ${runId}
    `.pipe(Effect.asVoid, Effect.mapError(toPersistenceSqlError("RoutineRepository.markSettled")));

  const listRecoverable: RoutineRepositoryShape["listRecoverable"] = sql<
    RoutineClaim & { readonly eventJson: string | null }
  >`
    SELECT run_id AS "runId", routine_id AS "routineId", trigger,
      scheduled_for AS "scheduledFor", claimed_at AS "claimedAt", claims.status,
      claims.thread_id AS "threadRef", turns.state AS "terminalState",
      turns.completed_at AS "terminalAt", sessions.status AS "sessionState",
      sessions.updated_at AS "sessionUpdatedAt", claims.event_json AS "eventJson"
    FROM routine_run_claims AS claims
    LEFT JOIN projection_turns AS turns ON turns.row_id = (
      SELECT MAX(candidate.row_id) FROM projection_turns AS candidate
      WHERE candidate.thread_id = claims.thread_id
        AND candidate.pending_message_id = 'routine:' || claims.run_id || ':message'
        AND candidate.state IN ('completed', 'error', 'interrupted')
    )
    LEFT JOIN projection_thread_sessions AS sessions ON sessions.thread_id = claims.thread_id
    WHERE claims.status IN ('claimed', 'dispatched')
    ORDER BY claimed_at, run_id
  `.pipe(
    Effect.map((rows) =>
      rows.map((row) => ({
        ...row,
        event: row.eventJson === null ? null : decodeEvent(row.eventJson),
      })),
    ),
    Effect.mapError(toPersistenceSqlError("RoutineRepository.listRecoverable")),
  );

  return {
    listAll,
    list,
    listEnabled,
    getById,
    listRuns,
    listThreadRuns,
    listThreadRoutines,
    listAllRuns,
    getLatestThreadRef,
    getActiveRunByThreadRef,
    listSkillAssignments,
    claim,
    markDispatched,
    markBlocked,
    markSettled,
    listRecoverable,
  } satisfies RoutineRepositoryShape;
});

export const RoutineRepositoryLive = Layer.effect(RoutineRepository, make);
