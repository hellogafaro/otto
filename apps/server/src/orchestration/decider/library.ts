import {
  canEditLibraryItem,
  canSeeLibraryItem,
  LIBRARY_CHATS_FOLDER_ID,
  LIBRARY_MAX_FOLDER_DEPTH,
  type LibraryFile,
  type LibraryFileId,
  type LibraryFolder,
  type LibraryFolderId,
  libraryFolderPath,
  libraryViewerOf,
  type OrchestrationCommand,
  type OrchestrationReadModel,
  type WorkParticipant,
} from "@otto/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";
import { OrchestrationCommandInvariantError } from "../Errors.ts";
import { withEventBase, nowIso, type DecideOrchestrationCommandResult } from "./eventBase.ts";

type LibraryCommand = Extract<
  OrchestrationCommand,
  {
    type:
      | "library.folder.create"
      | "library.folder.update"
      | "library.folder.delete"
      | "library.file.create"
      | "library.file.update"
      | "library.file.delete";
  }
>;

const invariant = (commandType: string, detail: string) =>
  Effect.fail(new OrchestrationCommandInvariantError({ commandType, detail }));

/** Folders a folder sits in plus itself; a top-level folder is depth 1. */
const depthOf = (folders: ReadonlyArray<LibraryFolder>, folderId: LibraryFolderId | null) =>
  libraryFolderPath(folders, folderId).length;

/** How many levels a folder and everything under it span, the folder itself counting as 1. */
const subtreeHeight = (folders: ReadonlyArray<LibraryFolder>, folderId: LibraryFolderId): number =>
  1 +
  Math.max(
    0,
    ...folders.flatMap((folder) =>
      folder.parentId === folderId ? [subtreeHeight(folders, folder.id)] : [],
    ),
  );

const participantName = (readModel: OrchestrationReadModel, participant: WorkParticipant) =>
  participant.kind === "person"
    ? participant.displayName
    : (readModel.bots.find((bot) => bot.id === participant.botId)?.name ?? "a bot");

