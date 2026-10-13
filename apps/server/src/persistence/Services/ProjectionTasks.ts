/** Planning task projection persistence. */
import { OrchestrationTask, type TaskTimeEntry } from "@otto/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionTask = OrchestrationTask;

export type ProjectionTask = typeof ProjectionTask.Type;

export interface ProjectionTaskRepositoryShape {
  readonly upsert: (row: ProjectionTask) => Effect.Effect<void, ProjectionRepositoryError>;
  /** Tasks with their timesheet entries, oldest entry first. */
  readonly listAll: () => Effect.Effect<ReadonlyArray<ProjectionTask>, ProjectionRepositoryError>;
  readonly insertTimeEntry: (
    entry: TaskTimeEntry,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly deleteTimeEntry: (entryId: string) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionTaskRepository extends Context.Service<
  ProjectionTaskRepository,
  ProjectionTaskRepositoryShape
>()("@otto/server/persistence/Services/ProjectionTasks/ProjectionTaskRepository") {}
