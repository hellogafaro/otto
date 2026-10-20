/** Planning task projection persistence. */
import {
  type AuthSessionId,
  OrchestrationTask,
  type ProjectId,
  type TaskDueDate,
  type TaskListItem,
  type TaskListQuery,
  type TaskId,
  type TaskListResult,
  type TaskTimeEntry,
} from "@otto/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";

import type { ProjectionRepositoryError } from "../errors.ts";

export const ProjectionTask = OrchestrationTask;

export type ProjectionTask = typeof ProjectionTask.Type;

/** A row's sort key: the values of its sort expressions, the task id last. */
export type TaskListKey = ReadonlyArray<string | number>;

/** A time entry's sort key: the day worked, when it was logged, then its id. */
export type TimeEntryListKey = ReadonlyArray<string | number>;

/** Time entries on one task, by one person, in one project or between two days, inclusive. */
export interface TimeEntryFilter {
  readonly taskId?: string | undefined;
  readonly personId?: AuthSessionId | undefined;
  readonly projectId?: ProjectId | undefined;
  readonly from?: TaskDueDate | undefined;
  readonly to?: TaskDueDate | undefined;
}

export interface ProjectionTaskRepositoryShape {
  readonly upsert: (row: ProjectionTask) => Effect.Effect<void, ProjectionRepositoryError>;
  /** Tasks with their timesheet entries, oldest entry first. */
  readonly listAll: () => Effect.Effect<ReadonlyArray<ProjectionTask>, ProjectionRepositoryError>;
  /** One task with its timesheet entries, oldest entry first. */
  readonly get: (
    taskId: TaskId,
  ) => Effect.Effect<Option.Option<ProjectionTask>, ProjectionRepositoryError>;
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
  /** Removes a task and its time entries. */
  readonly delete: (taskId: TaskId) => Effect.Effect<void, ProjectionRepositoryError>;
  /**
   * One page of time entries matching the filter, newest first, strictly after `after`, with one
   * row more than the limit when another page follows, and the total of every matching entry.
   */
  readonly listTimeEntries: (input: {
    readonly filter: TimeEntryFilter;
    readonly limit: number;
    readonly after: TimeEntryListKey | null;
  }) => Effect.Effect<
    {
      readonly rows: ReadonlyArray<{
        readonly entry: TaskTimeEntry;
        readonly key: TimeEntryListKey;
      }>;
      readonly totalDuration: number;
    },
    ProjectionRepositoryError
  >;
}

export class ProjectionTaskRepository extends Context.Service<
  ProjectionTaskRepository,
  ProjectionTaskRepositoryShape
>()("@otto/server/persistence/services/projection-tasks/ProjectionTaskRepository") {}
