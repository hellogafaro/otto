import * as Effect from "effect/Effect";
import type * as SqlError from "effect/unstable/sql/SqlError";
import { insertActivityRow } from "../../../activity/activity-store.ts";
import { toPersistenceSqlError } from "../../../persistence/errors.ts";
import { type ProjectionDependencies, type ProjectorDefinition } from "./definitions.ts";

/**
 * Writes what happened to a task, and its comments, into its timeline. Edits and deletions add a
 * line that keeps what was there before; a deleted task leaves one line on its project.
 */
export function createActivity({ sql }: Pick<ProjectionDependencies, "sql">) {
  const applyActivityProjection: ProjectorDefinition["apply"] = Effect.fn(
    "applyActivityProjection",
  )(function* (event, _attachmentSideEffects) {
    const write = (row: Parameters<typeof insertActivityRow>[1]) =>
      insertActivityRow(sql, row).pipe(
        Effect.mapError(toPersistenceSqlError("ProjectionPipeline.activity:insert")),
      );

    const run = (statement: Effect.Effect<unknown, SqlError.SqlError>, label: string) =>
      statement.pipe(Effect.asVoid, Effect.mapError(toPersistenceSqlError(label)));

    switch (event.type) {
      case "task.created":
        return yield* write({
          id: event.eventId,
          entityType: "task",
          entityId: event.payload.task.id,
          type: "created",
          actor: event.payload.actor ?? null,
          content: "",
          data: {},
          createdAt: event.payload.task.createdAt,
        });
      case "task.updated": {
        const changes = event.payload.changes;

        if (changes === undefined || Object.keys(changes).length === 0) return;

        return yield* write({
          id: event.eventId,
          entityType: "task",
          entityId: event.payload.task.id,
          type: "changed",
          actor: event.payload.actor ?? null,
          content: "",
          data: { changes },
          createdAt: event.occurredAt,
        });
      }

      case "task.deleted":
        yield* run(
          sql`DELETE FROM activity WHERE entity_type = 'task' AND entity_id = ${event.payload.taskId}`,
          "ProjectionPipeline.activity:task-deleted",
        );

        return yield* write({
          id: event.eventId,
          entityType: "project",
          entityId: event.payload.projectId,
          type: "task_deleted",
          actor: event.payload.actor ?? null,
          content: "",
          data: { taskId: event.payload.taskId, title: event.payload.title },
          createdAt: event.payload.deletedAt,
        });

      case "task.time-created": {
        const entry = event.payload.entry;

        return yield* write({
          id: entry.id,
          entityType: "task",
          entityId: entry.taskId,
          type: "time_logged",
          actor: entry.createdBy,
          content: "",
          data: {
            duration: entry.duration,
            description: entry.description,
            personId: entry.personId,
            date: entry.date,
          },
          createdAt: entry.createdAt,
        });
      }

      case "task.time-deleted": {
        const entry = event.payload.entry;

        // Otto: deletions saved before the history kept them hid the logged line instead.
        if (entry === undefined) {
          return yield* run(
            sql`
              UPDATE activity SET deleted_at = ${event.occurredAt}
              WHERE id = ${event.payload.entryId} AND type = 'time_logged'
            `,
            "ProjectionPipeline.activity:time-deleted",
          );
        }

        return yield* write({
          id: event.eventId,
          entityType: "task",
          entityId: entry.taskId,
          type: "time_deleted",
          actor: event.payload.actor ?? null,
          content: "",
          data: {
            duration: entry.duration,
            description: entry.description,
            personId: entry.personId,
            date: entry.date,
          },
          createdAt: event.occurredAt,
        });
      }

      case "task.comment-created": {
        const comment = event.payload.comment;

        return yield* write({
          id: comment.id,
          entityType: "task",
          entityId: event.payload.task.id,
          type: "comment",
          actor: comment.actor,
          content: comment.content,
          data: { fileIds: comment.fileIds },
          createdAt: comment.createdAt,
        });
      }

      case "task.comment-updated": {
        const comment = event.payload.comment;

        yield* run(
          sql`
            UPDATE activity SET content = ${comment.content}, updated_at = ${comment.updatedAt}
            WHERE id = ${comment.id} AND type = 'comment'
          `,
          "ProjectionPipeline.activity:comment-updated",
        );

        return yield* write({
          id: event.eventId,
          entityType: "task",
          entityId: event.payload.task.id,
          type: "comment_updated",
          actor: comment.actor,
          content: comment.previousContent,
          data: { commentId: comment.id },
          createdAt: comment.updatedAt,
        });
      }

      case "task.comment-deleted": {
        const comment = event.payload.comment;

        yield* run(
          sql`
            UPDATE activity SET deleted_at = ${comment.deletedAt}
            WHERE id = ${comment.id} AND type = 'comment'
          `,
          "ProjectionPipeline.activity:comment-deleted",
        );

        return yield* write({
          id: event.eventId,
          entityType: "task",
          entityId: event.payload.task.id,
          type: "comment_deleted",
          actor: comment.actor,
          content: comment.content,
          data: { commentId: comment.id },
          createdAt: comment.deletedAt,
        });
      }

      default:
        return;
    }
  });

  return { applyActivityProjection };
}
