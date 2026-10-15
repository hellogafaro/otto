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
        case "task.commented":
          yield* projectionTaskRepository.upsert(event.payload.task);

          return;
        case "task.time-added":
          yield* projectionTaskRepository.insertTimeEntry(event.payload.entry);
          yield* projectionTaskRepository.upsert(event.payload.task);

          return;
        case "task.time-removed":
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
