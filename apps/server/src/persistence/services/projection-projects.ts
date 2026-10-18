/**
 * ProjectionProjectRepository - Projection repository interface for projects.
 *
 * Owns persistence operations for project rows in the orchestration projection
 * read model.
 *
 * @module ProjectionProjectRepository
 */
import {
  IsoDateTime,
  ModelSelection,
  ProjectId,
  type ProjectListItem,
  type ProjectListQuery,
  ProjectScript,
  ThreadEnvMode,
  WorkDescription,
  WorkParticipant,
  WorkResources,
  WorkStatus,
  LibraryFileId,
} from "@otto/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../errors.ts";

export const ProjectionProject = Schema.Struct({
  projectId: ProjectId,
  title: Schema.String,
  workspaceRoot: Schema.String,
  defaultModelSelection: Schema.NullOr(ModelSelection),
  defaultThreadEnvMode: Schema.NullOr(ThreadEnvMode),
  faviconPath: Schema.optional(Schema.NullOr(Schema.String)),
  scripts: Schema.Array(ProjectScript),
  // Null on rows projected before planning fields existed.
  description: Schema.optional(Schema.NullOr(WorkDescription)),
  owner: Schema.optional(Schema.NullOr(WorkParticipant)),
  resources: Schema.optional(Schema.NullOr(WorkResources)),
  status: Schema.optional(Schema.NullOr(WorkStatus)),
  coverFileId: Schema.optional(Schema.NullOr(LibraryFileId)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});

export type ProjectionProject = typeof ProjectionProject.Type;

export const GetProjectionProjectInput = Schema.Struct({
  projectId: ProjectId,
});

export type GetProjectionProjectInput = typeof GetProjectionProjectInput.Type;

export const DeleteProjectionProjectInput = Schema.Struct({
  projectId: ProjectId,
});

export type DeleteProjectionProjectInput = typeof DeleteProjectionProjectInput.Type;

/**
 * ProjectionProjectRepositoryShape - Service API for projected project records.
 */
export interface ProjectionProjectRepositoryShape {
  /**
   * Insert or replace a projected project row.
   *
   * Upserts by `projectId` and persists scripts through JSON encoding.
   */
  readonly upsert: (row: ProjectionProject) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Read a projected project row by id.
   */
  readonly getById: (
    input: GetProjectionProjectInput,
  ) => Effect.Effect<Option.Option<ProjectionProject>, ProjectionRepositoryError>;

  /**
   * List all projected project rows.
   *
   * Returned in deterministic creation order.
   */
  readonly listAll: () => Effect.Effect<
    ReadonlyArray<ProjectionProject>,
    ProjectionRepositoryError
  >;

  /**
   * One page of projects matching the query's filter in its order, strictly after `after`, with
   * one row more than the limit when another page follows. Each row's key holds the values of
   * its sort expressions, the project id last.
   */
  readonly list: (input: {
    readonly query: ProjectListQuery;
    readonly limit: number;
    readonly after: ReadonlyArray<string | number> | null;
  }) => Effect.Effect<
    ReadonlyArray<{
      readonly project: ProjectListItem;
      readonly key: ReadonlyArray<string | number>;
    }>,
    ProjectionRepositoryError
  >;

  /**
   * Soft-delete a projected project row by id.
   */
  readonly deleteById: (
    input: DeleteProjectionProjectInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

/**
 * ProjectionProjectRepository - Service tag for project projection persistence.
 */
export class ProjectionProjectRepository extends Context.Service<
  ProjectionProjectRepository,
  ProjectionProjectRepositoryShape
>()("@otto/server/persistence/services/projection-projects/ProjectionProjectRepository") {}
