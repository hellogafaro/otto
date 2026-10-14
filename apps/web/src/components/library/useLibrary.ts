import { useAtomValue } from "@effect/atom-react";
import {
  type AtomCommandResult,
  squashAtomCommandFailure,
} from "@otto/client-runtime/state/runtime";
import {
  canEditLibraryItem,
  type EnvironmentId,
  type LibraryFile,
  type LibraryFileId,
  type LibraryFolder,
  type LibraryFolderId,
  LIBRARY_FILE_MAX_BYTES,
  type ThreadId,
} from "@otto/contracts";
import * as Predicate from "effect/Predicate";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useMemo, useRef, useState } from "react";

import { resolveAssetUrl } from "../../assets/assetUrls";
import { useI18n } from "../../i18n";
import { hasTag } from "../../lib/taggedUnion";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { libraryEnvironment } from "../../state/library";
import { usePreparedConnection } from "../../state/session";
import { environmentSnapshotAtom } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";
import { useWorkParticipants } from "../work/WorkParticipants";
import { libraryFailureText } from "./library.logic";

const EMPTY_FOLDERS: readonly LibraryFolder[] = [];

const EMPTY_FILES: readonly LibraryFile[] = [];

/** The Library as this person sees it; the server already left out what they can't. */
export function useLibraryData() {
  const environmentId = usePrimaryEnvironmentId();
  // SAFETY: the empty environment ID is an inactive-query sentinel; the atom sends no request until an environment exists.
  const snapshot = useAtomValue(environmentSnapshotAtom(environmentId ?? ("" as never)));
  const participants = useWorkParticipants(snapshot ?? null);
  const currentPersonId = snapshot?.currentPersonId ?? null;
  const folders = snapshot?.libraryFolders ?? EMPTY_FOLDERS;

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
    files: snapshot?.libraryFiles ?? EMPTY_FILES,
    threads: snapshot?.threads ?? [],
    participants,
    currentPersonId,
    canEdit,
  };
}

export type LibraryData = ReturnType<typeof useLibraryData>;

/** Why a Library change failed, as the server put it. */
export function useLibraryFailure() {
  return useCallback((result: AtomCommandResult<unknown, unknown>, title: string) => {
    const error = Predicate.isTagged(result, "Failure") ? squashAtomCommandFailure(result) : null;

    toastManager.add({
      type: "error",
      title,
      ...(error instanceof Error ? { description: libraryFailureText(error.message) } : {}),
    });
  }, []);
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
function useHttpBaseUrl() {
  const connection = usePreparedConnection(usePrimaryEnvironmentId());
  const ref = useRef<string | null>(null);
  ref.current = hasTag(connection, "None") ? null : connection.value.httpBaseUrl;

  return ref;
}

/** Starts a download of one file under its Library title. */
export function useLibraryDownload() {
  const { t } = useI18n();
  const createFileUrl = useAtomCommand(libraryEnvironment.createFileUrl, { reportFailure: false });
  const fail = useLibraryFailure();
  const httpBaseUrl = useHttpBaseUrl();

  return useCallback(
    async (environmentId: EnvironmentId, fileId: LibraryFileId) => {
      const result = await createFileUrl({ environmentId, input: { fileId, download: true } });
      const baseUrl = httpBaseUrl.current;

      if (!AsyncResult.isSuccess(result) || baseUrl === null) {
        return fail(result, t("Could not download the file"));
      }

      const url = resolveAssetUrl(baseUrl, result.value.relativeUrl);

      if (url !== null) window.location.assign(url);
    },
    [createFileUrl, fail, httpBaseUrl, t],
  );
}

/**
 * Uploads files one after another into a folder or a chat's folder. Each gets a short-lived
 * signed URL; the server reads the bytes to decide the type and records the file.
 */
export function useLibraryUpload() {
  const { t } = useI18n();

  const createUploadUrl = useAtomCommand(libraryEnvironment.createUploadUrl, {
    reportFailure: false,
  });

  const fail = useLibraryFailure();
  const httpBaseUrl = useHttpBaseUrl();
  const [uploading, setUploading] = useState(0);

  const upload = useCallback(
    async (
      environmentId: EnvironmentId,
      files: ReadonlyArray<File>,
      destination: { readonly folderId: LibraryFolderId | null; readonly threadId?: ThreadId },
    ) => {
      setUploading((count) => count + files.length);

      for (const file of files) {
        try {
          if (file.size === 0 || file.size > LIBRARY_FILE_MAX_BYTES) {
            toastManager.add({
              type: "error",
              title: t("Could not upload {name}", { name: file.name }),
              description:
                file.size === 0 ? t("That file is empty.") : t("Files can be at most 100 MB."),
            });

            continue;
          }

          const result = await createUploadUrl({
            environmentId,
            input: { ...destination, fileName: file.name, sizeBytes: file.size },
          });

          const baseUrl = httpBaseUrl.current;

          if (!AsyncResult.isSuccess(result) || baseUrl === null) {
            fail(result, t("Could not upload {name}", { name: file.name }));

            continue;
          }

          const url = resolveAssetUrl(baseUrl, result.value.relativeUrl);
          const response = url === null ? null : await fetch(url, { method: "POST", body: file });

          if (!response?.ok) {
            toastManager.add({
              type: "error",
              title: t("Could not upload {name}", { name: file.name }),
              ...(response ? { description: await response.text() } : {}),
            });
          }
        } finally {
          setUploading((count) => count - 1);
        }
      }
    },
    [createUploadUrl, fail, httpBaseUrl, t],
  );

  return useMemo(() => ({ upload, uploading: uploading > 0 }), [upload, uploading]);
}
