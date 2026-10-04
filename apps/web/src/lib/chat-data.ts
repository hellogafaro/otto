import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { InferRequestType, InferResponseType } from "hono/client";
import { useRef } from "react";
import { read, type workspaceApi } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

export type LiveChat = InferResponseType<
  (typeof workspaceApi.chats)[":id"]["$get"]
>;
export type LiveMessage = InferResponseType<
  (typeof workspaceApi.chats)[":id"]["messages"]["$get"]
>[number];
export type LiveRun = InferResponseType<
  (typeof workspaceApi.runs)[":id"]["$get"]
>;
export type ChatFilters = Omit<
  InferRequestType<(typeof workspaceApi.chats)["$get"]>["query"],
  "after" | "limit"
>;

export function useChats(filters: ChatFilters = {}) {
  const { api, workspaceId } = useWorkspace();
  return useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "chats", filters],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      read(
        await api.chats.$get({
          param: { workspaceId },
          query: {
            limit: "100",
            sort: "updatedAt",
            order: "desc",
            ...filters,
            after: pageParam,
          },
        }),
      ),
    getNextPageParam: (last) => last.next ?? undefined,
    refetchInterval: 5000,
    retry: false,
  });
}

export function useChat(chatId?: string) {
  const { api, workspaceId } = useWorkspace();
  return useQuery({
    queryKey: ["workspace", workspaceId, "chat", chatId],
    queryFn: async () =>
      read(
        await api.chats[":id"].$get({
          param: { workspaceId, id: chatId ?? "" },
        }),
      ),
    enabled: Boolean(chatId),
    refetchInterval: 5000,
    retry: false,
  });
}

export function useParticipants(chatId?: string) {
  const { api, workspaceId } = useWorkspace();
  return useQuery({
    queryKey: ["workspace", workspaceId, "chat", chatId, "participants"],
    queryFn: async () =>
      read(
        await api.chats[":id"].participants.$get({
          param: { workspaceId, id: chatId ?? "" },
          query: { limit: "100" },
        }),
      ),
    enabled: Boolean(chatId),
    refetchInterval: 5000,
    retry: false,
  });
}

// Replay advances only to a cursor actually returned by this Chat. Each HTTP batch is bounded at 100.
// Polling catches up long history without dropping messages or treating metadata timestamps as activity.
export function useChatMessages(chatId?: string, active = true) {
  const { api, workspaceId } = useWorkspace();
  const cache = useQueryClient();
  const queryKey = ["workspace", workspaceId, "chat", chatId, "messages"];
  return useQuery({
    queryKey,
    queryFn: async () => {
      const previous = cache.getQueryData<LiveMessage[]>(queryKey) ?? [];
      const batch = await read(
        await api.chats[":id"].messages.$get({
          param: { workspaceId, id: chatId ?? "" },
          query: { after: String(previous.at(-1)?.cursor ?? 0) },
        }),
      );
      const seen = new Set(previous.map((message) => message.id));
      return [...previous, ...batch.filter((message) => !seen.has(message.id))];
    },
    enabled: Boolean(chatId) && active,
    refetchInterval: active ? 2000 : false,
    retry: false,
  });
}

// Retry the exact request identity after a lost acknowledgement; edited drafts intentionally get a new ID.
export function useMessageSend(chatId?: string) {
  const { api, workspaceId, invalidate } = useWorkspace();
  const attempt = useRef({ signature: "", requestId: "" });
  return useMutation({
    mutationFn: async (input: {
      body: string;
      fileIds?: string[];
      replyTo?: string;
    }) => {
      if (!chatId) throw new Error("Open a chat before sending.");
      if (!input.body.trim())
        throw new Error("Add message text before sending attachments.");
      if ((input.fileIds?.length ?? 0) > 30)
        throw new Error(
          "A message can attach at most 30 files. Remove extra attachments and retry.",
        );
      const signature = JSON.stringify([chatId, input]);
      if (signature !== attempt.current.signature)
        attempt.current = { signature, requestId: crypto.randomUUID() };
      const mentionUserIds = [
        ...new Set(
          Array.from(
            input.body.matchAll(/@\[[^\]]+\]\(user:([^)]+)\)/g),
            (match) => match[1],
          ),
        ),
      ];
      return read(
        await api.chats[":id"].messages.$post({
          param: { workspaceId, id: chatId },
          json: {
            ...input,
            requestId: attempt.current.requestId,
            mentionUserIds,
          },
        }),
      );
    },
    onSuccess: async () => {
      attempt.current = { signature: "", requestId: "" };
      await invalidate();
    },
  });
}

export function useChatRuns(chatId?: string) {
  const { api, workspaceId } = useWorkspace();
  return useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "chat", chatId, "runs"],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      read(
        await api.runs.$get({
          param: { workspaceId },
          query: {
            chatId,
            limit: "100",
            sort: "createdAt",
            order: "desc",
            after: pageParam,
          },
        }),
      ),
    getNextPageParam: (page) =>
      typeof page.next === "string" ? page.next : undefined,
    enabled: Boolean(chatId),
    refetchInterval: 2000,
    retry: false,
  });
}

export function useChatSessions(chatId?: string, agentId?: string) {
  const { api, workspaceId } = useWorkspace();
  return useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "chat", chatId, "sessions", agentId],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      read(
        await api.chats[":id"].sessions.$get({
          param: { workspaceId, id: chatId ?? "" },
          query: {
            agentId,
            limit: "100",
            sort: "createdAt",
            order: "desc",
            after: pageParam,
          },
        }),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
    enabled: Boolean(chatId),
    retry: false,
  });
}

export function useChatPermissions(
  chat: LiveChat | undefined,
  participants: ReturnType<typeof useParticipants>,
) {
  const { workspace, user } = useWorkspace();
  const explicit = participants.data?.items.find(
    (item) => item.userId === user.id,
  );
  const canWrite = Boolean(
    chat &&
      !participants.isPending &&
      !participants.error &&
      workspace.role !== "viewer" &&
      explicit?.role !== "viewer" &&
      (chat.visibility === "workspace" || explicit?.role === "contributor"),
  );
  return { canWrite, canManage: canWrite && chat?.createdBy === user.id };
}

export const activeRun = (run: LiveRun) =>
  ["queued", "launching", "running", "uncertain"].includes(run.state);

export type LiveActivity = InferResponseType<
  (typeof workspaceApi.runs)[":id"]["activity"]["$get"]
>[number];
export function useRunActivity(run: LiveRun, enabled: boolean) {
  const { api, workspaceId } = useWorkspace();
  const cache = useQueryClient();
  const queryKey = ["workspace", workspaceId, "run", run.id, "activity"];
  return useQuery({
    queryKey,
    queryFn: async () => {
      const previous = cache.getQueryData<LiveActivity[]>(queryKey) ?? [];
      const after = Math.max(0, ...previous.map((item) => item.cursor));
      const batch = await read(
        await api.runs[":id"].activity.$get({
          param: { workspaceId, id: run.id },
          query: { after: String(after) },
        }),
      );
      const merged = new Map(previous.map((item) => [item.id, item]));
      for (const item of batch) merged.set(item.id, item);
      return [...merged.values()].sort((a, b) => a.cursor - b.cursor);
    },
    enabled,
    refetchInterval: enabled ? 2000 : false,
    retry: false,
  });
}
