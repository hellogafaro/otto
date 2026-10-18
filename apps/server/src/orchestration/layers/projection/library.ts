import * as Effect from "effect/Effect";
import { libraryFilePath, librarySharedCopyPath } from "../../../library/library-paths.ts";
import { type ProjectionDependencies, type ProjectorDefinition } from "./definitions.ts";

export function createLibrary({
  projectionLibraryRepository,
  fileSystem,
  path,
  serverConfig,
}: Pick<
  ProjectionDependencies,
  "projectionLibraryRepository" | "fileSystem" | "path" | "serverConfig"
>) {
  const applyLibraryProjection: ProjectorDefinition["apply"] = Effect.fn("applyLibraryProjection")(
    function* (event, _attachmentSideEffects) {
      switch (event.type) {
        case "library.folder-created":
        case "library.folder-updated":
          yield* projectionLibraryRepository.upsertFolder(event.payload.folder);

          return;
        case "library.folder-deleted":
          yield* projectionLibraryRepository.deleteFolder(event.payload.folderId);

          return;
        case "library.file-created":
        case "library.file-updated":
          yield* projectionLibraryRepository.upsertFile(event.payload.file);

          return;
        case "library.file-deleted": {
          yield* projectionLibraryRepository.deleteFile(event.payload.fileId);

          for (const bytesPath of [
            libraryFilePath(path, serverConfig.attachmentsDir, event.payload.fileId),
            librarySharedCopyPath(path, serverConfig.attachmentsDir, event.payload.fileId),
          ]) {
            if (bytesPath !== null) {
              yield* fileSystem.remove(bytesPath, { force: true }).pipe(Effect.ignore);
            }
          }

          return;
        }

        default:
          return;
      }
    },
  );

  return { applyLibraryProjection };
}
