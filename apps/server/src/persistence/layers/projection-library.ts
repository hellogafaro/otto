import {
  LibraryFile,
  LibraryFileId,
  LibraryFileShare,
  LibraryFolder,
  LibraryFolderId,
  LIBRARY_MAX_FOLDER_DEPTH,
  type LibraryListSort,
  type LibraryListType,
  GroupId,
  ProjectId,
  ThreadId,
  WorkParticipant,
  AuthSessionId,
  BotId,
  Visibility,
} from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../errors.ts";
import { listPageSql, type ListSortSql, participantKeySql } from "../list-sql.ts";
import {
  ProjectionLibraryRepository,
  type ProjectionLibraryRepositoryShape,
} from "../services/projection-library.ts";

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
  Struct.assign({
    share: Schema.NullOr(Schema.fromJsonString(LibraryFileShare)),
    createdBy: ParticipantJson,
    updatedBy: ParticipantJson,
  }),
);

const SortKeyJson = Schema.fromJsonString(
  Schema.Array(Schema.Union([Schema.String, Schema.Number])),
);

const LibraryListDbRow = Schema.Union([
  FolderDbRow.mapFields(Struct.assign({ type: Schema.Literal("folder"), sortKey: SortKeyJson })),
  FileDbRow.mapFields(Struct.assign({ sortKey: SortKeyJson })),
]);

/** Folders first in either order, then each sort's key; the id breaks ties. */
const LIBRARY_SORTS: Record<LibraryListSort, ListSortSql> = {
  updated: {
    natural: "desc",
    keys: [
      { sql: "rank", direction: "asc", fixed: true },
      { sql: "updated_at", direction: "desc" },
      { sql: "id", direction: "desc" },
    ],
  },
  created: {
    natural: "desc",
    keys: [
      { sql: "rank", direction: "asc", fixed: true },
      { sql: "created_at", direction: "desc" },
      { sql: "id", direction: "desc" },
    ],
  },
  title: {
    natural: "asc",
    keys: [
      { sql: "rank", direction: "asc", fixed: true },
      { sql: "lower(title)", direction: "asc" },
      { sql: "id", direction: "asc" },
    ],
  },
};

/** The stored types each list type covers; Files are PDFs and everything else. */
const LIST_TYPE_SQL: Record<LibraryListType, ReadonlyArray<string>> = {
  folder: ["folder"],
  document: ["document"],
  image: ["image"],
  file: ["pdf", "file"],
};

const VIEWER = "(SELECT person_id FROM viewer)";

/** Whether the viewer is the person a participant JSON column names. */
const isViewerSql = (json: string) =>
  `(json_extract(${json}, '$.kind') = 'person' AND json_extract(${json}, '$.personId') = ${VIEWER})`;

const groupPeopleSql = (members: string, extra = "") =>
  `SELECT 1 FROM json_each(${members}) AS member WHERE json_extract(member.value, '$.kind') = 'person'${extra}`;

/**
 * Otto: Whether the viewer sees a folder on its own, exactly as `canSeeLibraryItem` checks each
 * node: a `user` folder is its creator's, and a chat's folder follows that chat's people, or
 * only its creator once the chat or its group is gone.
 */
