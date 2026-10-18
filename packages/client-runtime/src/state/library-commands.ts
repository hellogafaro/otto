import {
  type EnvironmentId,
  type LibraryFile,
  type LibraryFileId,
  type LibraryFolder,
  type LibraryFolderId,
  type LibraryListQuery,
  LIBRARY_SKILLS_FOLDER_ID,
  WS_METHODS,
} from "@otto/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { request } from "../rpc/client.ts";
import { runInEnvironment } from "./environment-queries.ts";
import { cacheLibraryItems, libraryCacheAtom, libraryRevisionAtom } from "./library-cache.ts";
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

export * from "./library-cache.ts";

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

/**
 * Keeps what a read returned in the Library cache, unless a change arrived while it was on its
 * way: the change moved the revision, so whoever asked reads again.
 */
const cacheRead = <A, E, R>(
  registry: AtomRegistry.AtomRegistry,
  environmentId: EnvironmentId,
  read: Effect.Effect<A, E, R>,
  items: (result: A) => {
    readonly folders?: ReadonlyArray<LibraryFolder>;
    readonly files?: ReadonlyArray<LibraryFile>;
  },
) => {
  const cache = libraryCacheAtom(environmentId);
  const revision = registry.get(cache).revision;

  return read.pipe(
    Effect.tap((result) =>
      Effect.sync(() =>
        registry.update(cache, (current) =>
          current.revision === revision ? cacheLibraryItems(current, items(result)) : current,
        ),
      ),
    ),
  );
};

export function createLibraryEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | Crypto.Crypto | R, E>,
) {
  return {
    /** One page of the bounded Library list; the Library page asks for each page as it scrolls. */
    list: createEnvironmentCommand(runtime, {
      label: "environment-data:library:list",
      execute: (input: LibraryListQuery, registry, environmentId) =>
        cacheRead(registry, environmentId, request(WS_METHODS.libraryList, input), (page) => ({
          folders: [
            ...page.folders,
            ...page.items.flatMap((item) => (item.kind === "folder" ? [item.folder] : [])),
          ],
          files: page.items.flatMap((item) => (item.kind === "file" ? [item.file] : [])),
        })),
    }),
    getFile: createEnvironmentCommand(runtime, {
      label: "environment-data:library:get-file",
      execute: (input: { readonly fileId: LibraryFileId }, registry, environmentId) =>
        cacheRead(registry, environmentId, request(WS_METHODS.libraryGetFile, input), (result) => ({
          folders: result.folders,
          files: [result.file],
        })),
    }),
    getFolder: createEnvironmentCommand(runtime, {
      label: "environment-data:library:get-folder",
      execute: (input: { readonly folderId: LibraryFolderId }, registry, environmentId) =>
        cacheRead(
          registry,
          environmentId,
          request(WS_METHODS.libraryGetFolder, input),
          (result) => ({
            folders: [result.folder, ...result.folders],
          }),
        ),
    }),
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
    /**
     * The first page of skills this person sees and of the SKILL.md documents beneath them, read
     * once per Library revision for every screen and tag that names a skill.
     */
    skills: Atom.family((environmentId: EnvironmentId) =>
      runtime
        .atom((get) => {
          get(libraryRevisionAtom(environmentId));

          return runInEnvironment(
            environmentId,
            Effect.all(
              [
                request(WS_METHODS.libraryList, {
                  folder: LIBRARY_SKILLS_FOLDER_ID,
                  type: ["folder"],
                  sort: "title",
                }),
                request(WS_METHODS.libraryList, {
                  folder: LIBRARY_SKILLS_FOLDER_ID,
                  everywhere: true,
                  type: ["document"],
                  title: "SKILL",
                }),
              ],
              { concurrency: "unbounded" },
            ),
          );
        })
        .pipe(
          Atom.setIdleTTL(5 * 60_000),
          Atom.withLabel(`environment-data:library:skills:${environmentId}`),
        ),
    ),
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
