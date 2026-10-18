/** Planning task projection persistence. */
import {
  OrchestrationTask,
  type TaskListItem,
  type TaskListQuery,
  type TaskListResult,
  type TaskTimeEntry,
} from "@otto/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../errors.ts";

export const ProjectionTask = OrchestrationTask;

export type ProjectionTask = typeof ProjectionTask.Type;

/** A row's sort key: the values of its sort expressions, the task id last. */
export type TaskListKey = ReadonlyArray<string | number>;

export interface ProjectionTaskRepositoryShape {
  readonly upsert: (row: ProjectionTask) => Effect.Effect<void, ProjectionRepositoryError>;
  /** Tasks with their timesheet entries, oldest entry first. */
  readonly listAll: () => Effect.Effect<ReadonlyArray<ProjectionTask>, ProjectionRepositoryError>;
  /**
   * One page of tasks matching the query's filter in its order, strictly after `after`, with
   * one row more than the limit when another page follows, and the filter's status counts.
   */
  readonly list: (input: {
    readonly query: TaskListQuery;
    readonly limit: number;
    readonly after: TaskListKey | null;
  }) => Effect.Effect<
    {
      readonly rows: ReadonlyArray<{ readonly task: TaskListItem; readonly key: TaskListKey }>;
      readonly statusCounts: TaskListResult["statusCounts"];
    },
    ProjectionRepositoryError
  >;
  readonly insertTimeEntry: (
    entry: TaskTimeEntry,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly deleteTimeEntry: (entryId: string) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionTaskRepository extends Context.Service<
  ProjectionTaskRepository,
  ProjectionTaskRepositoryShape
>()("@otto/server/persistence/services/projection-tasks/ProjectionTaskRepository") {}
