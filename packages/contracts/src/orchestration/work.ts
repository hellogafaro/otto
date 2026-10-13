import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import {
  AuthSessionId,
  BotId,
  CommandId,
  IsoDateTime,
  ProjectId,
  TaskId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "../baseSchemas.ts";

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

export const WorkResource = Schema.Struct({
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  url: TrimmedNonEmptyString.check(Schema.isMaxLength(2048), Schema.isPattern(/^https?:\/\//i)),
});

export type WorkResource = typeof WorkResource.Type;

export const WorkTitle = TrimmedNonEmptyString.check(Schema.isMaxLength(300));

export const WorkDescription = TrimmedString.check(Schema.isMaxLength(10_000));

export const WorkResources = Schema.Array(WorkResource).check(Schema.isMaxLength(20));

export type WorkResources = typeof WorkResources.Type;

export const TaskAssignees = Schema.Array(WorkParticipant).check(Schema.isMaxLength(20));

/** A calendar day, `YYYY-MM-DD`, with no time zone. */
export const TaskDueDate = TrimmedNonEmptyString.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/));

export type TaskDueDate = typeof TaskDueDate.Type;

export const OrchestrationTask = Schema.Struct({
  id: TaskId,
  projectId: ProjectId,
  title: WorkTitle,
  description: WorkDescription.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  owner: Schema.NullOr(WorkParticipant),
  assignees: TaskAssignees,
  resources: WorkResources,
  dueDate: Schema.NullOr(TaskDueDate),
  status: WorkStatus,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export type OrchestrationTask = typeof OrchestrationTask.Type;

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
  createdAt: IsoDateTime,
});

/** Absent fields stay unchanged; null clears the owner or due date. */
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
  status: Schema.optional(WorkStatus),
});

export const OrchestrationTaskCreatedPayload = Schema.Struct({ task: OrchestrationTask });

export const OrchestrationTaskUpdatedPayload = Schema.Struct({ task: OrchestrationTask });

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

/** Every field narrows the list; no `status` means everything except archived. */
export const TaskListFilter = Schema.Struct({
  project: Schema.optional(ProjectId),
  owner: Schema.optional(WorkParticipantKey),
  assignee: Schema.optional(WorkParticipantKey),
  status: Schema.optional(WorkStatusList),
  /** Inclusive calendar days; tasks without a due date never match either bound. */
  dueFrom: Schema.optional(TaskDueDate),
  dueTo: Schema.optional(TaskDueDate),
});

export type TaskListFilter = typeof TaskListFilter.Type;

export const ProjectListFilter = Schema.Struct({
  owner: Schema.optional(WorkParticipantKey),
  status: Schema.optional(WorkStatusList),
});

export type ProjectListFilter = typeof ProjectListFilter.Type;

function matchesStatuses(status: WorkStatus, statuses: ReadonlyArray<WorkStatus> | undefined) {
  return statuses === undefined || statuses.length === 0
    ? status !== "archived"
    : statuses.includes(status);
}

export function matchesTaskFilter(task: OrchestrationTask, filter: TaskListFilter): boolean {
  if (filter.project !== undefined && task.projectId !== filter.project) return false;

  if (
    filter.owner !== undefined &&
    (task.owner === null || workParticipantKey(task.owner) !== filter.owner)
  ) {
    return false;
  }

  if (
    filter.assignee !== undefined &&
    !task.assignees.some((assignee) => workParticipantKey(assignee) === filter.assignee)
  ) {
    return false;
  }

  if (filter.dueTo !== undefined && (task.dueDate === null || task.dueDate > filter.dueTo)) {
    return false;
  }

  if (filter.dueFrom !== undefined && (task.dueDate === null || task.dueDate < filter.dueFrom)) {
    return false;
  }

  return matchesStatuses(task.status, filter.status);
}

/** Projects saved before planning fields existed count as in progress and unowned. */
export function matchesProjectFilter(
  project: {
    readonly owner?: WorkParticipant | null | undefined;
    readonly status?: WorkStatus | undefined;
  },
  filter: ProjectListFilter,
): boolean {
  if (
    filter.owner !== undefined &&
    (project.owner == null || workParticipantKey(project.owner) !== filter.owner)
  ) {
    return false;
  }

  return matchesStatuses(project.status ?? "in_progress", filter.status);
}
