import type { InferResponseType } from "hono/client";
import type { resourceTypes } from "@/components/task-meta";
import { ApiError, workspaceApi } from "@/lib/api";

export type SavedFile = InferResponseType<
  (typeof workspaceApi.files)[":id"]["$get"]
>;
export type SavedFolder = InferResponseType<
  (typeof workspaceApi.folders)[":id"]["$get"]
>;
export type SavedDocument = InferResponseType<
  (typeof workspaceApi.documents)[":id"]["$get"]
>;
/** View-only projection of an inferred File; optional references come from the originating screen. */
export type FilePresentation = Pick<SavedFile, "id" | "title"> &
  Partial<Pick<SavedFile, "ownerId" | "labels" | "visibility">> & {
    kind: keyof typeof resourceTypes;
    createdAt: string;
    preview?: string;
    url?: string;
    projectId?: string;
    folderId?: string;
    agentId?: string;
    chatId?: string;
    taskId?: string;
  };

export const PREVIEW_BYTES = 8 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 100_000_000;

export function fileKind(mediaType: string): FilePresentation["kind"] {
  if (mediaType.startsWith("image/")) return "image";
  if (mediaType.startsWith("video/")) return "video";
  if (mediaType.startsWith("audio/")) return "audio";
  if (mediaType.split(";")[0]?.trim() === "text/html") return "canvas";
  return "file";
}

export function savedResource(file: SavedFile): FilePresentation {
  return {
    id: file.id,
    title: file.title,
    kind: fileKind(file.mediaType),
    createdAt: file.createdAt ?? "",
    projectId: file.projectId ?? undefined,
    folderId: file.folderId ?? undefined,
    ownerId: file.ownerId,
    agentId: file.creatorAgentId ?? undefined,
    labels: file.labels,
    visibility: file.visibility,
  };
}

export function fileUrl(workspaceId: string, id: string) {
  return `/api${workspaceApi.files[":id"].file.$path({ param: { workspaceId, id } })}`;
}

/** The browser streams the verified attachment to disk instead of collecting a large Blob. */
export async function downloadFile(
  workspaceId: string,
  id: string,
  title: string,
) {
  const url = fileUrl(workspaceId, id);
  const response = await fetch(url, { method: "HEAD", credentials: "include" });
  if (!response.ok) throw new ApiError(response.status, "download_denied");
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = title;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

/** Enforce the small-consumer limit while reading, even if the server sends an unexpected body. */
export async function previewBytes(
  workspaceId: string,
  file: SavedFile,
  signal: AbortSignal,
) {
  if (file.byteLength > PREVIEW_BYTES)
    throw new Error(
      "Preview is limited to 8 MiB. Download this file to open it.",
    );
  const response = await fetch(fileUrl(workspaceId, file.id), {
    credentials: "include",
    signal,
  });
  return boundedFileBlob(response, file.byteLength, file.mediaType);
}

/** Shared by authenticated and anonymous frozen HTML previews; never reads an unbounded body. */
export async function boundedFileBlob(
  response: Pick<Response, "ok" | "status" | "body">,
  byteLength: number,
  mediaType: string,
) {
  if (!response.ok) throw new ApiError(response.status, "preview_failed");
  if (byteLength > PREVIEW_BYTES)
    throw new Error(
      "Preview is limited to 8 MiB. Download this file to open it.",
    );
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No file content was received.");
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > PREVIEW_BYTES || length > byteLength)
        throw new Error("File content exceeded the saved size.");
      parts.push(new Uint8Array(chunk.value));
    }
    if (length !== byteLength)
      throw new Error("File transfer was incomplete. Retry the preview.");
    return new Blob(parts, { type: mediaType });
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
