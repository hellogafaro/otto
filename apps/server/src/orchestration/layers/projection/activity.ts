import * as Effect from "effect/Effect";
import { insertActivityRow } from "../../../activity/activity-store.ts";
import { toPersistenceSqlError } from "../../../persistence/errors.ts";
import { type ProjectionDependencies, type ProjectorDefinition } from "./definitions.ts";

/** Writes what happened to a task, and its comments, into its timeline. */
export function createActivity({ sql }: Pick<ProjectionDependencies, "sql">) {
  const applyActivityProjection: ProjectorDefinition["apply"] = Effect.fn(
    "applyActivityProjection",
  )(function* (event, _attachmentSideEffects) {
    const write = (row: Parameters<typeof insertActivityRow>[1]) =>
      insertActivityRow(sql, row).pipe(
        Effect.mapError(toPersistenceSqlError("ProjectionPipeline.activity:insert")),
      );

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

      case "task.time-added": {
        const entry = event.payload.entry;

        return yield* write({
          id: entry.id,
          entityType: "task",
          entityId: entry.taskId,
          type: "time_logged",
          actor: { type: "person", id: entry.createdBy },
          content: "",
          data: { duration: entry.duration, description: entry.description },
          createdAt: entry.createdAt,
        });
      }

      case "task.commented": {
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

      case "task.time-removed":
        return yield* sql`
          UPDATE activity SET deleted_at = ${event.occurredAt}
          WHERE id = ${event.payload.entryId} AND type = 'time_logged'
        `.pipe(
          Effect.asVoid,
          Effect.mapError(toPersistenceSqlError("ProjectionPipeline.activity:time-removed")),
        );
      default:
        return;
    }
  });

  return { applyActivityProjection };
}
