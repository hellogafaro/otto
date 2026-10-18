import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

import {
  GENERAL_PROJECT_ID,
  ModelSelection,
  ProjectListItem,
  type ProjectListQuery,
  type ProjectListSort,
  ProjectScript,
  WorkParticipant,
  WorkResources,
} from "@otto/contracts";
import { toPersistenceSqlError } from "../errors.ts";
import { type ListSortSql, listPageSql, participantKeySql } from "../list-sql.ts";
import {
  DeleteProjectionProjectInput,
  GetProjectionProjectInput,
  ProjectionProject,
  ProjectionProjectRepository,
  type ProjectionProjectRepositoryShape,
} from "../services/projection-projects.ts";

const ProjectionProjectDbRow = ProjectionProject.mapFields(
  Struct.assign({
    defaultModelSelection: Schema.NullOr(Schema.fromJsonString(ModelSelection)),
    scripts: Schema.fromJsonString(Schema.Array(ProjectScript)),
    owner: Schema.optional(Schema.NullOr(Schema.fromJsonString(WorkParticipant))),
    resources: Schema.optional(Schema.NullOr(Schema.fromJsonString(WorkResources))),
  }),
);

type ProjectionProjectDbRow = typeof ProjectionProjectDbRow.Type;

const ProjectListDbRow = ProjectListItem.mapFields(
  Struct.assign({
    owner: Schema.NullOr(Schema.fromJsonString(WorkParticipant)),
    sortKey: Schema.fromJsonString(Schema.Array(Schema.Union([Schema.String, Schema.Number]))),
  }),
);

/** Each sort's natural order and its keys; the project id breaks ties so every row has a place. */
const PROJECT_SORTS: Record<ProjectListSort, ListSortSql> = {
  updated: {
    natural: "desc",
    keys: [
      { sql: "updated_at", direction: "desc" },
      { sql: "project_id", direction: "desc" },
    ],
  },
  created: {
    natural: "desc",
    keys: [
      { sql: "created_at", direction: "desc" },
      { sql: "project_id", direction: "desc" },
    ],
  },
  title: {
    natural: "asc",
    keys: [
      { sql: "lower(title)", direction: "asc" },
      { sql: "project_id", direction: "asc" },
    ],
  },
};

/**
 * The filter as SQL conditions and their parameters. The list never holds deleted projects or
 * the General project; no status means everything but archived, and a project saved before
 * statuses existed counts as in progress.
 */
function projectFilterSql(query: ProjectListQuery) {
  const conditions = ["deleted_at IS NULL", "project_id <> ?"];
  const params: Array<string | number> = [GENERAL_PROJECT_ID];

  if (query.owner !== undefined) {
    conditions.push(`owner_json IS NOT NULL AND ${participantKeySql("owner_json")} = ?`);
    params.push(query.owner);
  }

  if (query.status !== undefined && query.status.length > 0) {
    conditions.push(
      `COALESCE(status, 'in_progress') IN (${query.status.map(() => "?").join(", ")})`,
    );
    params.push(...query.status);
  } else {
    conditions.push("COALESCE(status, 'in_progress') <> 'archived'");
  }

  return { conditions, params };
}

const makeProjectionProjectRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionProjectRow = SqlSchema.void({
    Request: ProjectionProject,
    execute: (row) =>
      sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          default_thread_env_mode,
          favicon_path,
          scripts_json,
          description,
          owner_json,
          resources_json,
          status,
          cover_file_id,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          ${row.projectId},
          ${row.title},
          ${row.workspaceRoot},
          ${row.defaultModelSelection !== null ? JSON.stringify(row.defaultModelSelection) : null},
          ${row.defaultThreadEnvMode},
          ${row.faviconPath ?? null},
          ${JSON.stringify(row.scripts)},
          ${row.description ?? null},
          ${row.owner != null ? JSON.stringify(row.owner) : null},
          ${row.resources != null ? JSON.stringify(row.resources) : null},
          ${row.status ?? null},
          ${row.coverFileId ?? null},
          ${row.createdAt},
          ${row.updatedAt},
          ${row.deletedAt}
        )
        ON CONFLICT (project_id)
        DO UPDATE SET
          title = excluded.title,
          workspace_root = excluded.workspace_root,
          default_model_selection_json = excluded.default_model_selection_json,
          default_thread_env_mode = excluded.default_thread_env_mode,
          favicon_path = excluded.favicon_path,
          scripts_json = excluded.scripts_json,
          description = excluded.description,
          owner_json = excluded.owner_json,
          resources_json = excluded.resources_json,
          status = excluded.status,
          cover_file_id = excluded.cover_file_id,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          deleted_at = excluded.deleted_at
      `,
  });

  const getProjectionProjectRow = SqlSchema.findOneOption({
    Request: GetProjectionProjectInput,
    Result: ProjectionProjectDbRow,
    execute: ({ projectId }) =>
      sql`
        SELECT
          project_id AS "projectId",
          title,
          workspace_root AS "workspaceRoot",
          default_model_selection_json AS "defaultModelSelection",
          default_thread_env_mode AS "defaultThreadEnvMode",
          favicon_path AS "faviconPath",
          scripts_json AS "scripts",
          description,
          owner_json AS "owner",
          resources_json AS "resources",
          status,
          cover_file_id AS "coverFileId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_projects
        WHERE project_id = ${projectId}
      `,
  });

  const listProjectionProjectRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionProjectDbRow,
    execute: () =>
      sql`
        SELECT
          project_id AS "projectId",
          title,
          workspace_root AS "workspaceRoot",
          default_model_selection_json AS "defaultModelSelection",
          default_thread_env_mode AS "defaultThreadEnvMode",
          favicon_path AS "faviconPath",
          scripts_json AS "scripts",
          description,
          owner_json AS "owner",
          resources_json AS "resources",
          status,
          cover_file_id AS "coverFileId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_projects
        ORDER BY created_at ASC, project_id ASC
      `,
  });

  const deleteProjectionProjectRow = SqlSchema.void({
    Request: DeleteProjectionProjectInput,
    execute: ({ projectId }) =>
      sql`
        DELETE FROM projection_projects
        WHERE project_id = ${projectId}
      `,
  });

  const upsert: ProjectionProjectRepositoryShape["upsert"] = (row) =>
    upsertProjectionProjectRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionProjectRepository.upsert:query")),
    );

  const getById: ProjectionProjectRepositoryShape["getById"] = (input) =>
    getProjectionProjectRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionProjectRepository.getById:query")),
    );

  const listAll: ProjectionProjectRepositoryShape["listAll"] = () =>
    listProjectionProjectRows().pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionProjectRepository.listAll:query")),
    );

  const list: ProjectionProjectRepositoryShape["list"] = ({ query, limit, after }) => {
    const page = listPageSql(PROJECT_SORTS[query.sort ?? "updated"], query.order, after);
    const filter = projectFilterSql(query);

    const conditions = page.after
      ? [...filter.conditions, page.after.condition]
      : filter.conditions;

    const params = page.after ? [...filter.params, ...page.after.params] : filter.params;

    const rows = SqlSchema.findAll({
      Request: Schema.Void,
      Result: ProjectListDbRow,
      execute: () =>
        sql.unsafe(
          `
            SELECT
              project_id AS id,
              title,
              owner_json AS owner,
              COALESCE(status, 'in_progress') AS status,
              cover_file_id AS "coverFileId",
              created_at AS "createdAt",
              updated_at AS "updatedAt",
              ${page.sortKey} AS "sortKey"
            FROM projection_projects
            WHERE ${conditions.join(" AND ")}
            ORDER BY ${page.orderBy}
            LIMIT ?
          `,
          [...params, limit + 1],
        ),
    });

    return rows().pipe(
      Effect.map((projectRows) =>
        projectRows.map(({ sortKey, ...project }) => ({ project, key: sortKey })),
      ),
      Effect.mapError(toPersistenceSqlError("ProjectionProjectRepository.list:query")),
    );
  };

  const deleteById: ProjectionProjectRepositoryShape["deleteById"] = (input) =>
    deleteProjectionProjectRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionProjectRepository.deleteById:query")),
    );

  return {
    upsert,
    getById,
    listAll,
    list,
    deleteById,
  } satisfies ProjectionProjectRepositoryShape;
});

export const ProjectionProjectRepositoryLive = Layer.effect(
  ProjectionProjectRepository,
  makeProjectionProjectRepository,
);
