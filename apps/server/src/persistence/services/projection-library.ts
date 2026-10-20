/** Library folder and file projection persistence. */
import type {
  GroupId,
  LibraryFile,
  LibraryFileId,
  LibraryFolder,
  LibraryFolderId,
  LibraryListItem,
  LibraryListView,
  ThreadId,
  AuthSessionId,
  BotId,
  Visibility,
} from "@otto/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";

import type { ProjectionRepositoryError } from "../errors.ts";

export interface ProjectionLibraryRepositoryShape {
  readonly upsertFolder: (folder: LibraryFolder) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly deleteFolder: (
    folderId: LibraryFolderId,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly upsertFile: (file: LibraryFile) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly deleteFile: (fileId: LibraryFileId) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listFolders: () => Effect.Effect<
    ReadonlyArray<LibraryFolder>,
    ProjectionRepositoryError
  >;
  readonly listFiles: () => Effect.Effect<ReadonlyArray<LibraryFile>, ProjectionRepositoryError>;
  readonly getFile: (
    fileId: LibraryFileId,
  ) => Effect.Effect<Option.Option<LibraryFile>, ProjectionRepositoryError>;
  /** The given folders and every folder above them, at most the deepest nesting allowed. */
  readonly listFolderPaths: (
    folderIds: ReadonlyArray<LibraryFolderId>,
  ) => Effect.Effect<ReadonlyArray<LibraryFolder>, ProjectionRepositoryError>;
  readonly listChatThreads: () => Effect.Effect<
    ReadonlyArray<LibraryChatThread>,
    ProjectionRepositoryError
  >;
  /**
   * One page of the folders and files a person sees, matching the view's filter in its order,
   * strictly after `after`, with one row more than the limit when another page follows.
   */
  readonly list: (input: {
    readonly query: LibraryListView;
    readonly personId: AuthSessionId;
    readonly limit: number;
    readonly after: LibraryListKey | null;
  }) => Effect.Effect<
    ReadonlyArray<{ readonly item: LibraryListItem; readonly key: LibraryListKey }>,
    ProjectionRepositoryError
  >;
}

/** A row's sort key: folders first, the value of its sort, then its id. */
export type LibraryListKey = ReadonlyArray<string | number>;

/** The chat behind a chat folder, archived or deleted chats included. */
export interface LibraryChatThread {
  readonly id: ThreadId;
  readonly groupId: GroupId | null;
  readonly botId?: BotId | null;
  readonly personId?: AuthSessionId | null;
  readonly createdBy?: AuthSessionId | null;
  readonly visibility?: Visibility;
  readonly deletedAt: string | null;
}

export class ProjectionLibraryRepository extends Context.Service<
  ProjectionLibraryRepository,
  ProjectionLibraryRepositoryShape
>()("@otto/server/persistence/services/projection-library/ProjectionLibraryRepository") {}
