import { useAtomValue } from "@effect/atom-react";
import {
  libraryCacheAtom,
  libraryPathCached,
  libraryRevisionAtom,
} from "@otto/client-runtime/state/library";
import {
  canEditLibraryItem,
  type EnvironmentId,
  type LibraryFile,
  LibraryFileId,
  type LibraryFolder,
  LibraryFolderId,
  isSkillFile,
  LIBRARY_FILE_MAX_BYTES,
  type LibraryListQuery,
  type LibraryListResult,
  type ProjectId,
  type ThreadId,
} from "@otto/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { resolveAssetUrl } from "../../assets/asset-urls";
import { useListPages } from "../../hooks/use-list-pages";
import { useI18n } from "../../i18n";
import { hasTag } from "../../lib/tagged-union";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { libraryEnvironment } from "../../state/library";
import { usePreparedConnection } from "../../state/session";
import { environmentSnapshotAtom } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { toast } from "sonner";
import { useWorkParticipants } from "../work/work-participants";

// SAFETY: the empty environment ID is an inactive-query sentinel; the atom sends no request until an environment exists.
const NO_ENVIRONMENT = "" as EnvironmentId;

/**
 * Otto: The Library as this person sees it: the folders read so far, from the server's lists and
 * gets, which already leave out what they can't see.
 */
export function useLibraryData() {
  const environmentId = usePrimaryEnvironmentId();
  const snapshot = useAtomValue(environmentSnapshotAtom(environmentId ?? NO_ENVIRONMENT));
  const cached = useAtomValue(libraryCacheAtom(environmentId ?? NO_ENVIRONMENT)).folders;
  const participants = useWorkParticipants(snapshot ?? null);
  const currentPersonId = snapshot?.currentPersonId ?? null;
  const folders = useMemo(() => [...cached.values()], [cached]);

  const canEdit = useCallback(
    (item: LibraryFolder | LibraryFile) =>
      currentPersonId !== null &&
      canEditLibraryItem(item, folders, { kind: "person", personId: currentPersonId }),
    [currentPersonId, folders],
  );

  return {
    environmentId,
    loaded: snapshot !== null && snapshot !== undefined,
    folders,
    participants,
    currentPersonId,
    canEdit,
  };
}

export type LibraryData = ReturnType<typeof useLibraryData>;

const nextLibraryCursor = (page: LibraryListResult) => page.nextCursor;

/**
 * Otto: A bounded Library list read page by page, loaded again in place whenever a Library change
 * arrives. `all` keeps loading pages until the end, for the few places that need every match;
 * without an environment it asks nothing.
 */
export function useLibraryPages(
  environmentId: EnvironmentId | null,
  query: Omit<LibraryListQuery, "cursor">,
  { all = false }: { readonly all?: boolean } = {},
) {
  const listLibrary = useAtomCommand(libraryEnvironment.list, { reportFailure: false });
  const revision = useAtomValue(libraryRevisionAtom(environmentId ?? NO_ENVIRONMENT));

  const list = useListPages({
    view: `${environmentId}:${JSON.stringify(query)}`,
    revision,
    getNextCursor: nextLibraryCursor,
    fetchPage: async (cursor) => {
      if (!environmentId) return null;

      const result = await listLibrary({
        environmentId,
        input: cursor === undefined ? query : { ...query, cursor },
      });

      return AsyncResult.isSuccess(result) ? result.value : null;
    },
  });

  const { hasMore, status, loadMore } = list;

  useEffect(() => {
    if (all && hasMore && status === "ready") loadMore();
  }, [all, hasMore, status, loadMore]);

  const loaded = useMemo(() => {
    const items = list.pages.flatMap((page) => page.items);

    return {
      items,
      folders: items.flatMap((item) => (item.kind === "folder" ? [item.folder] : [])),
      files: items.flatMap((item) => (item.kind === "file" ? [item.file] : [])),
    };
  }, [list.pages]);

  return { ...list, ...loaded, loading: list.status === "loading" && list.pages.length === 0 };
}

