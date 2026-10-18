import {
  type AuthSessionId,
  canSeeLibraryItem,
  type LibraryFile,
  type LibraryFileId,
  type LibraryFolder,
  type LibraryFolderId,
  LibraryRequestError,
} from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../persistence/errors.ts";
import type { ProjectionGroupRepository } from "../persistence/services/projection-groups.ts";
import type { ProjectionLibraryRepository } from "../persistence/services/projection-library.ts";

interface LibraryGetServices {
  readonly projectionLibrary: ProjectionLibraryRepository["Service"];
  readonly projectionGroups: Pick<ProjectionGroupRepository["Service"], "listAll">;
}

const isLibraryRequestError = Schema.is(LibraryRequestError);

/**
 * Otto: Whether a person sees an item, decided by `canSeeLibraryItem` over the folders above it,
 * as the list and every other Library read do. A chat's folder on that path also needs its chat
 * and group.
 */
const visible = (
  item: LibraryFolder | LibraryFile,
  folders: ReadonlyArray<LibraryFolder>,
  personId: AuthSessionId,
  services: LibraryGetServices,
) =>
  Effect.gen(function* () {
    const chatFolder = [item, ...folders].some(
      (node) => "threadId" in node && node.threadId !== undefined,
    );

    const [threads, groups] = chatFolder
      ? yield* Effect.all([
          services.projectionLibrary.listChatThreads(),
          services.projectionGroups.listAll(),
        ])
      : [[], []];

    return canSeeLibraryItem(
      item,
      {
        folders,
        threads,
        groups: groups.map((group) => ({ id: group.groupId, members: group.members })),
      },
      { kind: "person", personId },
    );
  });

const readFailure = Effect.mapError((error: LibraryRequestError | ProjectionRepositoryError) =>
  isLibraryRequestError(error)
    ? error
    : new LibraryRequestError({ detail: "Could not read the Library." }),
);

/** One file a person may see with the folders above it; a hidden file reads as missing. */
export const getLibraryFile = (
  fileId: LibraryFileId,
  personId: AuthSessionId,
  services: LibraryGetServices,
) =>
  Effect.gen(function* () {
    const missing = new LibraryRequestError({ detail: "That Library file doesn't exist." });
    const file = yield* services.projectionLibrary.getFile(fileId);

    if (Option.isNone(file)) return yield* missing;

    const folders = yield* services.projectionLibrary.listFolderPaths(
      file.value.folderId === null ? [] : [file.value.folderId],
    );

    if (!(yield* visible(file.value, folders, personId, services))) return yield* missing;

    return { file: file.value, folders };
  }).pipe(readFailure);

/** One folder a person may see with the folders above it; a hidden folder reads as missing. */
export const getLibraryFolder = (
  folderId: LibraryFolderId,
  personId: AuthSessionId,
  services: LibraryGetServices,
) =>
  Effect.gen(function* () {
    const missing = new LibraryRequestError({ detail: "That Library folder doesn't exist." });
    const path = yield* services.projectionLibrary.listFolderPaths([folderId]);
    const folder = path.find((candidate) => candidate.id === folderId);

    if (folder === undefined) return yield* missing;

    const folders = path.filter((candidate) => candidate.id !== folderId);

    if (!(yield* visible(folder, folders, personId, services))) return yield* missing;

    return { folder, folders };
  }).pipe(readFailure);
