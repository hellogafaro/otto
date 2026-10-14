/** Library folder and file projection persistence. */
import type {
  GroupId,
  LibraryFile,
  LibraryFileId,
  LibraryFolder,
  LibraryFolderId,
  ThreadId,
} from "@otto/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

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
  readonly listChatThreads: () => Effect.Effect<
    ReadonlyArray<LibraryChatThread>,
    ProjectionRepositoryError
  >;
}

/** The chat behind a chat folder, archived or deleted chats included. */
export interface LibraryChatThread {
  readonly id: ThreadId;
  readonly groupId: GroupId | null;
  readonly deletedAt: string | null;
}

export class ProjectionLibraryRepository extends Context.Service<
  ProjectionLibraryRepository,
  ProjectionLibraryRepositoryShape
>()("@otto/server/persistence/Services/ProjectionLibrary/ProjectionLibraryRepository") {}
