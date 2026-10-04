import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
} from "@workspace/ui/components/context-menu";
import { toast } from "@workspace/ui/components/sonner";
import { useState } from "react";
import {
  type DocumentRecord,
  useDocumentWriter,
} from "@/components/documents/document-data";
import { useAskAgent } from "@/components/floating-chat";
import { read } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

export function DocumentMenu({
  id,
  document,
}: {
  id: string;
  document?: DocumentRecord;
}) {
  const { api, workspaceId, user, invalidate } = useWorkspace();
  const cache = useQueryClient();
  const navigate = useNavigate();
  const ask = useAskAgent();
  const { canWrite } = useDocumentWriter(document?.projectId);
  const [pending, setPending] = useState(false);
  async function archive() {
    if (!document) return;
    setPending(true);
    try {
      const next = await read(
        await api.documents[":id"].archive.$post({
          param: { workspaceId, id },
          json: { archived: !document.archived, editToken: document.editToken },
        }),
      );
      cache.setQueryData(["workspace", workspaceId, "document", id], next);
      await invalidate();
      toast.success(
        document.archived ? "Document restored" : "Document archived",
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to change archive state.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <ContextMenuContent className="w-48">
      <ContextMenuGroup>
        <ContextMenuItem
          onClick={() =>
            navigate({
              to: "/documents/$documentId",
              params: { documentId: id },
            })
          }
        >
          Open document
        </ContextMenuItem>
        {document && (
          <ContextMenuItem
            onClick={() =>
              ask(`In the document "${document.title}" (/documents/${id}), `)
            }
          >
            Ask about it
          </ContextMenuItem>
        )}
        <ContextMenuItem
          shortcut="C"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                `${location.origin}/documents/${id}`,
              );
              toast.success("Link copied");
            } catch {
              toast.error("Unable to copy link.");
            }
          }}
        >
          Copy link
        </ContextMenuItem>
        {document && document.createdBy === user.id && canWrite && (
          <ContextMenuItem shortcut="A" disabled={pending} onClick={archive}>
            {document.archived ? "Restore" : "Archive"}
          </ContextMenuItem>
        )}
      </ContextMenuGroup>
    </ContextMenuContent>
  );
}
