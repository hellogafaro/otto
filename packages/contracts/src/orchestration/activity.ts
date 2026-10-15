import * as Schema from "effect/Schema";
import {
  CommandId,
  IsoDateTime,
  TaskId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "../base-schemas.ts";
import { LibraryFileId } from "./library.ts";
import { Actor, OrchestrationTask, TaskChanges, TaskTimeDuration } from "./work.ts";

/** What an activity entry is about; new entity types join this list. */
export const ActivityEntityType = Schema.Literals(["task"]);

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

/** One line of an entity's timeline: a comment, or something that happened to the entity. */
export const ActivityEntry = Schema.Union([
  Schema.Struct({
    ...ActivityEntryFields,
    type: Schema.Literal("comment"),
    content: ActivityContent,
    fileIds: ActivityFileIds,
  }),
  Schema.Struct({ ...ActivityEntryFields, type: Schema.Literal("created") }),
  Schema.Struct({ ...ActivityEntryFields, type: Schema.Literal("changed"), changes: TaskChanges }),
  Schema.Struct({
    ...ActivityEntryFields,
    type: Schema.Literal("time_logged"),
    duration: TaskTimeDuration,
    description: TrimmedString.check(Schema.isMaxLength(500)),
  }),
]);

export type ActivityEntry = typeof ActivityEntry.Type;

export const ActivityEntity = Schema.Struct({
  entityType: ActivityEntityType,
  entityId: ActivityEntityId,
});

export const ActivityListResult = Schema.Struct({ entries: Schema.Array(ActivityEntry) });

export const ActivityCommentAddInput = Schema.Struct({
  entityType: ActivityEntityType,
  entityId: ActivityEntityId,
  content: ActivityContent,
  fileIds: Schema.optional(ActivityFileIds),
});

/**
 * Otto: A comment on a task, by a person (the RPC) or a bot (its tools), dispatched by the
 * server so every viewer's timeline refreshes. `by` is who wrote it.
 */
export const TaskCommentAddCommand = Schema.Struct({
  type: Schema.Literal("task.comment.add"),
  commandId: CommandId,
  taskId: TaskId,
  commentId: ActivityEntryId,
  content: ActivityContent,
  fileIds: ActivityFileIds,
  by: Actor,
  createdAt: IsoDateTime,
});

/** The task with its updated time moved to the comment's, and the comment. */
export const OrchestrationTaskCommentedPayload = Schema.Struct({
  task: OrchestrationTask,
  comment: Schema.Struct({
    id: ActivityEntryId,
    content: ActivityContent,
    fileIds: ActivityFileIds,
    actor: Actor,
    createdAt: IsoDateTime,
  }),
});

export const ActivityCommentRemoveInput = Schema.Struct({ id: ActivityEntryId });

export class ActivityRequestError extends Schema.TaggedErrorClass<ActivityRequestError>()(
  "ActivityRequestError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}
