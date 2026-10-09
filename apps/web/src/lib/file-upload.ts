import type { FileRef } from "@/components/composer";
import { read, workspaceApi } from "@/lib/api";
import { fileKind, fileUrl, MAX_UPLOAD_BYTES } from "@/lib/file-library";

/** Retry with the same File, requestId and metadata; an abort can leave an unacknowledged saved upload. */
export async function uploadFile({
  workspaceId,
  file,
  requestId,
  signal,
  projectId,
  folderId,
  visibility = "user",
}: {
  workspaceId: string;
  file: File;
  requestId: string;
  signal: AbortSignal;
  projectId?: string;
  folderId?: string;
  visibility?: "user" | "workspace";
}): Promise<FileRef> {
  if (!file.name.trim() || file.name.trim().length > 200)
    throw new Error(
      "Rename this file to a title of 1–200 characters before uploading.",
    );
  if (file.size > MAX_UPLOAD_BYTES)
    throw new Error("A file can be at most 100,000,000 bytes.");
  const path = `/api${workspaceApi.files[":requestId"].content.$path({ param: { workspaceId, requestId } })}`;
  const query = new URLSearchParams({
    title: file.name,
    type: fileKind(file.type),
    mediaType: file.type || "application/octet-stream",
    visibility,
    ...(projectId ? { projectId } : {}),
    ...(folderId ? { folderId } : {}),
  }).toString();
  const response = await workspaceApi.files[":requestId"].content.$put(
    { param: { workspaceId, requestId } },
    {
      // Binary route has no validator; URL and raw File body override the empty Hono request.
      init: {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
        signal,
      },
      fetch: (_input: RequestInfo | URL, init?: RequestInit) =>
        fetch(`${path}?${query}`, init),
    },
  );
  if (!response.ok && response.status === 413)
    throw new Error("A file can be at most 100,000,000 bytes.");
  const saved = await read(response);
  return {
    id: saved.id,
    name: saved.title,
    type: saved.mediaType,
    size: saved.byteLength,
    url: fileUrl(workspaceId, saved.id),
  };
}
