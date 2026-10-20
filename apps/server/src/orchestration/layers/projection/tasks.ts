import * as Effect from "effect/Effect";
import { type ProjectionDependencies, type ProjectorDefinition } from "./definitions.ts";

export function createTasks({
  projectionTaskRepository,
}: Pick<ProjectionDependencies, "projectionTaskRepository">) {
  const applyTasksProjection: ProjectorDefinition["apply"] = Effect.fn("applyTasksProjection")(
    function* (event, _attachmentSideEffects) {
      switch (event.type) {
        case "task.created":
        case "task.updated":
        case "task.comment-created":
        case "task.comment-updated":
        case "task.comment-deleted":
          yield* projectionTaskRepository.upsert(event.payload.task);

          return;
        case "task.deleted":
          yield* projectionTaskRepository.delete(event.payload.taskId);

          return;
        case "task.time-created":
          yield* projectionTaskRepository.insertTimeEntry(event.payload.entry);
          yield* projectionTaskRepository.upsert(event.payload.task);

          return;
        case "task.time-deleted":
          yield* projectionTaskRepository.deleteTimeEntry(event.payload.entryId);
          yield* projectionTaskRepository.upsert(event.payload.task);

          return;
        default:
          return;
      }
    },
  );

  return { applyTasksProjection };
}
