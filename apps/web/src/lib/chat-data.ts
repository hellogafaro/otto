import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { InferRequestType, InferResponseType } from "hono/client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { read, type workspaceApi } from "@/lib/api";
import { mentionUserIds } from "@/lib/mention-text";
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

const draftFrame = z.object({
  type: z.literal("drafts"),
  drafts: z
    .array(
      z.object({
        id: z.uuid(),
        runId: z.uuid(),
        agentId: z.uuid(),
        text: z.string().max(32768),
      }),
    )
    .max(512),
});

export function useChatDrafts(chatId?: string) {
  const { workspaceId, user } = useWorkspace();
  const [current, setCurrent] = useState<{
    scope: string;
    drafts: z.infer<typeof draftFrame>["drafts"];
  }>();
  const scope = `${user.id}:${workspaceId}:${chatId}`;
  useEffect(() => {
    if (!chatId) return;
    let disposed = false;
    let socket: WebSocket | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const clear = () => setCurrent(undefined);
    const connect = () => {
      const url = new URL("/api/realtime", window.location.origin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("workspaceId", workspaceId);
      url.searchParams.set("chatId", chatId);
      url.searchParams.set("drafts", "private");
      socket = new WebSocket(url);
      socket.onmessage = (event) => {
        if (disposed || typeof event.data !== "string") return;
        try {
          const frame = draftFrame.safeParse(JSON.parse(event.data));
          if (!frame.success) return;
          clearTimeout(expiry);
          setCurrent({ scope, drafts: frame.data.drafts });
          expiry = setTimeout(() => {
            clear();
            socket?.close();
          }, 5000);
        } catch {
          clear();
          socket?.close();
        }
      };
      socket.onerror = () => {
        if (!disposed) clear();
      };
      socket.onclose = (event) => {
        if (disposed) return;
        clearTimeout(expiry);
        clear();
        if (!disposed && ![4401, 4403].includes(event.code))
          reconnect = setTimeout(connect, 1000);
      };
    };
    connect();
    return () => {
      disposed = true;
      clearTimeout(reconnect);
      clearTimeout(expiry);
      socket?.close();
    };
  }, [chatId, workspaceId, scope]);
  return current?.scope === scope ? current.drafts : [];
}

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
  const { api, workspaceId, user } = useWorkspace();
  const query = useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "chat", chatId, "participants"],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      read(
        await api.chats[":id"].participants.$get(
          {
            param: { workspaceId, id: chatId ?? "" },
            query: { limit: "100", after: pageParam },
          },
          { init: { signal } },
        ),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
    select: (data) => ({
      items: data.pages.flatMap((page) => page.items),
      next: data.pages.at(-1)?.next ?? null,
    }),
    enabled: Boolean(chatId),
    refetchInterval: 5000,
    retry: false,
  });
  const currentParticipant = query.data?.items.find(
    (participant) => participant.userId === user.id,
  );
  // An unloaded explicit viewer must never inherit workspace contributor access.
  // Absence is authoritative only after the sealed participant cursor is exhausted.
  const authorityResolved = Boolean(
    query.data && !query.error && (currentParticipant || !query.hasNextPage),
  );
  const authorityPending = !query.error && !authorityResolved;
  const { fetchNextPage, hasNextPage, isFetching, error } = query;
  useEffect(() => {
    if (chatId && authorityPending && hasNextPage && !isFetching && !error) {
      // Multiple Chat/menu/Run observers share this query; join an existing fetch.
      void fetchNextPage({ cancelRefetch: false });
    }
  }, [chatId, authorityPending, hasNextPage, isFetching, error, fetchNextPage]);
  return { ...query, currentParticipant, authorityResolved, authorityPending };
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
      return read(
        await api.chats[":id"].messages.$post({
          param: { workspaceId, id: chatId },
          json: {
            ...input,
            requestId: attempt.current.requestId,
            mentionUserIds: mentionUserIds(input.body),
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
  const explicit = participants.currentParticipant;
  const canWrite = Boolean(
    chat &&
      !participants.isPending &&
      !participants.error &&
      participants.authorityResolved &&
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
      const after = previous.reduce(
        (cursor, item) => Math.max(cursor, item.cursor),
        0,
      );
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
    refetchInterval: enabled && activeRun(run) ? 2000 : false,
    retry: false,
  });
}
