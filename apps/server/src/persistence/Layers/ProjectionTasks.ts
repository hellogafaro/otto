import { OrchestrationTask, TaskAssignees, WorkParticipant, WorkResources } from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  ProjectionTask,
  ProjectionTaskRepository,
  type ProjectionTaskRepositoryShape,
} from "../Services/ProjectionTasks.ts";

const ProjectionTaskDbRow = OrchestrationTask.mapFields(
  Struct.assign({
    owner: Schema.NullOr(Schema.fromJsonString(WorkParticipant)),
    assignees: Schema.fromJsonString(TaskAssignees),
    resources: Schema.fromJsonString(WorkResources),
  }),
);

const makeProjectionTaskRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: ProjectionTask,
    execute: (row) =>
      sql`
        INSERT INTO projection_tasks (
          task_id,
          project_id,
          title,
          description,
          owner_json,
          assignees_json,
          resources_json,
          due_date,
          status,
          created_at,
          updated_at
        )
        VALUES (
          ${row.id},
          ${row.projectId},
          ${row.title},
          ${row.description},
          ${row.owner !== null ? JSON.stringify(row.owner) : null},
          ${JSON.stringify(row.assignees)},
          ${JSON.stringify(row.resources)},
          ${row.dueDate},
          ${row.status},
          ${row.createdAt},
          ${row.updatedAt}
        )
        ON CONFLICT (task_id)
        DO UPDATE SET
          project_id = excluded.project_id,
          title = excluded.title,
          description = excluded.description,
          owner_json = excluded.owner_json,
          assignees_json = excluded.assignees_json,
          resources_json = excluded.resources_json,
          due_date = excluded.due_date,
          status = excluded.status,
          updated_at = excluded.updated_at
      `,
  });

  const listRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionTaskDbRow,
    execute: () =>
      sql`
        SELECT
          task_id AS id,
          project_id AS "projectId",
          title,
          description,
          owner_json AS owner,
          assignees_json AS assignees,
          resources_json AS resources,
          due_date AS "dueDate",
          status,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_tasks
        ORDER BY created_at ASC, task_id ASC
      `,
  });

  const upsert: ProjectionTaskRepositoryShape["upsert"] = (row) =>
    upsertRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionTaskRepository.upsert:query")),
    );

  const listAll: ProjectionTaskRepositoryShape["listAll"] = () =>
    listRows().pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionTaskRepository.listAll:query")),
    );

  return { upsert, listAll } satisfies ProjectionTaskRepositoryShape;
});

export const ProjectionTaskRepositoryLive = Layer.effect(
  ProjectionTaskRepository,
  makeProjectionTaskRepository,
);
