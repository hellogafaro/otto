import {
  LibraryFile,
  LibraryFileId,
  LibraryFolder,
  LibraryFolderId,
  GroupId,
  ProjectId,
  ThreadId,
  WorkParticipant,
} from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  ProjectionLibraryRepository,
  type ProjectionLibraryRepositoryShape,
} from "../Services/ProjectionLibrary.ts";

const ParticipantJson = Schema.fromJsonString(WorkParticipant);

const FolderDbRow = LibraryFolder.mapFields(Struct.omit(["threadId", "projectId"])).mapFields(
  Struct.assign({
    threadId: Schema.NullOr(ThreadId),
    projectId: Schema.NullOr(ProjectId),
    createdBy: ParticipantJson,
    updatedBy: ParticipantJson,
  }),
);

const FileDbRow = LibraryFile.mapFields(
  Struct.assign({ createdBy: ParticipantJson, updatedBy: ParticipantJson }),
);

const makeProjectionLibraryRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertFolderRow = SqlSchema.void({
    Request: FolderDbRow,
    execute: (folder) =>
      sql`
        INSERT INTO projection_library_folders (
          folder_id, parent_id, thread_id, project_id, title, visibility,
          created_by_json, created_at, updated_by_json, updated_at
        )
        VALUES (
          ${folder.id}, ${folder.parentId}, ${folder.threadId}, ${folder.projectId}, ${folder.title},
          ${folder.visibility}, ${folder.createdBy}, ${folder.createdAt},
          ${folder.updatedBy}, ${folder.updatedAt}
        )
        ON CONFLICT (folder_id)
        DO UPDATE SET
          parent_id = excluded.parent_id,
          title = excluded.title,
          visibility = excluded.visibility,
          updated_by_json = excluded.updated_by_json,
          updated_at = excluded.updated_at
      `,
  });

  const deleteFolderRow = SqlSchema.void({
    Request: LibraryFolderId,
    execute: (folderId) =>
      sql`DELETE FROM projection_library_folders WHERE folder_id = ${folderId}`,
  });

  const upsertFileRow = SqlSchema.void({
    Request: FileDbRow,
    execute: (file) =>
      sql`
        INSERT INTO projection_library_files (
          file_id, folder_id, type, title, extension, size_bytes, visibility,
          created_by_json, created_at, updated_by_json, updated_at
        )
        VALUES (
          ${file.id}, ${file.folderId}, ${file.type}, ${file.title}, ${file.extension},
          ${file.sizeBytes}, ${file.visibility}, ${file.createdBy},
          ${file.createdAt}, ${file.updatedBy}, ${file.updatedAt}
        )
        ON CONFLICT (file_id)
        DO UPDATE SET
          folder_id = excluded.folder_id,
          title = excluded.title,
          size_bytes = excluded.size_bytes,
          visibility = excluded.visibility,
          updated_by_json = excluded.updated_by_json,
          updated_at = excluded.updated_at
      `,
  });

  const deleteFileRow = SqlSchema.void({
    Request: LibraryFileId,
    execute: (fileId) => sql`DELETE FROM projection_library_files WHERE file_id = ${fileId}`,
  });

  const listFolderRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: FolderDbRow,
    execute: () =>
      sql`
        SELECT
          folder_id AS id,
          parent_id AS "parentId",
          thread_id AS "threadId",
          project_id AS "projectId",
          title,
          visibility,
          created_by_json AS "createdBy",
          created_at AS "createdAt",
          updated_by_json AS "updatedBy",
          updated_at AS "updatedAt"
        FROM projection_library_folders
        ORDER BY created_at ASC, folder_id ASC
      `,
  });

  const listFileRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: FileDbRow,
    execute: () =>
      sql`
        SELECT
          file_id AS id,
          folder_id AS "folderId",
          type,
          title,
          extension,
          size_bytes AS "sizeBytes",
          visibility,
          created_by_json AS "createdBy",
          created_at AS "createdAt",
          updated_by_json AS "updatedBy",
          updated_at AS "updatedAt"
        FROM projection_library_files
        ORDER BY created_at ASC, file_id ASC
      `,
  });

  const listChatThreadRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: Schema.Struct({
      id: ThreadId,
      groupId: Schema.NullOr(GroupId),
      deletedAt: Schema.NullOr(Schema.String),
    }),
    execute: () =>
      sql`
        SELECT
          threads.thread_id AS id,
          threads.group_id AS "groupId",
          threads.deleted_at AS "deletedAt"
        FROM projection_library_folders AS folders
        JOIN projection_threads AS threads ON threads.thread_id = folders.thread_id
      `,
  });

  return {
    listChatThreads: () =>
      listChatThreadRows().pipe(
        Effect.mapError(toPersistenceSqlError("ProjectionLibraryRepository.listChatThreads:query")),
      ),
    upsertFolder: (folder) =>
      upsertFolderRow({
        ...folder,
        threadId: folder.threadId ?? null,
        projectId: folder.projectId ?? null,
      }).pipe(
        Effect.mapError(toPersistenceSqlError("ProjectionLibraryRepository.upsertFolder:query")),
      ),
    deleteFolder: (folderId) =>
      deleteFolderRow(folderId).pipe(
        Effect.mapError(toPersistenceSqlError("ProjectionLibraryRepository.deleteFolder:query")),
      ),
    upsertFile: (file) =>
      upsertFileRow(file).pipe(
        Effect.mapError(toPersistenceSqlError("ProjectionLibraryRepository.upsertFile:query")),
      ),
    deleteFile: (fileId) =>
      deleteFileRow(fileId).pipe(
        Effect.mapError(toPersistenceSqlError("ProjectionLibraryRepository.deleteFile:query")),
      ),
    listFolders: () =>
      listFolderRows().pipe(
        Effect.map((rows) =>
          rows.map(({ threadId, projectId, ...folder }) => ({
            ...folder,
            ...(threadId === null ? {} : { threadId }),
            ...(projectId === null ? {} : { projectId }),
          })),
        ),
        Effect.mapError(toPersistenceSqlError("ProjectionLibraryRepository.listFolders:query")),
      ),
    listFiles: () =>
      listFileRows().pipe(
        Effect.mapError(toPersistenceSqlError("ProjectionLibraryRepository.listFiles:query")),
      ),
  } satisfies ProjectionLibraryRepositoryShape;
});

export const ProjectionLibraryRepositoryLive = Layer.effect(
  ProjectionLibraryRepository,
  makeProjectionLibraryRepository,
);
