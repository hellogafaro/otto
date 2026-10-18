import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import * as Struct from "effect/Struct";
import {
  AuthSessionId,
  BotId,
  CommandId,
  IsoDateTime,
  ProjectId,
  TaskId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "../base-schemas.ts";
import { ListCursor, ListLimit, ListOrder } from "./lists.ts";

/** One lifecycle shared by projects and tasks; archived hides an item from lists. */
export const WorkStatus = Schema.Literals([
  "backlog",
  "pending",
  "in_progress",
  "completed",
  "cancelled",
  "archived",
]);

export type WorkStatus = typeof WorkStatus.Type;

export const WORK_STATUSES = WorkStatus.literals;

/** Linear's order: what is moving first, then what is waiting, then what is done. */
export const WORK_STATUS_ORDER: readonly WorkStatus[] = [
  "in_progress",
  "pending",
  "backlog",
  "completed",
  "cancelled",
  "archived",
];

/** A person uses the same identity as group person members; a bot is a workspace bot. */
export const WorkParticipant = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("bot"),
    botId: BotId,
  }),
  Schema.Struct({
    kind: Schema.Literal("person"),
    personId: AuthSessionId,
    displayName: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  }),
]);

export type WorkParticipant = typeof WorkParticipant.Type;

/**
 * A task event that wakes a bot in its task chat: an assignment, or a person's comment that
 * mentions the bot or replies to it. `by` names whoever did it, with their participant key.
 */
export const TaskWake = Schema.Struct({
  type: Schema.Literals(["assigned", "commented"]),
  taskId: TaskId,
  by: Schema.Struct({ key: TrimmedNonEmptyString, name: TrimmedNonEmptyString }),
  commentId: Schema.optional(TrimmedNonEmptyString),
  reason: Schema.optional(Schema.Literals(["mention", "reply"])),
  replyTo: Schema.optional(TrimmedNonEmptyString),
  /** The comment as plain text, or the line the chat shows for an assignment. */
  text: Schema.optional(Schema.String),
});

export type TaskWake = typeof TaskWake.Type;

/** The signed-in person answering an approval; the server sets it, never the client. */
export const ApprovalResponder = Schema.Struct({
  personId: AuthSessionId,
  displayName: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  canWrite: Schema.Boolean,
});

export type ApprovalResponder = typeof ApprovalResponder.Type;

/** An external web link; resources saved before resource types existed decode as links. */
export const WorkLinkResource = Schema.Struct({
  type: Schema.Literal("link").pipe(Schema.withDecodingDefault(Effect.succeed("link" as const))),
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  url: TrimmedNonEmptyString.check(Schema.isMaxLength(2048), Schema.isPattern(/^https?:\/\//i)),
});

/** Another Otto entity, shown by its current title; new entity types join this list. */
export const WorkEntityResource = Schema.Struct({
  type: Schema.Literals(["task", "project"]),
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
});

export const WorkResource = Schema.Union([WorkLinkResource, WorkEntityResource]);

export type WorkResource = typeof WorkResource.Type;

export const WorkTitle = TrimmedNonEmptyString.check(Schema.isMaxLength(300));

export const WorkDescription = TrimmedString.check(Schema.isMaxLength(10_000));

export const WorkResources = Schema.Array(WorkResource).check(Schema.isMaxLength(20));

export type WorkResources = typeof WorkResources.Type;

export const TaskAssignees = Schema.Array(WorkParticipant).check(Schema.isMaxLength(20));

/** A calendar day, `YYYY-MM-DD`, with no time zone. */
export const TaskDueDate = TrimmedNonEmptyString.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/));

export type TaskDueDate = typeof TaskDueDate.Type;

/** How a task repeats; completing it creates the next one with the next due date. */
export const TaskRepeat = Schema.Literals([
  "daily",
  "weekdays",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
]);

export type TaskRepeat = typeof TaskRepeat.Type;

export const TASK_REPEATS = TaskRepeat.literals;

/** Logged time, millisecond precision so start/stop timers can be added later. */
export const TaskTimeDuration = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(1000 * 60 * 60 * 1000),
);

export const TaskTimeEntryId = TrimmedNonEmptyString.check(Schema.isMaxLength(100));

/** One timesheet entry: someone logged this much time on a task, optionally saying on what. */
export const TaskTimeEntry = Schema.Struct({
  id: TaskTimeEntryId,
  taskId: TaskId,
  duration: TaskTimeDuration,
  description: TrimmedString.check(Schema.isMaxLength(500)),
  createdBy: AuthSessionId,
  createdAt: IsoDateTime,
});

export type TaskTimeEntry = typeof TaskTimeEntry.Type;

