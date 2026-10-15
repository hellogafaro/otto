import {
  LibraryFileDeletedPayload,
  LibraryFilePayload,
  LibraryFolderDeletedPayload,
  LibraryFolderPayload,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@otto/contracts";
import * as Effect from "effect/Effect";
import type { OrchestrationProjectorDecodeError } from "../errors.ts";
import { decodeForEvent } from "./updates.ts";

const upsert = <T extends { readonly id: string }>(items: ReadonlyArray<T>, item: T) =>
  items.some((entry) => entry.id === item.id)
    ? items.map((entry) => (entry.id === item.id ? item : entry))
    : [...items, item];

export function projectLibrary(
  nextBase: OrchestrationReadModel,
  event: OrchestrationEvent,
): Effect.Effect<OrchestrationReadModel, OrchestrationProjectorDecodeError> {
  switch (event.type) {
    case "library.folder-created":
    case "library.folder-updated":
      return decodeForEvent(LibraryFolderPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          libraryFolders: upsert(nextBase.libraryFolders ?? [], payload.folder),
        })),
      );
    case "library.folder-deleted":
      return decodeForEvent(LibraryFolderDeletedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          libraryFolders: (nextBase.libraryFolders ?? []).filter(
            (folder) => folder.id !== payload.folderId,
          ),
        })),
      );
    case "library.file-created":
    case "library.file-updated":
      return decodeForEvent(LibraryFilePayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          libraryFiles: upsert(nextBase.libraryFiles ?? [], payload.file),
        })),
      );
    case "library.file-deleted":
      return decodeForEvent(LibraryFileDeletedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          libraryFiles: (nextBase.libraryFiles ?? []).filter((file) => file.id !== payload.fileId),
        })),
      );
    default:
      return Effect.succeed(nextBase);
  }
}
