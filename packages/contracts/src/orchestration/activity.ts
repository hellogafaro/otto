import * as Schema from "effect/Schema";
import {
  AuthSessionId,
  CommandId,
  IsoDateTime,
  TaskId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "../base-schemas.ts";
import { LibraryFileId } from "./library.ts";
import {
  Actor,
  OrchestrationTask,
  TaskChanges,
  TaskDueDate,
  TaskTimeDuration,
  WorkTitle,
} from "./work.ts";

/** What an activity entry is about: a task, or a project for the tasks deleted from it. */
export const ActivityEntityType = Schema.Literals(["task", "project"]);

export type ActivityEntityType = typeof ActivityEntityType.Type;

export const ActivityEntityId = TrimmedNonEmptyString.check(Schema.isMaxLength(200));

export const ActivityEntryId = TrimmedNonEmptyString.check(Schema.isMaxLength(100));

/**
 * Comment text. Mentions are inline tags, `<mention type="person" id="…">Ana</mention>`;
 * other `<`, `>` and `&` are escaped. Empty only when the comment carries files.
 */
export const ActivityContent = TrimmedString.check(Schema.isMaxLength(20_000));

export const ActivityFileIds = Schema.Array(LibraryFileId).check(Schema.isMaxLength(10));

const ActivityEntryFields = {
  id: ActivityEntryId,
  entityType: ActivityEntityType,
  entityId: ActivityEntityId,
  /** Null for entries recorded before the actor was kept. */
  actor: Schema.NullOr(Actor),
  createdAt: IsoDateTime,
};

const TimeEntryFields = {
  duration: TaskTimeDuration,
  description: TrimmedString.check(Schema.isMaxLength(500)),
  /** Whose time it is and the day it was worked; absent on entries logged before either was kept. */
  personId: Schema.optional(AuthSessionId),
  date: Schema.optional(TaskDueDate),
};

/**
 * One line of an entity's timeline: a comment, or something that happened to the entity. The
 * history keeps a comment's earlier text when it is edited or deleted, and a time entry's values
 * when it is deleted.
 */
export const ActivityEntry = Schema.Union([
  Schema.Struct({
    ...ActivityEntryFields,
    type: Schema.Literal("comment"),
    content: ActivityContent,
    fileIds: ActivityFileIds,
    /** When its author last edited it. */
    updatedAt: Schema.optional(IsoDateTime),
  }),
  Schema.Struct({ ...ActivityEntryFields, type: Schema.Literal("created") }),
  Schema.Struct({ ...ActivityEntryFields, type: Schema.Literal("changed"), changes: TaskChanges }),
  Schema.Struct({
    ...ActivityEntryFields,
    type: Schema.Literal("time_logged"),
    ...TimeEntryFields,
  }),
  Schema.Struct({
    ...ActivityEntryFields,
    type: Schema.Literal("time_deleted"),
    ...TimeEntryFields,
  }),
  Schema.Struct({
    ...ActivityEntryFields,
    type: Schema.Literal("comment_updated"),
    commentId: ActivityEntryId,
    previousContent: ActivityContent,
  }),
  Schema.Struct({
    ...ActivityEntryFields,
    type: Schema.Literal("comment_deleted"),
    commentId: ActivityEntryId,
    content: ActivityContent,
  }),
  Schema.Struct({
    ...ActivityEntryFields,
    type: Schema.Literal("task_deleted"),
    taskId: TaskId,
    title: WorkTitle,
  }),
]);

export type ActivityEntry = typeof ActivityEntry.Type;

export const ActivityEntity = Schema.Struct({
  entityType: ActivityEntityType,
  entityId: ActivityEntityId,
});

export const ActivityListResult = Schema.Struct({ entries: Schema.Array(ActivityEntry) });

export const ActivityCommentCreateInput = Schema.Struct({
  entityType: ActivityEntityType,
  entityId: ActivityEntityId,
  content: ActivityContent,
  fileIds: Schema.optional(ActivityFileIds),
});

/**
 * Otto: A comment on a task, by a person (the RPC) or a bot (its tools), dispatched by the
 * server so every viewer's timeline refreshes. `by` is who wrote it.
 */
export const TaskCommentCreateCommand = Schema.Struct({
  type: Schema.Literal("task.comment.create"),
  commandId: CommandId,
  taskId: TaskId,
  commentId: ActivityEntryId,
  content: ActivityContent,
  fileIds: ActivityFileIds,
  by: Actor,
  createdAt: IsoDateTime,
});

/**
 * Otto: Replaces a comment's text. The server checks first that `by` wrote it, then sends the
 * text it replaces as `previousContent` for the history.
 */
export const TaskCommentUpdateCommand = Schema.Struct({
  type: Schema.Literal("task.comment.update"),
  commandId: CommandId,
  taskId: TaskId,
  commentId: ActivityEntryId,
  content: ActivityContent,
  previousContent: ActivityContent,
  by: Actor,
  updatedAt: IsoDateTime,
});

/** Otto: Deletes any comment on a task; `content` is the deleted text, kept in the history. */
export const TaskCommentDeleteCommand = Schema.Struct({
  type: Schema.Literal("task.comment.delete"),
  commandId: CommandId,
  taskId: TaskId,
  commentId: ActivityEntryId,
  content: ActivityContent,
  by: Actor,
  deletedAt: IsoDateTime,
});

/** The task with its updated time moved to the comment's, and the comment. */
export const OrchestrationTaskCommentCreatedPayload = Schema.Struct({
  task: OrchestrationTask,
  comment: Schema.Struct({
    id: ActivityEntryId,
    content: ActivityContent,
    fileIds: ActivityFileIds,
    actor: Actor,
    createdAt: IsoDateTime,
  }),
});

export const OrchestrationTaskCommentUpdatedPayload = Schema.Struct({
  task: OrchestrationTask,
  comment: Schema.Struct({
    id: ActivityEntryId,
    content: ActivityContent,
    previousContent: ActivityContent,
    actor: Actor,
    updatedAt: IsoDateTime,
  }),
});

export const OrchestrationTaskCommentDeletedPayload = Schema.Struct({
  task: OrchestrationTask,
  comment: Schema.Struct({
    id: ActivityEntryId,
    content: ActivityContent,
    actor: Actor,
    deletedAt: IsoDateTime,
  }),
});

export const ActivityCommentUpdateInput = Schema.Struct({
  id: ActivityEntryId,
  content: ActivityContent,
});

export const ActivityCommentDeleteInput = Schema.Struct({ id: ActivityEntryId });

export class ActivityRequestError extends Schema.TaggedErrorClass<ActivityRequestError>()(
  "ActivityRequestError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}