export const decideLibrary = Effect.fn("decideLibrary")(function* ({
  command,
  readModel,
}: {
  readonly command: LibraryCommand;
  readonly readModel: OrchestrationReadModel;
}): Effect.fn.Return<
  DecideOrchestrationCommandResult,
  OrchestrationCommandInvariantError | PlatformError.PlatformError,
  Crypto.Crypto
> {
  const by = command.by;

  if (by === undefined) {
    return yield* invariant(command.type, "Library changes need a person or bot.");
  }

  const viewer = libraryViewerOf(by);
  const folders = readModel.libraryFolders ?? [];
  const files = readModel.libraryFiles ?? [];
  const context = { folders, threads: readModel.threads, groups: readModel.groups };

  const requireFolder = (folderId: LibraryFolderId) =>
    Effect.gen(function* () {
      const folder = folders.find((candidate) => candidate.id === folderId);

      if (folder === undefined || !canSeeLibraryItem(folder, context, viewer)) {
        return yield* invariant(command.type, `Folder '${folderId}' does not exist.`);
      }

      return folder;
    });

  /** Where new things can go: the top, or any visible folder except the Chats folder itself. */
  const requireDestination = (folderId: LibraryFolderId | null, holdsFolder: boolean) =>
    Effect.gen(function* () {
      if (folderId === null) return null;
      const folder = yield* requireFolder(folderId);

      if (folderId === LIBRARY_CHATS_FOLDER_ID && !holdsFolder) {
        return yield* invariant(command.type, "The Chats folder only holds chat folders.");
      }

      return folder;
    });

  const base = (
    aggregateKind: "library-folder" | "library-file",
    aggregateId: LibraryFolderId | LibraryFileId,
  ) =>
    Effect.gen(function* () {
      const occurredAt = "createdAt" in command ? command.createdAt : yield* nowIso;

      return {
        occurredAt,
        base: yield* withEventBase({
          aggregateKind,
          aggregateId,
          occurredAt,
          commandId: command.commandId,
        }),
      };
    });

  switch (command.type) {
    case "library.folder.create": {
      if (folders.some((folder) => folder.id === command.folderId)) {
        return yield* invariant(command.type, `Folder '${command.folderId}' already exists.`);
      }

      if (command.folderId === LIBRARY_CHATS_FOLDER_ID) {
        if (command.parentId !== null || command.threadId !== undefined) {
          return yield* invariant(command.type, "The Chats folder sits at the top.");
        }
      } else if (command.threadId !== undefined) {
        if (command.parentId !== LIBRARY_CHATS_FOLDER_ID) {
          return yield* invariant(command.type, "A chat folder sits in the Chats folder.");
        }

        if (folders.some((folder) => folder.threadId === command.threadId)) {
          return yield* invariant(command.type, "This chat already has a folder.");
        }
      } else if (command.parentId === LIBRARY_CHATS_FOLDER_ID) {
        return yield* invariant(command.type, "The Chats folder only holds chat folders.");
      }

      if (command.parentId !== null) yield* requireFolder(command.parentId);

      if (depthOf(folders, command.parentId) + 1 > LIBRARY_MAX_FOLDER_DEPTH) {
        return yield* invariant(
          command.type,
          `Folders go at most ${LIBRARY_MAX_FOLDER_DEPTH} levels deep.`,
        );
      }

      const { occurredAt, base: eventBase } = yield* base("library-folder", command.folderId);

      return {
        ...eventBase,
        type: "library.folder-created",
        payload: {
          folder: {
            id: command.folderId,
            parentId: command.parentId,
            ...(command.threadId !== undefined ? { threadId: command.threadId } : {}),
            title: command.title,
            visibility:
              command.threadId !== undefined ? "workspace" : (command.visibility ?? "workspace"),
            createdBy: by,
            createdAt: occurredAt,
            updatedBy: by,
            updatedAt: occurredAt,
          },
        },
      };
    }

    case "library.folder.update": {
      const folder = yield* requireFolder(command.folderId);

      if (folder.id === LIBRARY_CHATS_FOLDER_ID) {
        return yield* invariant(command.type, "The Chats folder can't be changed.");
      }

      if (!canEditLibraryItem(folder, folders, viewer)) {
        return yield* invariant(command.type, "Only the folder's creator can change it.");
      }

      const moves = command.parentId !== undefined && command.parentId !== folder.parentId;

      if (folder.threadId !== undefined && (moves || command.visibility !== undefined)) {
        return yield* invariant(
          command.type,
          "A chat folder can be renamed but not moved or made private.",
        );
      }

      if (moves) {
        const parentId = command.parentId ?? null;
        yield* requireDestination(parentId, false);

        if (
          parentId !== null &&
          libraryFolderPath(folders, parentId).some((ancestor) => ancestor.id === folder.id)
        ) {
          return yield* invariant(command.type, "A folder can't move into itself.");
        }

        if (
          depthOf(folders, parentId) + subtreeHeight(folders, folder.id) >
          LIBRARY_MAX_FOLDER_DEPTH
        ) {
          return yield* invariant(
            command.type,
            `Folders go at most ${LIBRARY_MAX_FOLDER_DEPTH} levels deep.`,
          );
        }
      }

      const { occurredAt, base: eventBase } = yield* base("library-folder", folder.id);

      return {
        ...eventBase,
        type: "library.folder-updated",
        payload: {
          folder: {
            ...folder,
            ...(moves ? { parentId: command.parentId ?? null } : {}),
            ...(command.title !== undefined ? { title: command.title } : {}),
            ...(command.visibility !== undefined ? { visibility: command.visibility } : {}),
            updatedBy: by,
            updatedAt: occurredAt,
          },
        },
      };
    }

    case "library.folder.delete": {
      const folder = yield* requireFolder(command.folderId);

      if (folder.id === LIBRARY_CHATS_FOLDER_ID || folder.threadId !== undefined) {
        return yield* invariant(command.type, "A chat folder can't be deleted.");
      }

      if (!canEditLibraryItem(folder, folders, viewer)) {
        return yield* invariant(command.type, "Only the folder's creator can delete it.");
      }

      if (
        folders.some((candidate) => candidate.parentId === folder.id) ||
        files.some((file) => file.folderId === folder.id)
      ) {
        return yield* invariant(command.type, "Only an empty folder can be deleted.");
      }

      const { base: eventBase } = yield* base("library-folder", folder.id);

      return {
        ...eventBase,
        type: "library.folder-deleted",
        payload: { folderId: folder.id },
      };
    }

    case "library.file.create": {
      if (files.some((file) => file.id === command.fileId)) {
        return yield* invariant(command.type, `File '${command.fileId}' already exists.`);
      }

      yield* requireDestination(command.folderId, false);

      if (command.sizeBytes === 0 && command.fileType !== "document") {
        return yield* invariant(command.type, "Only a document can be empty.");
      }

      const { occurredAt, base: eventBase } = yield* base("library-file", command.fileId);

      return {
        ...eventBase,
        type: "library.file-created",
        payload: {
          file: {
            id: command.fileId,
            folderId: command.folderId,
            type: command.fileType,
            title: command.title,
            extension: command.extension,
            sizeBytes: command.sizeBytes,
            visibility: command.visibility,
            createdBy: by,
            createdAt: occurredAt,
            updatedBy: by,
            updatedAt: occurredAt,
          },
        },
      };
    }

    case "library.file.update": {
      const file: LibraryFile | undefined = files.find(
        (candidate) => candidate.id === command.fileId,
      );

      if (file === undefined || !canSeeLibraryItem(file, context, viewer)) {
        return yield* invariant(command.type, `File '${command.fileId}' does not exist.`);
      }

      if (!canEditLibraryItem(file, folders, viewer)) {
        return yield* invariant(command.type, "Only the file's creator can change it.");
      }

      if (command.expectedUpdatedAt !== undefined && command.expectedUpdatedAt !== file.updatedAt) {
        return yield* invariant(
          command.type,
          `Changed by ${participantName(readModel, file.updatedBy)}, reload.`,
        );
      }

      if (command.sizeBytes !== undefined && file.type !== "document") {
        return yield* invariant(command.type, "Only a document's contents can be edited.");
      }

      const moves = command.folderId !== undefined && command.folderId !== file.folderId;

      if (moves) yield* requireDestination(command.folderId ?? null, false);

      const { occurredAt, base: eventBase } = yield* base("library-file", file.id);

      return {
        ...eventBase,
        type: "library.file-updated",
        payload: {
          file: {
            ...file,
            ...(moves ? { folderId: command.folderId ?? null } : {}),
            ...(command.title !== undefined ? { title: command.title } : {}),
            ...(command.visibility !== undefined ? { visibility: command.visibility } : {}),
            ...(command.sizeBytes !== undefined ? { sizeBytes: command.sizeBytes } : {}),
            updatedBy: by,
            updatedAt: occurredAt,
          },
        },
      };
    }

    case "library.file.delete": {
      const file = files.find((candidate) => candidate.id === command.fileId);

      if (file === undefined || !canSeeLibraryItem(file, context, viewer)) {
        return yield* invariant(command.type, `File '${command.fileId}' does not exist.`);
      }

      if (!canEditLibraryItem(file, folders, viewer)) {
        return yield* invariant(command.type, "Only the file's creator can delete it.");
      }

      const { base: eventBase } = yield* base("library-file", file.id);

      return {
        ...eventBase,
        type: "library.file-deleted",
        payload: { fileId: file.id },
      };
    }
  }
});