const folderSeenSql = (folder: string) => `
  (${folder}.visibility <> 'user' OR ${isViewerSql(`${folder}.created_by_json`)})
  AND (${folder}.thread_id IS NULL OR COALESCE((
    SELECT CASE
      WHEN thread.deleted_at IS NOT NULL THEN ${isViewerSql(`${folder}.created_by_json`)}
      WHEN thread.group_id IS NULL THEN
        thread.visibility <> 'user' OR thread.created_by IS NULL OR thread.created_by = ${VIEWER}
      ELSE COALESCE((
        SELECT NOT EXISTS (${groupPeopleSql("chat_group.members_json")})
          OR EXISTS (${groupPeopleSql("chat_group.members_json", ` AND json_extract(member.value, '$.personId') = ${VIEWER}`)})
        FROM projection_groups AS chat_group
        WHERE chat_group.group_id = thread.group_id
      ), ${isViewerSql(`${folder}.created_by_json`)})
    END
    FROM projection_threads AS thread
    WHERE thread.thread_id = ${folder}.thread_id
  ), ${isViewerSql(`${folder}.created_by_json`)}))
`;

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
          file_id, folder_id, type, title, extension, size_bytes, visibility, share_json,
          created_by_json, created_at, updated_by_json, updated_at
        )
        VALUES (
          ${file.id}, ${file.folderId}, ${file.type}, ${file.title}, ${file.extension},
          ${file.sizeBytes}, ${file.visibility}, ${file.share}, ${file.createdBy},
          ${file.createdAt}, ${file.updatedBy}, ${file.updatedAt}
        )
        ON CONFLICT (file_id)
        DO UPDATE SET
          folder_id = excluded.folder_id,
          title = excluded.title,
          size_bytes = excluded.size_bytes,
          visibility = excluded.visibility,
          share_json = excluded.share_json,
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
          share_json AS "share",
          created_by_json AS "createdBy",
          created_at AS "createdAt",
          updated_by_json AS "updatedBy",
          updated_at AS "updatedAt"
        FROM projection_library_files
        ORDER BY created_at ASC, file_id ASC
      `,
  });

  const getFileRow = SqlSchema.findOneOption({
    Request: LibraryFileId,
    Result: FileDbRow,
    execute: (fileId) =>
      sql`
        SELECT
          file_id AS id,
          folder_id AS "folderId",
          type,
          title,
          extension,
          size_bytes AS "sizeBytes",
          visibility,
          share_json AS "share",
          created_by_json AS "createdBy",
          created_at AS "createdAt",
          updated_by_json AS "updatedBy",
          updated_at AS "updatedAt"
        FROM projection_library_files
        WHERE file_id = ${fileId}
      `,
  });

  const listFolderPathRows = SqlSchema.findAll({
    Request: Schema.Array(LibraryFolderId),
    Result: FolderDbRow,
    execute: (folderIds) =>
      sql`
        WITH RECURSIVE path(folder_id, depth) AS (
          SELECT folder_id, 1 FROM projection_library_folders
          WHERE ${sql.in("folder_id", folderIds)}
          UNION
          SELECT parent.folder_id, path.depth + 1
          FROM path
          JOIN projection_library_folders AS child ON child.folder_id = path.folder_id
          JOIN projection_library_folders AS parent ON parent.folder_id = child.parent_id
          WHERE path.depth < ${LIBRARY_MAX_FOLDER_DEPTH}
        )
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
        WHERE folder_id IN (SELECT folder_id FROM path)
      `,
  });

  const listChatThreadRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: Schema.Struct({
      id: ThreadId,
      groupId: Schema.NullOr(GroupId),
      botId: Schema.NullOr(BotId),
      createdBy: Schema.NullOr(AuthSessionId),
      visibility: Visibility,
      deletedAt: Schema.NullOr(Schema.String),
    }),
    execute: () =>
      sql`
        SELECT
          threads.thread_id AS id,
          threads.group_id AS "groupId",
          threads.bot_id AS "botId",
          threads.created_by AS "createdBy",
          threads.visibility,
          threads.deleted_at AS "deletedAt"
        FROM projection_library_folders AS folders
        JOIN projection_threads AS threads ON threads.thread_id = folders.thread_id
      `,
  });

  const list: ProjectionLibraryRepositoryShape["list"] = ({ query, personId, limit, after }) => {
    const keyset = listPageSql(LIBRARY_SORTS[query.sort ?? "updated"], query.order, after);
    const conditions: string[] = [];
    const params: Array<string | number> = [];

    const placed =
      query.folder !== undefined || query.thread !== undefined || query.project !== undefined;

    if (!query.everywhere && !placed) conditions.push("parent_id IS NULL");

    if (query.folder !== undefined) {
      conditions.push(
        query.everywhere
          ? `parent_id IN (
              WITH RECURSIVE subtree(folder_id, depth) AS (
                SELECT ?, 0
                UNION
                SELECT child.folder_id, subtree.depth + 1
                FROM projection_library_folders AS child
                JOIN subtree ON child.parent_id = subtree.folder_id
                WHERE subtree.depth < ${LIBRARY_MAX_FOLDER_DEPTH}
              )
              SELECT folder_id FROM subtree
            )`
          : "parent_id = ?",
      );
      params.push(query.folder);
    }

    if (query.thread !== undefined) {
      conditions.push(
        "parent_id IN (SELECT folder_id FROM projection_library_folders WHERE thread_id = ?)",
      );
      params.push(query.thread);
    }

    if (query.project !== undefined) {
      conditions.push(
        "parent_id IN (SELECT folder_id FROM projection_library_folders WHERE project_id = ?)",
      );
      params.push(query.project);
    }

    if (query.title !== undefined) {
      conditions.push("instr(lower(title), lower(?)) > 0");
      params.push(query.title);
    }

    if (query.type !== undefined && query.type.length > 0) {
      const types = query.type.flatMap((type) => LIST_TYPE_SQL[type]);
      conditions.push(`type IN (${types.map(() => "?").join(", ")})`);
      params.push(...types);
    }

    if (query.creator !== undefined) {
      conditions.push(`${participantKeySql("created_by_json")} = ?`);
      params.push(query.creator);
    }

    if (keyset.after) {
      conditions.push(keyset.after.condition);
      params.push(...keyset.after.params);
    }

    const rows = SqlSchema.findAll({
      Request: Schema.Void,
      Result: LibraryListDbRow,
      execute: () =>
        sql.unsafe(
          `
            WITH RECURSIVE
              viewer AS (SELECT ? AS person_id),
              visible_folders(folder_id) AS (
                SELECT folder.folder_id
                FROM projection_library_folders AS folder
                WHERE (
                    folder.parent_id IS NULL
                    OR NOT EXISTS (
                      SELECT 1 FROM projection_library_folders AS parent
                      WHERE parent.folder_id = folder.parent_id
                    )
                  )
                  AND ${folderSeenSql("folder")}
                UNION
                SELECT folder.folder_id
                FROM projection_library_folders AS folder
                JOIN visible_folders AS parent ON parent.folder_id = folder.parent_id
                WHERE ${folderSeenSql("folder")}
              ),
              items AS (
                SELECT
                  0 AS rank, 'folder' AS type, folder_id AS id, parent_id, thread_id, project_id,
                  title, NULL AS extension, NULL AS size_bytes, visibility, NULL AS share_json,
                  created_by_json, created_at, updated_by_json, updated_at
                FROM projection_library_folders
                WHERE folder_id IN (SELECT folder_id FROM visible_folders)
                UNION ALL
                SELECT
                  1, type, file_id, folder_id, NULL, NULL, title, extension, size_bytes,
                  visibility, share_json, created_by_json, created_at, updated_by_json, updated_at
                FROM projection_library_files AS file
                WHERE (file.visibility <> 'user' OR ${isViewerSql("file.created_by_json")})
                  AND (
                    file.folder_id IS NULL
                    OR file.folder_id IN (SELECT folder_id FROM visible_folders)
                    OR NOT EXISTS (
                      SELECT 1 FROM projection_library_folders AS parent
                      WHERE parent.folder_id = file.folder_id
                    )
                  )
              )
            SELECT
              type,
              id,
              parent_id AS "parentId",
              parent_id AS "folderId",
              thread_id AS "threadId",
              project_id AS "projectId",
              title,
              extension,
              size_bytes AS "sizeBytes",
              visibility,
              share_json AS "share",
              created_by_json AS "createdBy",
              created_at AS "createdAt",
              updated_by_json AS "updatedBy",
              updated_at AS "updatedAt",
              ${keyset.sortKey} AS "sortKey"
            FROM items
            ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
            ORDER BY ${keyset.orderBy}
            LIMIT ?
          `,
          [personId, ...params, limit + 1],
        ),
    });

    return rows().pipe(
      Effect.map((listRows) =>
        listRows.map(({ sortKey, ...row }) => {
          if (row.type === "folder") {
            const { type: _, threadId, projectId, ...folder } = row;

            return {
              key: sortKey,
              item: {
                kind: "folder" as const,
                folder: {
                  ...folder,
                  ...(threadId === null ? {} : { threadId }),
                  ...(projectId === null ? {} : { projectId }),
                },
              },
            };
          }

          const { share, ...file } = row;

          return {
            key: sortKey,
            item: { kind: "file" as const, file: share === null ? file : { ...file, share } },
          };
        }),
      ),
      Effect.mapError(toPersistenceSqlError("ProjectionLibraryRepository.list:query")),
    );
  };

  const toFolders = (rows: ReadonlyArray<typeof FolderDbRow.Type>): ReadonlyArray<LibraryFolder> =>
    rows.map(({ threadId, projectId, ...folder }) => ({
      ...folder,
      ...(threadId === null ? {} : { threadId }),
      ...(projectId === null ? {} : { projectId }),
    }));

  return {
    list,
    getFile: (fileId) =>
      getFileRow(fileId).pipe(
        Effect.map(
          Option.map(({ share, ...file }) => (share === null ? file : { ...file, share })),
        ),
        Effect.mapError(toPersistenceSqlError("ProjectionLibraryRepository.getFile:query")),
      ),
    listFolderPaths: (folderIds) =>
      folderIds.length === 0
        ? Effect.succeed([])
        : listFolderPathRows(folderIds).pipe(
            Effect.map(toFolders),
            Effect.mapError(
              toPersistenceSqlError("ProjectionLibraryRepository.listFolderPaths:query"),
            ),
          ),
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
      upsertFileRow({ ...file, share: file.share ?? null }).pipe(
        Effect.mapError(toPersistenceSqlError("ProjectionLibraryRepository.upsertFile:query")),
      ),
    deleteFile: (fileId) =>
      deleteFileRow(fileId).pipe(
        Effect.mapError(toPersistenceSqlError("ProjectionLibraryRepository.deleteFile:query")),
      ),
    listFolders: () =>
      listFolderRows().pipe(
        Effect.map(toFolders),
        Effect.mapError(toPersistenceSqlError("ProjectionLibraryRepository.listFolders:query")),
      ),
    listFiles: () =>
      listFileRows().pipe(
        Effect.map((rows) =>
          rows.map(({ share, ...file }) => (share === null ? file : { ...file, share })),
        ),
        Effect.mapError(toPersistenceSqlError("ProjectionLibraryRepository.listFiles:query")),
      ),
  } satisfies ProjectionLibraryRepositoryShape;
});

export const ProjectionLibraryRepositoryLive = Layer.effect(
  ProjectionLibraryRepository,
  makeProjectionLibraryRepository,
);