const byTitle = (left: LibraryFolder, right: LibraryFolder) =>
  left.title.localeCompare(right.title);

const NO_SKILLS: readonly [LibraryListResult, LibraryListResult] = [
  { items: [], folders: [], nextCursor: null },
  { items: [], folders: [], nextCursor: null },
];

/** The skills this person sees, A to Z, with each one's SKILL.md. */
export function useLibrarySkills(environmentId: EnvironmentId | null) {
  const result = useAtomValue(libraryEnvironment.skills(environmentId ?? NO_ENVIRONMENT));
  const [folders, documents] = Option.getOrElse(AsyncResult.value(result), () => NO_SKILLS);

  const skills = useMemo(
    () =>
      folders.items
        .flatMap((item) => (item.kind === "folder" ? [item.folder] : []))
        .toSorted(byTitle),
    [folders],
  );

  const main = useCallback(
    (skillId: LibraryFolderId) =>
      documents.items
        .flatMap((item) => (item.kind === "file" ? [item.file] : []))
        .find((file) => file.folderId === skillId && isSkillFile(file)),
    [documents],
  );

  return { skills, main, loading: environmentId !== null && AsyncResult.isInitial(result) };
}

const isFileId = Schema.is(LibraryFileId);

const isFolderId = Schema.is(LibraryFolderId);

function useLibraryCache(environmentId: EnvironmentId | null) {
  return useAtomValue(libraryCacheAtom(environmentId ?? NO_ENVIRONMENT));
}

/**
 * Otto: Reads what the cache lacks from the server once per `key`, which moves on with the
 * Library's revision. Resolves to whether that read found nothing the person may see.
 */
function useLibraryRead(key: string | null, read: () => Promise<boolean>) {
  const [missing, setMissing] = useState<string | null>(null);
  const latestRead = useRef(read);
  latestRead.current = read;

  useEffect(() => {
    if (key === null) return;
    let current = true;

    void latestRead.current().then((found) => {
      if (current && !found) setMissing(key);
    });

    return () => {
      current = false;
    };
  }, [key]);

  return key !== null && missing === key;
}

/**
 * One file by id with every folder above it, from the cache or else the server. It is loading
 * until that read answers, then null when the file is missing or hidden.
 */
export function useLibraryFile(environmentId: EnvironmentId | null, fileId: string | null) {
  const cache = useLibraryCache(environmentId);
  const getFile = useAtomCommand(libraryEnvironment.getFile, { reportFailure: false });
  const id = environmentId !== null && fileId !== null && isFileId(fileId) ? fileId : null;
  const file = id === null ? undefined : cache.files.get(id);
  const complete = file !== undefined && libraryPathCached(cache, file.folderId);

  const missing = useLibraryRead(
    id === null || complete ? null : `${environmentId}:${id}:${cache.revision}`,
    async () =>
      environmentId !== null &&
      id !== null &&
      AsyncResult.isSuccess(await getFile({ environmentId, input: { fileId: id } })),
  );

  return { file: file ?? null, loading: id !== null && file === undefined && !missing };
}

/** One folder by id with every folder above it, from the cache or else the server. */
export function useLibraryFolder(environmentId: EnvironmentId | null, folderId: string | null) {
  const cache = useLibraryCache(environmentId);
  const getFolder = useAtomCommand(libraryEnvironment.getFolder, { reportFailure: false });
  const id = environmentId !== null && folderId !== null && isFolderId(folderId) ? folderId : null;
  const folder = id === null ? undefined : cache.folders.get(id);
  const complete = folder !== undefined && libraryPathCached(cache, folder.id);

  const missing = useLibraryRead(
    id === null || complete ? null : `${environmentId}:${id}:${cache.revision}`,
    async () =>
      environmentId !== null &&
      id !== null &&
      AsyncResult.isSuccess(await getFolder({ environmentId, input: { folderId: id } })),
  );

  return { id, folder: folder ?? null, loading: id !== null && folder === undefined && !missing };
}

