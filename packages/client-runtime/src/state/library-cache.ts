import {
  type EnvironmentId,
  type LibraryFile,
  type LibraryFileId,
  type LibraryFolder,
  type LibraryFolderId,
  libraryFolderPath,
  type OrchestrationShellStreamItem,
} from "@otto/contracts";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

/**
 * Otto: The Library folders and files this client has read, by id. Lists and gets fill it; the
 * shell stream's changes keep it current and count in `revision`, which tells open lists to load
 * again. A new shell snapshot may follow a change in who sees what, so the cache starts over.
 */
export interface LibraryCache {
  readonly folders: ReadonlyMap<LibraryFolderId, LibraryFolder>;
  readonly files: ReadonlyMap<LibraryFileId, LibraryFile>;
  readonly revision: number;
}

const EMPTY_LIBRARY_CACHE: LibraryCache = { folders: new Map(), files: new Map(), revision: 0 };

export const libraryCacheAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(EMPTY_LIBRARY_CACHE).pipe(
    Atom.keepAlive,
    Atom.withLabel(`environment-data:library:cache:${environmentId}`),
  ),
);

/** Moves on with every Library change the shell stream brings. */
export const libraryRevisionAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) => get(libraryCacheAtom(environmentId)).revision).pipe(
    Atom.withLabel(`environment-data:library:revision:${environmentId}`),
  ),
);

export function cacheLibraryItems(
  cache: LibraryCache,
  items: {
    readonly folders?: ReadonlyArray<LibraryFolder>;
    readonly files?: ReadonlyArray<LibraryFile>;
  },
): LibraryCache {
  const folders = new Map(cache.folders);
  const files = new Map(cache.files);

  for (const folder of items.folders ?? []) folders.set(folder.id, folder);

  for (const file of items.files ?? []) files.set(file.id, file);

  return { ...cache, folders, files };
}

/** Whether every folder from `folderId` up to the top is cached. */
export function libraryPathCached(cache: LibraryCache, folderId: LibraryFolderId | null) {
  const path = libraryFolderPath([...cache.folders.values()], folderId);

  return folderId === null || (path.length > 0 && path.at(-1)?.parentId === null);
}

export function applyLibraryShellItem(
  cache: LibraryCache,
  item: OrchestrationShellStreamItem,
): LibraryCache {
  const revision = cache.revision + 1;

  switch (item.kind) {
    case "snapshot":
      return { ...EMPTY_LIBRARY_CACHE, revision };
    case "library-folder-upserted":
      return { ...cacheLibraryItems(cache, { folders: [item.folder] }), revision };
    case "library-file-upserted":
      return { ...cacheLibraryItems(cache, { files: [item.file] }), revision };
    case "library-file-removed": {
      const files = new Map(cache.files);
      files.delete(item.fileId);

      return { ...cache, files, revision };
    }

    case "library-folder-removed": {
      const cached = [...cache.folders.values()];

      const under = (parentId: LibraryFolderId | null) =>
        parentId === item.folderId ||
        libraryFolderPath(cached, parentId).some((folder) => folder.id === item.folderId);

      return {
        folders: new Map(
          [...cache.folders].filter(
            ([id, folder]) => id !== item.folderId && !under(folder.parentId),
          ),
        ),
        files: new Map([...cache.files].filter(([, file]) => !under(file.folderId))),
        revision,
      };
    }

    default:
      return cache;
  }
}

/** Applies one shell stream item to the environment's Library cache. */
export function recordLibraryShellItem(
  registry: AtomRegistry.AtomRegistry,
  environmentId: EnvironmentId,
  item: OrchestrationShellStreamItem,
) {
  registry.update(libraryCacheAtom(environmentId), (cache) => applyLibraryShellItem(cache, item));
}
