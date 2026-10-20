import * as NodeCrypto from "node:crypto";

import {
  type Actor,
  ActivityRequestError,
  CommandId,
  type OrchestrationCommand,
  TaskId,
} from "@otto/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import type { ActivityStore } from "../activity/activity-store.ts";

interface TaskCommentServices {
  readonly activityStore: ActivityStore["Service"];
  readonly dispatch: (
    command: OrchestrationCommand,
  ) => Effect.Effect<unknown, { readonly message: string }>;
}

const failed = (error: { readonly message: string }) =>
  new ActivityRequestError({ detail: error.message });

/** Why a comment change was refused: there is no such comment, or someone else wrote it. */
export const NOT_AUTHOR = "Only the person or bot who wrote this comment can edit it.";

const sameActor = (left: Actor | null, right: Actor) =>
  left !== null && left.type === right.type && left.id === right.id;

/**
 * Otto: Replaces the text of a comment `by` wrote, for people and bots alike. The history keeps
 * the text it replaced.
 */
export const updateTaskComment = (
  input: { readonly id: string; readonly content: string; readonly by: Actor },
  services: TaskCommentServices,
) =>
  Effect.gen(function* () {
    const comment = yield* services.activityStore.getComment(input.id);

    if (comment.type !== "comment" || comment.entityType !== "task") {
      return yield* new ActivityRequestError({ detail: "That comment doesn't exist." });
    }

    if (!sameActor(comment.actor, input.by)) {
      return yield* new ActivityRequestError({ detail: NOT_AUTHOR });
    }

    if (input.content.length === 0 && comment.fileIds.length === 0) {
      return yield* new ActivityRequestError({ detail: "A comment needs text or a file." });
    }

    yield* services
      .dispatch({
        type: "task.comment.update",
        commandId: CommandId.make(`comment-update:${NodeCrypto.randomUUID()}`),
        taskId: TaskId.make(comment.entityId),
        commentId: comment.id,
        content: input.content,
        previousContent: comment.content,
        by: input.by,
        updatedAt: DateTime.formatIso(yield* DateTime.now),
      })
      .pipe(Effect.mapError(failed));

    return yield* services.activityStore.getComment(comment.id);
  });

/** Otto: Deletes any comment on a task, whoever wrote it; the history keeps its text. */
export const deleteTaskComment = (
  input: { readonly id: string; readonly by: Actor },
  services: TaskCommentServices,
) =>
  Effect.gen(function* () {
    const comment = yield* services.activityStore.getComment(input.id);

    if (comment.type !== "comment" || comment.entityType !== "task") {
      return yield* new ActivityRequestError({ detail: "That comment doesn't exist." });
    }

    yield* services
      .dispatch({
        type: "task.comment.delete",
        commandId: CommandId.make(`comment-delete:${NodeCrypto.randomUUID()}`),
        taskId: TaskId.make(comment.entityId),
        commentId: comment.id,
        content: comment.content,
        by: input.by,
        deletedAt: DateTime.formatIso(yield* DateTime.now),
      })
      .pipe(Effect.mapError(failed));

    return { taskId: comment.entityId, commentId: comment.id };
  });