/** A signed URL for showing one file; it refreshes before it expires. */
export function useLibraryFileUrl(environmentId: EnvironmentId, fileId: LibraryFileId) {
  const preparedConnection = usePreparedConnection(environmentId);
  const result = useAtomValue(libraryEnvironment.fileUrl({ environmentId, input: { fileId } }));

  if (!AsyncResult.isSuccess(result) || hasTag(preparedConnection, "None")) return null;

  return resolveAssetUrl(preparedConnection.value.httpBaseUrl, result.value.relativeUrl);
}

/**
 * The HTTP base for upload and download URLs. Subscribing keeps the prepared connection alive
 * even when nothing on the page shows a file yet.
 */
export function useHttpBaseUrl() {
  const connection = usePreparedConnection(usePrimaryEnvironmentId());
  const ref = useRef<string | null>(null);
  ref.current = hasTag(connection, "None") ? null : connection.value.httpBaseUrl;

  return ref;
}

/** Starts a download of one file under its Library title. */
export function useLibraryDownload() {
  const { t } = useI18n();
  const createFileUrl = useAtomCommand(libraryEnvironment.createFileUrl, { reportFailure: false });
  const httpBaseUrl = useHttpBaseUrl();

  return useCallback(
    async (environmentId: EnvironmentId, fileId: LibraryFileId) => {
      const result = await createFileUrl({ environmentId, input: { fileId, download: true } });
      const baseUrl = httpBaseUrl.current;

      if (!AsyncResult.isSuccess(result) || baseUrl === null) {
        return toast.error(t("File couldn't be downloaded"));
      }

      const url = resolveAssetUrl(baseUrl, result.value.relativeUrl);

      if (url !== null) window.location.assign(url);
    },
    [createFileUrl, httpBaseUrl, t],
  );
}

/**
 * Uploads files one after another into a folder, a chat's folder or a project's folder. Each gets a short-lived
 * signed URL; the server reads the bytes to decide the type and records the file. Resolves
 * to the ids of the files that were stored.
 */
export function useLibraryUpload() {
  const { t } = useI18n();

  const createUploadUrl = useAtomCommand(libraryEnvironment.createUploadUrl, {
    reportFailure: false,
  });

  const httpBaseUrl = useHttpBaseUrl();
  const [uploading, setUploading] = useState(0);

  const upload = useCallback(
    async (
      environmentId: EnvironmentId,
      files: ReadonlyArray<File>,
      destination: {
        readonly folderId: LibraryFolderId | null;
        readonly threadId?: ThreadId;
        /** Files the project's folder, made on first use; overrides `folderId`. */
        readonly projectId?: ProjectId;
      },
    ) => {
      setUploading((count) => count + files.length);
      const stored: LibraryFileId[] = [];

      for (const file of files) {
        try {
          if (file.size === 0 || file.size > LIBRARY_FILE_MAX_BYTES) {
            toast.error(
              file.size === 0
                ? t("{name} is empty", { name: file.name })
                : t("{name} is larger than 100 MB", { name: file.name }),
            );

            continue;
          }

          const result = await createUploadUrl({
            environmentId,
            input: { ...destination, fileName: file.name, sizeBytes: file.size },
          });

          const baseUrl = httpBaseUrl.current;

          if (!AsyncResult.isSuccess(result) || baseUrl === null) {
            toast.error(t("{name} couldn't be uploaded", { name: file.name }));

            continue;
          }

          const url = resolveAssetUrl(baseUrl, result.value.relativeUrl);
          const response = url === null ? null : await fetch(url, { method: "POST", body: file });

          if (response?.ok) {
            stored.push(result.value.fileId);

            continue;
          }

          toast.error(t("{name} couldn't be uploaded", { name: file.name }));
        } finally {
          setUploading((count) => count - 1);
        }
      }

      return stored;
    },
    [createUploadUrl, httpBaseUrl, t],
  );

  return useMemo(() => ({ upload, uploading: uploading > 0 }), [upload, uploading]);
}
