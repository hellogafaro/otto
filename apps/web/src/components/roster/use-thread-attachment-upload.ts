import type { EnvironmentId } from "@otto/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback } from "react";

import { resolveAssetUrl } from "../../assets/asset-urls";
import { libraryEnvironment } from "../../state/library";
import { useAtomCommand } from "../../state/use-atom-command";
import { useHttpBaseUrl } from "../library/use-library";
import type { UploadThreadAttachment } from "./thread-runtime-attachments";

/** Uploads a chat file through a signed URL, the way Library files upload, for up to 100 MB. */
export function useThreadAttachmentUpload() {
  const createUploadUrl = useAtomCommand(libraryEnvironment.createAttachmentUploadUrl, {
    reportFailure: false,
  });

  const httpBaseUrl = useHttpBaseUrl();

  return useCallback(
    (environmentId: EnvironmentId): UploadThreadAttachment =>
      async (file, mimeType) => {
        const result = await createUploadUrl({
          environmentId,
          input: { name: file.name, mimeType, sizeBytes: file.size },
        });

        const baseUrl = httpBaseUrl.current;

        const url =
          AsyncResult.isSuccess(result) && baseUrl !== null
            ? resolveAssetUrl(baseUrl, result.value.relativeUrl)
            : null;

        const response = url === null ? null : await fetch(url, { method: "POST", body: file });

        if (!AsyncResult.isSuccess(result) || !response?.ok) {
          throw new Error(`Could not upload ${file.name}.`);
        }

        return result.value.attachmentId;
      },
    [createUploadUrl, httpBaseUrl],
  );
}
