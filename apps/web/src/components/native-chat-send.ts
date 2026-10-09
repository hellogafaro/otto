import { useMutation } from "@tanstack/react-query";
import { useRef } from "react";
import { ApiError, read } from "@/lib/api";
import { mentionUserIds } from "@/lib/mention-text";
import { useWorkspace } from "@/lib/workspace";

type SendInput = {
  chatId: string;
  body: string;
  fileIds: string[];
  replyTo?: string;
  agentIds: string[];
};

export function useNativeChatSend() {
  const { api, workspaceId, invalidate } = useWorkspace();
  const attempt = useRef<{
    input: SendInput;
    requestId: string;
    messageId?: string;
    runs: { agentId: string; requestId: string; accepted: boolean }[];
  } | null>(null);
  const send = useMutation({
    mutationFn: async (input: SendInput) => {
      input = attempt.current?.input ?? input;
      if (!input.body.trim())
        throw new Error("Add message text before sending attachments.");
      if (input.fileIds.length > 30)
        throw new Error("A message can attach at most 30 files.");
      attempt.current ??= {
        input,
        requestId: crypto.randomUUID(),
        runs: input.agentIds.map((agentId) => ({
          agentId,
          requestId: crypto.randomUUID(),
          accepted: false,
        })),
      };
      const current = attempt.current;
      if (!current.messageId) {
        try {
          const message = await read(
            await api.chats[":id"].messages.$post({
              param: { workspaceId, id: input.chatId },
              json: {
                body: input.body,
                fileIds: input.fileIds,
                replyTo: input.replyTo,
                mentionUserIds: mentionUserIds(input.body),
                requestId: current.requestId,
              },
            }),
          );
          current.messageId = message.id;
        } catch (error) {
          if (error instanceof ApiError && error.status < 500)
            attempt.current = null;
          throw error;
        }
      }
      for (const run of current.runs) {
        if (run.accepted) continue;
        await read(
          await api.runs.$post({
            param: { workspaceId },
            json: {
              chatId: input.chatId,
              agentId: run.agentId,
              type: "prompt",
              sessionMode: "auto",
              body: input.body,
              messageIds: [current.messageId],
              requestId: run.requestId,
            },
          }),
        );
        run.accepted = true;
      }
      attempt.current = null;
    },
    onSettled: () => invalidate(),
    retry: false,
  });
  return {
    ...send,
    locked: Boolean(attempt.current),
    messageSaved: Boolean(attempt.current?.messageId),
    reset: () => {
      attempt.current = null;
      send.reset();
    },
  };
}
