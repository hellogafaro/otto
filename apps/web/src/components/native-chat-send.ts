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
};

export function useNativeChatSend() {
  const { api, workspaceId, invalidate } = useWorkspace();
  const attempt = useRef<{
    input: SendInput;
    requestId: string;
    messageId?: string;
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
      };
      const current = attempt.current;
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
        if (message.replyErrors.length)
          throw new Error(
            message.replyErrors.map((reply) => reply.message).join(" "),
          );
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.status < 500 &&
          !current.messageId
        )
          attempt.current = null;
        throw error;
      }
      attempt.current = null;
    },
    onSettled: () => invalidate(),
    retry: false,
  });
  return {
    ...send,
    locked: Boolean(attempt.current),
    replyTo: attempt.current?.input.replyTo,
    messageSaved: Boolean(attempt.current?.messageId),
    reset: () => {
      attempt.current = null;
      send.reset();
    },
  };
}