export const OrchestrationTask = Schema.Struct({
  id: TaskId,
  projectId: ProjectId,
  title: WorkTitle,
  description: WorkDescription.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  owner: Schema.NullOr(WorkParticipant),
  assignees: TaskAssignees,
  resources: WorkResources,
  dueDate: Schema.NullOr(TaskDueDate),
  repeat: Schema.NullOr(TaskRepeat).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  status: WorkStatus,
  timeEntries: Schema.Array(TaskTimeEntry).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export type OrchestrationTask = typeof OrchestrationTask.Type;

/** Who did something: a signed-in person or a bot. */
export const Actor = Schema.Union([
  Schema.Struct({ type: Schema.Literal("person"), id: AuthSessionId }),
  Schema.Struct({ type: Schema.Literal("bot"), id: BotId }),
]);

export type Actor = typeof Actor.Type;

export const TaskCreateCommand = Schema.Struct({
  type: Schema.Literal("task.create"),
  commandId: CommandId,
  taskId: TaskId,
  projectId: ProjectId,
  title: WorkTitle,
  description: Schema.optional(WorkDescription),
  owner: Schema.optional(Schema.NullOr(WorkParticipant)),
  assignees: Schema.optional(TaskAssignees),
  resources: Schema.optional(WorkResources),
  dueDate: Schema.optional(Schema.NullOr(TaskDueDate)),
  status: Schema.optional(WorkStatus),
  /** Otto: The bot acting, for commands the server dispatches; a person's command is theirs. */
  by: Schema.optional(Actor),
  createdAt: IsoDateTime,
});

/** Absent fields stay unchanged; null clears the owner, due date or repeat. */
export const TaskUpdateCommand = Schema.Struct({
  type: Schema.Literal("task.update"),
  commandId: CommandId,
  taskId: TaskId,
  projectId: Schema.optional(ProjectId),
  title: Schema.optional(WorkTitle),
  description: Schema.optional(WorkDescription),
  owner: Schema.optional(Schema.NullOr(WorkParticipant)),
  assignees: Schema.optional(TaskAssignees),
  resources: Schema.optional(WorkResources),
  dueDate: Schema.optional(Schema.NullOr(TaskDueDate)),
  repeat: Schema.optional(Schema.NullOr(TaskRepeat)),
  status: Schema.optional(WorkStatus),
  by: Schema.optional(Actor),
  /** The sender's IANA time zone; completing a repeating task counts the next due day from its today. */
  timezone: Schema.optional(TrimmedNonEmptyString),
});

/** The server records the person logging time as the entry's creator. */
export const TaskTimeAddCommand = Schema.Struct({
  type: Schema.Literal("task.time.add"),
  commandId: CommandId,
  taskId: TaskId,
  entryId: TaskTimeEntryId,
  duration: TaskTimeDuration,
  description: Schema.optional(TrimmedString.check(Schema.isMaxLength(500))),
  createdAt: IsoDateTime,
});

/** Only the person who logged an entry removes it. */
export const TaskTimeRemoveCommand = Schema.Struct({
  type: Schema.Literal("task.time.remove"),
  commandId: CommandId,
  taskId: TaskId,
  entryId: TaskTimeEntryId,
});

export const OrchestrationTaskTimeAddedPayload = Schema.Struct({
  task: OrchestrationTask,
  entry: TaskTimeEntry,
});

export const OrchestrationTaskTimeRemovedPayload = Schema.Struct({
  task: OrchestrationTask,
  entryId: TaskTimeEntryId,
});

/** What one task update changed, each field before and after. */
export const TaskChanges = Schema.Struct({
  title: Schema.optional(Schema.Struct({ from: WorkTitle, to: WorkTitle })),
  status: Schema.optional(Schema.Struct({ from: WorkStatus, to: WorkStatus })),
  owner: Schema.optional(
    Schema.Struct({ from: Schema.NullOr(WorkParticipant), to: Schema.NullOr(WorkParticipant) }),
  ),
  assignees: Schema.optional(Schema.Struct({ from: TaskAssignees, to: TaskAssignees })),
  dueDate: Schema.optional(
    Schema.Struct({ from: Schema.NullOr(TaskDueDate), to: Schema.NullOr(TaskDueDate) }),
  ),
  repeat: Schema.optional(
    Schema.Struct({ from: Schema.NullOr(TaskRepeat), to: Schema.NullOr(TaskRepeat) }),
  ),
  projectId: Schema.optional(Schema.Struct({ from: ProjectId, to: ProjectId })),
  resources: Schema.optional(Schema.Struct({ from: WorkResources, to: WorkResources })),
  /** Descriptions can be long, so only the fact that it changed is kept. */
  description: Schema.optional(Schema.Literal(true)),
});

export type TaskChanges = typeof TaskChanges.Type;

/** Events written before activity existed carry no actor. */
export const OrchestrationTaskCreatedPayload = Schema.Struct({
  task: OrchestrationTask,
  actor: Schema.optional(Actor),
});

export const OrchestrationTaskUpdatedPayload = Schema.Struct({
  task: OrchestrationTask,
  actor: Schema.optional(Actor),
  changes: Schema.optional(TaskChanges),
});

/** `bot:<botId>` or `person:<personId>`, the form participants take in URLs and filters. */
export const WorkParticipantKey = TrimmedNonEmptyString.check(
  Schema.isPattern(/^(bot|person):.+$/),
);

export type WorkParticipantKey = typeof WorkParticipantKey.Type;

export function workParticipantKey(participant: WorkParticipant): WorkParticipantKey {
  return participant.kind === "bot" ? `bot:${participant.botId}` : `person:${participant.personId}`;
}

/** Statuses travel as one comma list, `pending,in_progress`, in URLs and query strings. */
export const WorkStatusList = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Array(WorkStatus),
    SchemaTransformation.transform({
      decode: (list) =>
        // SAFETY: decodeTo validates each entry against WorkStatus right after this split.
        list.split(",").map((status) => status.trim()) as ReadonlyArray<WorkStatus>,
      encode: (statuses) => statuses.join(","),
    }),
  ),
);

