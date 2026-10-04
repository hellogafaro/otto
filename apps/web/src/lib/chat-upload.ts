import { useRef } from "react";
import { uploadFile } from "@/lib/file-upload";
import { useWorkspace } from "@/lib/workspace";

/** Freeze upload placement per request so a retry never changes accepted metadata. */
export function useChatUpload(projectId?: string) {
  const { workspaceId, invalidate } = useWorkspace();
  const requests = useRef(new Map<string, { projectId?: string }>());
  const upload = async (file: File, requestId: string, signal: AbortSignal) => {
    let metadata = requests.current.get(requestId);
    if (!metadata) {
      metadata = { projectId };
      requests.current.set(requestId, metadata);
    }
    // The File stays private to its custodian; the Chat's participants read it through the Chat.
    const saved = await uploadFile({
      workspaceId,
      file,
      requestId,
      signal,
      visibility: "user",
      ...metadata,
    });
    await invalidate();
    return saved;
  };
  return { upload };
}
