import { useRef, useState } from "react";
import { uploadFile } from "@/lib/file-upload";
import { useWorkspace } from "@/lib/workspace";

/** Freeze upload placement/visibility per request so a retry never changes accepted metadata. */
export function useChatUpload(projectId?: string) {
  const { workspaceId, invalidate } = useWorkspace();
  const [visibility, setVisibility] = useState<"user" | "workspace">("user");
  const requests = useRef(
    new Map<string, { projectId?: string; visibility: "user" | "workspace" }>(),
  );
  const upload = async (file: File, requestId: string, signal: AbortSignal) => {
    let metadata = requests.current.get(requestId);
    if (!metadata) {
      metadata = { projectId, visibility };
      requests.current.set(requestId, metadata);
    }
    const saved = await uploadFile({
      workspaceId,
      file,
      requestId,
      signal,
      ...metadata,
    });
    await invalidate();
    return saved;
  };
  return { upload, visibility, setVisibility };
}
