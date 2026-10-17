import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  AuthSessionId,
  OttoUsageReservationId,
  BotId,
  CommandId,
  IsoDateTime,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  Visibility,
} from "./base-schemas.ts";
import { McpServerId } from "./mcp-server.ts";

export const RoutineId = TrimmedNonEmptyString.pipe(Schema.brand("RoutineId"));

export type RoutineId = typeof RoutineId.Type;

export const RoutineRunId = TrimmedNonEmptyString.pipe(Schema.brand("RoutineRunId"));

export type RoutineRunId = typeof RoutineRunId.Type;

export const SkillAssignmentId = TrimmedNonEmptyString.pipe(Schema.brand("SkillAssignmentId"));

export type SkillAssignmentId = typeof SkillAssignmentId.Type;

export const SkillId = TrimmedNonEmptyString.pipe(Schema.brand("SkillId"));

export type SkillId = typeof SkillId.Type;

export const RoutineWeekday = Schema.Literals([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

export type RoutineWeekday = typeof RoutineWeekday.Type;

export const RoutineLocalTime = Schema.String.check(
  Schema.isPattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
);

export type RoutineLocalTime = typeof RoutineLocalTime.Type;

/** Hour steps that divide the day evenly, so every gap between runs is the same. */
export const RoutineHourInterval = Schema.Literals([1, 2, 3, 4, 6, 8, 12]);

export type RoutineHourInterval = typeof RoutineHourInterval.Type;

export const RoutineSchedule = Schema.Union([
  /** Runs at `time` and every `everyHours` hours around the clock from it. */
  Schema.Struct({
    kind: Schema.Literal("hourly"),
    everyHours: RoutineHourInterval,
    time: RoutineLocalTime,
  }),
  Schema.Struct({ kind: Schema.Literal("daily"), time: RoutineLocalTime }),
  Schema.Struct({ kind: Schema.Literal("weekdays"), time: RoutineLocalTime }),
  Schema.Struct({
    kind: Schema.Literal("weekly"),
    weekdays: Schema.Array(RoutineWeekday).check(Schema.isMinLength(1)),
    time: RoutineLocalTime,
  }),
]);

export type RoutineSchedule = typeof RoutineSchedule.Type;

export const RoutineTimeZone = TrimmedNonEmptyString.check(
  Schema.makeFilter((value) => {
    try {
      return Boolean(new Intl.DateTimeFormat("en", { timeZone: value }));
    } catch {
      return "timezone must be a valid IANA time zone";
    }
  }),
);

export type RoutineTimeZone = typeof RoutineTimeZone.Type;

export const RoutineSandbox = Schema.Literals(["local", "e2b", "daytona", "vercel-sandbox"]);

export type RoutineSandbox = typeof RoutineSandbox.Type;

export const RoutineApprovalPolicy = Schema.Literals([
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access",
]);

export type RoutineApprovalPolicy = typeof RoutineApprovalPolicy.Type;

export const RoutineLifecycle = Schema.Literals([
  "draft",
  "approved",
  "enabled",
  "running",
  "paused",
  "blocked",
  "failed",
  "completed",
  "deleted",
]);

export type RoutineLifecycle = typeof RoutineLifecycle.Type;

export const RoutineRunTrigger = Schema.Literals(["dry-run", "manual", "scheduled", "missed"]);

export type RoutineRunTrigger = typeof RoutineRunTrigger.Type;

export const RoutineRunStatus = Schema.Literals([
  "queued",
  "waiting-for-approval",
  "running",
  "blocked",
  "failed",
  "completed",
  "canceled",
]);

export type RoutineRunStatus = typeof RoutineRunStatus.Type;

export const RoutineFailureKind = Schema.Literals([
  "connector",
  "browser",
  "provider",
  "bot",
  "workspace",
  "approval",
  "execution",
]);

export type RoutineFailureKind = typeof RoutineFailureKind.Type;

export const RoutineRunResult = Schema.Struct({ summary: TrimmedNonEmptyString });

export type RoutineRunResult = typeof RoutineRunResult.Type;

export const RoutineRunFailure = Schema.Struct({
  kind: RoutineFailureKind,
  message: TrimmedNonEmptyString,
});

export type RoutineRunFailure = typeof RoutineRunFailure.Type;

export const RoutineSkillAssignment = Schema.Struct({
  id: SkillAssignmentId,
  botId: BotId,
  skillId: SkillId,
  name: TrimmedNonEmptyString,
  description: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export type RoutineSkillAssignment = typeof RoutineSkillAssignment.Type;

/**
 * Otto: Where each run posts: `target` is the routine's one chat, `per-run` starts a new
 * chat with the bot in the routine's project every run.
 */
export const RoutineThreadMode = Schema.Literals(["target", "per-run"]);

export type RoutineThreadMode = typeof RoutineThreadMode.Type;

export const RoutineDefinition = Schema.Struct({
  botId: BotId,
  targetThreadId: ThreadId,
  threadMode: RoutineThreadMode.pipe(Schema.withDecodingDefault(Effect.succeed("target" as const))),
  job: TrimmedNonEmptyString,
  procedure: TrimmedNonEmptyString,
  schedule: RoutineSchedule,
  timezone: RoutineTimeZone,
  skillAssignmentIds: Schema.Array(SkillAssignmentId),
  connectorDependencies: Schema.Array(McpServerId),
  projectId: ProjectId,
  sandbox: RoutineSandbox,
  approvalPolicy: RoutineApprovalPolicy,
  /** When set, each run delegates the job to this bot from the target thread's owner. */
  delegateToBotId: Schema.NullOr(BotId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  /** Otto: The person who started the chat the routine was set up in. */
  createdBy: Schema.NullOr(AuthSessionId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  /** Otto: `user` keeps the routine, and its run chats, to its creator. */
  visibility: Visibility.pipe(Schema.withDecodingDefault(Effect.succeed("organization" as const))),
});

export type RoutineDefinition = typeof RoutineDefinition.Type;

export const OTTO_CREATE_ROUTINE_TOOL_NAME = "routine_create";

export const OttoCreateRoutineInput = Schema.Struct({
  name: TrimmedNonEmptyString,
  instructions: TrimmedNonEmptyString,
  schedule: RoutineSchedule,
  skillNames: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  connectorNames: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  /** Otto: Each run starts its own chat with the bot instead of posting here. */
  newChatEachRun: Schema.optional(Schema.Boolean),
});

export type OttoCreateRoutineInput = typeof OttoCreateRoutineInput.Type;

/** A bot's edit to one of its routines: only the fields the user asked to change. */
export const OttoUpdateRoutineInput = Schema.Struct({
  name: Schema.optional(TrimmedNonEmptyString),
  instructions: Schema.optional(TrimmedNonEmptyString),
  schedule: Schema.optional(RoutineSchedule),
});

export type OttoUpdateRoutineInput = typeof OttoUpdateRoutineInput.Type;

export const Routine = Schema.Struct({
  id: RoutineId,
  ...RoutineDefinition.fields,
  procedureVersion: PositiveInt,
  approvalVersion: Schema.NullOr(PositiveInt),
  enabled: Schema.Boolean,
  lifecycle: RoutineLifecycle,
  nextRunAt: Schema.NullOr(IsoDateTime),
  lastRunAt: Schema.NullOr(IsoDateTime),
  latestResult: Schema.NullOr(RoutineRunResult),
  latestFailure: Schema.NullOr(RoutineRunFailure),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});

export type Routine = typeof Routine.Type;

/** The small piece of a deleted routine needed to keep its chat receipts readable. */
export const RoutineReceiptSource = Schema.Struct({
  id: RoutineId,
  targetThreadId: ThreadId,
  job: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});

export type RoutineReceiptSource = typeof RoutineReceiptSource.Type;

const RoutineRunFields = {
  id: RoutineRunId,
  routineId: RoutineId,
  procedureVersion: PositiveInt,
  status: RoutineRunStatus,
  result: Schema.NullOr(RoutineRunResult),
  failure: Schema.NullOr(RoutineRunFailure),
  usageRef: Schema.NullOr(OttoUsageReservationId),
  threadRef: Schema.NullOr(ThreadId),
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
} as const;

export const RoutineRun = Schema.Union([
  Schema.Struct({
    ...RoutineRunFields,
    trigger: Schema.Literals(["dry-run", "manual"]),
    scheduledFor: Schema.Null,
  }),
  Schema.Struct({
    ...RoutineRunFields,
    trigger: Schema.Literals(["scheduled", "missed"]),
    scheduledFor: IsoDateTime,
  }),
]);

export type RoutineRun = typeof RoutineRun.Type;

export const RoutineListRunsInput = Schema.Struct({ routineId: RoutineId });

export type RoutineListRunsInput = typeof RoutineListRunsInput.Type;

export const RoutineListRunsResult = Schema.Struct({ runs: Schema.Array(RoutineRun) });

export type RoutineListRunsResult = typeof RoutineListRunsResult.Type;

export const RoutineListThreadRunsInput = Schema.Struct({
  threadId: ThreadId,
  beforeRunId: Schema.optional(RoutineRunId),
});

export const RoutineListThreadRunsResult = Schema.Struct({
  runs: Schema.Array(RoutineRun),
  nextCursor: Schema.NullOr(RoutineRunId),
});

export type RoutineListThreadRunsResult = typeof RoutineListThreadRunsResult.Type;

export class RoutineThreadReadError extends Schema.TaggedErrorClass<RoutineThreadReadError>()(
  "RoutineThreadReadError",
  { threadId: ThreadId, message: TrimmedNonEmptyString },
) {}

export class RoutineReadError extends Schema.TaggedErrorClass<RoutineReadError>()(
  "RoutineReadError",
  { routineId: RoutineId, message: TrimmedNonEmptyString },
) {}

const RoutineCommandFields = {
  commandId: CommandId,
  routineId: RoutineId,
} as const;

export const RoutineDraftCommand = Schema.Struct({
  type: Schema.Literal("routine.draft"),
  ...RoutineCommandFields,
  ...RoutineDefinition.fields,
  expectedProcedureVersion: Schema.optional(PositiveInt),
  createdAt: IsoDateTime,
});

export const RoutineApproveCommand = Schema.Struct({
  type: Schema.Literal("routine.approve"),
  ...RoutineCommandFields,
  procedureVersion: PositiveInt,
  createdAt: IsoDateTime,
});

export const RoutineEnableCommand = Schema.Struct({
  type: Schema.Literal("routine.enable"),
  ...RoutineCommandFields,
  createdAt: IsoDateTime,
});

export const RoutinePauseCommand = Schema.Struct({
  type: Schema.Literal("routine.pause"),
  ...RoutineCommandFields,
  reason: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});

export const RoutineRunCommand = Schema.Struct({
  type: Schema.Literal("routine.run"),
  ...RoutineCommandFields,
  runId: RoutineRunId,
  trigger: Schema.Literals(["dry-run", "manual"]),
  createdAt: IsoDateTime,
});

/**
 * Otto: A person's direct edit of a routine's title and where it runs. `regenerateTitle`
 * asks the server for a new title from the instructions instead of `job`.
 */
export const RoutineUpdateCommand = Schema.Struct({
  type: Schema.Literal("routine.update"),
  ...RoutineCommandFields,
  job: Schema.optional(TrimmedNonEmptyString),
  regenerateTitle: Schema.optional(Schema.Literal(true)),
  threadMode: Schema.optional(RoutineThreadMode),
  projectId: Schema.optional(ProjectId),
  /** Only the routine's creator changes who sees it. */
  visibility: Schema.optional(Visibility),
  /** Set by the server to the signed-in person. */
  by: Schema.optional(AuthSessionId),
  createdAt: IsoDateTime,
});

export const RoutineDeleteCommand = Schema.Struct({
  type: Schema.Literal("routine.delete"),
  ...RoutineCommandFields,
  createdAt: IsoDateTime,
});

export const RoutineSkillAssignCommand = Schema.Struct({
  type: Schema.Literal("routine.skill.assign"),
  commandId: CommandId,
  assignmentId: SkillAssignmentId,
  botId: BotId,
  skillId: SkillId,
  name: TrimmedNonEmptyString,
  description: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});

export const RoutineSkillUnassignCommand = Schema.Struct({
  type: Schema.Literal("routine.skill.unassign"),
  commandId: CommandId,
  assignmentId: SkillAssignmentId,
  botId: BotId,
  createdAt: IsoDateTime,
});

export const ClientRoutineCommand = Schema.Union([
  RoutineDraftCommand,
  RoutineApproveCommand,
  RoutineEnableCommand,
  RoutinePauseCommand,
  RoutineRunCommand,
  RoutineUpdateCommand,
  RoutineDeleteCommand,
  RoutineSkillAssignCommand,
  RoutineSkillUnassignCommand,
]);

export type ClientRoutineCommand = typeof ClientRoutineCommand.Type;

export const RoutineRunScheduledCommand = Schema.Struct({
  type: Schema.Literal("routine.run.scheduled"),
  ...RoutineCommandFields,
  runId: RoutineRunId,
  trigger: Schema.Literals(["scheduled", "missed"]),
  scheduledFor: IsoDateTime,
  createdAt: IsoDateTime,
});

export const RoutineCreateApprovedCommand = Schema.Struct({
  type: Schema.Literal("routine.create-approved"),
  ...RoutineCommandFields,
  ...RoutineDefinition.fields,
  createdAt: IsoDateTime,
});

export const RoutineRunStartCommand = Schema.Struct({
  type: Schema.Literal("routine.run.start"),
  ...RoutineCommandFields,
  runId: RoutineRunId,
  threadRef: Schema.NullOr(ThreadId),
  startedAt: IsoDateTime,
});

export const RoutineRunBlockCommand = Schema.Struct({
  type: Schema.Literal("routine.run.block"),
  ...RoutineCommandFields,
  runId: RoutineRunId,
  failure: RoutineRunFailure,
  createdAt: IsoDateTime,
});

export const RoutineRunFailCommand = Schema.Struct({
  type: Schema.Literal("routine.run.fail"),
  ...RoutineCommandFields,
  runId: RoutineRunId,
  failure: RoutineRunFailure,
  usageRef: Schema.NullOr(OttoUsageReservationId),
  createdAt: IsoDateTime,
});

export const RoutineRunCompleteCommand = Schema.Struct({
  type: Schema.Literal("routine.run.complete"),
  ...RoutineCommandFields,
  runId: RoutineRunId,
  result: RoutineRunResult,
  usageRef: Schema.NullOr(OttoUsageReservationId),
  nextRunAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
});

export const RoutineRunCancelCommand = Schema.Struct({
  type: Schema.Literal("routine.run.cancel"),
  ...RoutineCommandFields,
  runId: RoutineRunId,
  createdAt: IsoDateTime,
});

export const InternalRoutineCommand = Schema.Union([
  RoutineCreateApprovedCommand,
  RoutineRunScheduledCommand,
  RoutineRunStartCommand,
  RoutineRunBlockCommand,
  RoutineRunFailCommand,
  RoutineRunCompleteCommand,
  RoutineRunCancelCommand,
]);

export type InternalRoutineCommand = typeof InternalRoutineCommand.Type;

export const RoutineDraftedRecord = Schema.Struct({
  ...Routine.fields,
  approvalVersion: Schema.Null,
  enabled: Schema.Literal(false),
  lifecycle: Schema.Literal("draft"),
});

export type RoutineDraftedRecord = typeof RoutineDraftedRecord.Type;

export const RoutineDraftedPayload = Schema.Struct({ routine: RoutineDraftedRecord });

export const RoutineApprovedPayload = Schema.Struct({ routine: Routine });

export const RoutineEnabledPayload = Schema.Struct({ routine: Routine });

export const RoutinePausedPayload = Schema.Struct({ routine: Routine });

export const RoutineRunningPayload = Schema.Struct({ routine: Routine, run: RoutineRun });

export const RoutineBlockedPayload = Schema.Struct({ routine: Routine, run: RoutineRun });

export const RoutineFailedPayload = Schema.Struct({ routine: Routine, run: RoutineRun });

export const RoutineCompletedPayload = Schema.Struct({ routine: Routine, run: RoutineRun });

export const RoutineRunCanceledPayload = Schema.Struct({ routine: Routine, run: RoutineRun });

export const RoutineUpdatedPayload = Schema.Struct({ routine: Routine });

export const RoutineDeletedPayload = Schema.Struct({ routine: Routine });

export const RoutineSkillAssignedPayload = Schema.Struct({ assignment: RoutineSkillAssignment });

export const RoutineSkillUnassignedPayload = Schema.Struct({
  assignmentId: SkillAssignmentId,
  botId: BotId,
  removedAt: IsoDateTime,
});
