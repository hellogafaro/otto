import { WS_METHODS } from "@otto/contracts";
import * as Crypto from "effect/Crypto";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createLibraryFolder,
  deleteLibraryFile,
  deleteLibraryFolder,
  updateLibraryFile,
  updateLibraryFolder,
  type CreateLibraryFolderInput,
  type DeleteLibraryFileInput,
  type DeleteLibraryFolderInput,
  type UpdateLibraryFileInput,
  type UpdateLibraryFolderInput,
} from "../operations/commands.ts";
import {
  createEnvironmentCommand,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";

export type {
  CreateLibraryFolderInput,
  DeleteLibraryFileInput,
  DeleteLibraryFolderInput,
  UpdateLibraryFileInput,
  UpdateLibraryFolderInput,
} from "../operations/commands.ts";

const FILE_URL_STALE_TIME_MS = 5 * 60_000;

const FILE_URL_REFRESH_INTERVAL_MS = 30 * 60_000;

const FILE_URL_IDLE_TTL_MS = 60 * 60_000;

export function createLibraryEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | Crypto.Crypto | R, E>,
) {
  return {
    createFolder: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:library:folder:create",
      execute: (input: CreateLibraryFolderInput) => createLibraryFolder(input),
    }),
    updateFolder: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:library:folder:update",
      execute: (input: UpdateLibraryFolderInput) => updateLibraryFolder(input),
    }),
    deleteFolder: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:library:folder:delete",
      execute: (input: DeleteLibraryFolderInput) => deleteLibraryFolder(input),
    }),
    updateFile: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:library:file:update",
      execute: (input: UpdateLibraryFileInput) => updateLibraryFile(input),
    }),
    deleteFile: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:library:file:delete",
      execute: (input: DeleteLibraryFileInput) => deleteLibraryFile(input),
    }),
    createUploadUrl: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:library:create-upload-url",
      tag: WS_METHODS.libraryCreateUploadUrl,
    }),
    /** A signed URL that takes one chat attachment's bytes before the message that sends it. */
    createAttachmentUploadUrl: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:attachments:create-upload-url",
      tag: WS_METHODS.attachmentsCreateUploadUrl,
    }),
    createDocument: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:library:create-document",
      tag: WS_METHODS.libraryCreateDocument,
    }),
    createSkill: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:library:create-skill",
      tag: WS_METHODS.libraryCreateSkill,
    }),
    readDocument: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:library:read-document",
      tag: WS_METHODS.libraryReadDocument,
    }),
    saveDocument: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:library:save-document",
      tag: WS_METHODS.librarySaveDocument,
    }),
    createFileUrl: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:library:create-file-url",
      tag: WS_METHODS.libraryCreateFileUrl,
    }),
    shareFile: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:library:share-file",
      tag: WS_METHODS.libraryShareFile,
    }),
    unshareFile: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:library:unshare-file",
      tag: WS_METHODS.libraryUnshareFile,
    }),
    /** A document's saved text, for a glance such as a skill's description. */
    document: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:library:document",
      tag: WS_METHODS.libraryReadDocument,
    }),
    fileUrl: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:library:file-url",
      tag: WS_METHODS.libraryCreateFileUrl,
      staleTimeMs: FILE_URL_STALE_TIME_MS,
      idleTtlMs: FILE_URL_IDLE_TTL_MS,
      refreshIntervalMs: FILE_URL_REFRESH_INTERVAL_MS,
    }),
  };
}