const TaskListText = TrimmedNonEmptyString.check(Schema.isMaxLength(300));

/** Every field narrows the list; no `status` means everything except archived. */
export const TaskListFilter = Schema.Struct({
  project: Schema.optional(ProjectId),
  owner: Schema.optional(WorkParticipantKey),
  assignee: Schema.optional(WorkParticipantKey),
  status: Schema.optional(WorkStatusList),
  /** Inclusive calendar days; tasks without a due date never match either bound. */
  dueFrom: Schema.optional(TaskDueDate),
  dueTo: Schema.optional(TaskDueDate),
  /** Tasks whose title contains this text, ignoring case, as pickers match. */
  title: Schema.optional(TaskListText),
  /** Tasks whose title or description contains this text, ignoring case. */
  search: Schema.optional(TaskListText),
});

export type TaskListFilter = typeof TaskListFilter.Type;

/**
 * How the task list is ordered: by status (moving work first, newest change first within it),
 * due date (undated last), last change, creation or title. Each has a natural order that
 * `order` may reverse.
 */
export const TASK_LIST_SORTS = ["status", "due", "updated", "created", "title"] as const;

export const TaskListSort = Schema.Literals(TASK_LIST_SORTS);

export type TaskListSort = typeof TaskListSort.Type;

/** The filter and order the Tasks page keeps in its URL. */
export const TaskListView = Schema.Struct({
  ...TaskListFilter.fields,
  sort: Schema.optional(TaskListSort),
  order: Schema.optional(ListOrder),
});

export type TaskListView = typeof TaskListView.Type;

export const TaskListQuery = Schema.Struct({
  ...TaskListView.fields,
  limit: Schema.optional(ListLimit),
  cursor: Schema.optional(ListCursor),
});

export type TaskListQuery = typeof TaskListQuery.Type;

/** A task as lists show it, without its timesheet. */
export const TaskListItem = OrchestrationTask.mapFields(Struct.omit(["timeEntries"]));

export type TaskListItem = typeof TaskListItem.Type;

export const TaskListResult = Schema.Struct({
  tasks: Schema.Array(TaskListItem),
  nextCursor: Schema.NullOr(ListCursor),
  /** How many tasks match the filter in each status, across every page. */
  statusCounts: Schema.Array(Schema.Struct({ status: WorkStatus, count: Schema.Int })),
});

export type TaskListResult = typeof TaskListResult.Type;

export class TaskListError extends Schema.TaggedErrorClass<TaskListError>()("TaskListError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

export const TaskGetInput = Schema.Struct({ taskId: TaskId });

export type TaskGetInput = typeof TaskGetInput.Type;

export class TaskNotFoundError extends Schema.TaggedErrorClass<TaskNotFoundError>()(
  "TaskNotFoundError",
  { taskId: TaskId },
) {
  override get message(): string {
    return `Task ${this.taskId} was not found.`;
  }
}

export const ProjectListFilter = Schema.Struct({
  owner: Schema.optional(WorkParticipantKey),
  status: Schema.optional(WorkStatusList),
});

export type ProjectListFilter = typeof ProjectListFilter.Type;

/** How the project list is ordered: by last change, creation or title. */
export const PROJECT_LIST_SORTS = ["updated", "created", "title"] as const;

export const ProjectListSort = Schema.Literals(PROJECT_LIST_SORTS);

export type ProjectListSort = typeof ProjectListSort.Type;

/** The filter and order the Projects page keeps in its URL. */
export const ProjectListView = Schema.Struct({
  ...ProjectListFilter.fields,
  sort: Schema.optional(ProjectListSort),
  order: Schema.optional(ListOrder),
});

export type ProjectListView = typeof ProjectListView.Type;

export const ProjectListQuery = Schema.Struct({
  ...ProjectListView.fields,
  limit: Schema.optional(ListLimit),
  cursor: Schema.optional(ListCursor),
});

export type ProjectListQuery = typeof ProjectListQuery.Type;

export class ProjectListError extends Schema.TaggedErrorClass<ProjectListError>()(
  "ProjectListError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}
