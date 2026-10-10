import { useQueries, useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { z } from "zod";
import { read } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

const reference = z.object({
  type: z.enum(["chat", "task", "project", "schedule", "document"]),
  id: z.uuid(),
});
export type NavigationReference = z.infer<typeof reference>;
export type NavigationItem = NavigationReference & {
  title: string;
  href: string;
};
const historySchema = z.object({
  pins: z.array(reference).max(12),
  recents: z.array(reference).max(20),
});
type NavigationHistory = z.infer<typeof historySchema>;
const emptyHistory: NavigationHistory = { pins: [], recents: [] };
const context = createContext<{
  pins: NavigationItem[];
  recents: NavigationItem[];
  attention: Map<string, "Unread" | "Awaiting answer">;
  attentionError: Error | null;
  attentionPending: boolean;
  retryAttention(): void;
  moreAttention: boolean;
  isPinned(item: NavigationReference): boolean;
  togglePin(item: NavigationReference): void;
  forget(item: NavigationReference): void;
  pinLimit: boolean;
} | null>(null);

function same(a: NavigationReference, b: NavigationReference) {
  return a.type === b.type && a.id === b.id;
}

export function navigationHref(item: NavigationReference) {
  const paths = {
    chat: "/chats/",
    task: "/tasks/",
    project: "/projects/",
    schedule: "/schedules/",
    document: "/library/documents/",
  };
  return `${paths[item.type]}${item.id}`;
}

function locationReference(pathname: string) {
  const match =
    /^(?:\/(chats|tasks|projects|schedules)|\/library\/(documents))\/([^/]+)$/.exec(
      pathname,
    );
  if (!match) return undefined;
  const types = {
    chats: "chat",
    tasks: "task",
    projects: "project",
    schedules: "schedule",
    documents: "document",
  };
  const section = match[1] ?? match[2];
  const type = types[section as keyof typeof types];
  return reference.safeParse({ type, id: match[3] }).data;
}

export function useNavigation() {
  const value = useContext(context);
  if (!value) throw new Error("Navigation provider is missing");
  return value;
}

export function NavigationProvider({ children }: { children: ReactNode }) {
  const { user, workspaceId, api } = useWorkspace();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const key = `otto-navigation:${user.id}:${workspaceId}`;
  const [history, setHistory] = useState<NavigationHistory>(() => {
    try {
      return (
        historySchema.safeParse(JSON.parse(localStorage.getItem(key) ?? "null"))
          .data ?? emptyHistory
      );
    } catch {
      return emptyHistory;
    }
  });
  useEffect(() => {
    const item = locationReference(pathname);
    if (!item) return;
    setHistory((previous) => ({
      ...previous,
      recents: [
        item,
        ...previous.recents.filter((saved) => !same(saved, item)),
      ].slice(0, 20),
    }));
  }, [pathname]);
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(history));
    } catch {
      return;
    }
  }, [history, key]);

  const references = [...history.pins, ...history.recents].filter(
    (item, index, items) =>
      items.findIndex((other) => same(item, other)) === index,
  );
  const resolved = useQueries({
    queries: references.map((item) => ({
      queryKey: ["workspace", workspaceId, item.type, item.id],
      queryFn: async ({
        signal,
      }: {
        signal: AbortSignal;
      }): Promise<{ title: string }> => {
        const params = { param: { workspaceId, id: item.id } };
        const options = { init: { signal } };
        const resource =
          item.type === "chat"
            ? await read(await api.chats[":id"].$get(params, options))
            : item.type === "task"
              ? await read(await api.tasks[":id"].$get(params, options))
              : item.type === "project"
                ? await read(await api.projects[":id"].$get(params, options))
                : item.type === "schedule"
                  ? await read(await api.schedules[":id"].$get(params, options))
                  : await read(
                      await api.documents[":id"].$get(params, options),
                    );
        return resource;
      },
      refetchInterval: 5000,
      retry: false,
    })),
  });
  const readable = resolved.flatMap((query, index) => {
    const item = references[index];
    return item && query.data && !query.error
      ? [{ ...item, title: query.data.title, href: navigationHref(item) }]
      : [];
  });
  const pins = history.pins.flatMap((item) => {
    const current = readable.find((other) => same(item, other));
    return current ? [current] : [];
  });
  const recents = history.recents.flatMap((item) => {
    const current = readable.find((other) => same(item, other));
    return current && !history.pins.some((pin) => same(pin, item))
      ? [current]
      : [];
  });
  const attentionQuery = useQuery({
    queryKey: ["workspace", workspaceId, "floating-attention"],
    queryFn: async () =>
      read(
        await api.attention.$get({
          param: { workspaceId },
          query: { limit: "100" },
        }),
      ),
    refetchInterval: 5000,
    retry: false,
  });
  const questionIds = attentionQuery.error
    ? []
    : [
        ...new Set(
          attentionQuery.data?.questions.items.map(
            (question) => question.runId,
          ) ?? [],
        ),
      ];
  const runs = useQueries({
    queries: questionIds.map((id) => ({
      queryKey: ["workspace", workspaceId, "navigation-question-run", id],
      queryFn: async () =>
        read(await api.runs[":id"].$get({ param: { workspaceId, id } })),
      refetchInterval: 5000,
      retry: false,
    })),
  });
  const attention = new Map<string, "Unread" | "Awaiting answer">();
  if (!attentionQuery.error) {
    for (const item of attentionQuery.data?.items ?? [])
      attention.set(item.chatId, "Unread");
    for (const run of runs) {
      if (run.data?.chatId && !run.error)
        attention.set(run.data.chatId, "Awaiting answer");
    }
  }
  const neededQueries = useQueries({
    queries: [...attention.keys()]
      .sort(
        (a, b) =>
          Number(attention.get(b) === "Awaiting answer") -
          Number(attention.get(a) === "Awaiting answer"),
      )
      .slice(0, 20)
      .map((id) => ({
        queryKey: ["workspace", workspaceId, "chat", id],
        queryFn: async ({ signal }: { signal: AbortSignal }) =>
          read(
            await api.chats[":id"].$get(
              { param: { workspaceId, id } },
              { init: { signal } },
            ),
          ),
        refetchInterval: 5000,
        retry: false,
      })),
  });
  const needed = neededQueries.flatMap((query) =>
    query.data && !query.error && !query.data.archived ? [query.data] : [],
  );
  const attentionRecents: NavigationItem[] = needed
    .filter(
      (chat) =>
        !history.pins.some((pin) => pin.type === "chat" && pin.id === chat.id),
    )
    .map((chat) => ({
      type: "chat",
      id: chat.id,
      title: chat.title,
      href: `/chats/${chat.id}`,
    }));
  return (
    <context.Provider
      value={{
        pins,
        recents: [
          ...attentionRecents,
          ...recents.filter(
            (item) => !attentionRecents.some((other) => same(item, other)),
          ),
        ]
          .sort(
            (a, b) =>
              Number(b.type === "chat" && attention.has(b.id)) -
              Number(a.type === "chat" && attention.has(a.id)),
          )
          .slice(0, 20),
        attention,
        attentionPending:
          attentionQuery.isPending || runs.some((run) => run.isPending),
        retryAttention: () => {
          void attentionQuery.refetch();
          for (const run of runs) void run.refetch();
          for (const query of neededQueries) void query.refetch();
        },
        attentionError:
          attentionQuery.error ??
          neededQueries.find((query) => query.error)?.error ??
          runs.find((run) => run.error)?.error ??
          null,
        moreAttention: Boolean(
          attentionQuery.data?.next ||
            attentionQuery.data?.questions.next ||
            attention.size > 20,
        ),
        isPinned: (item) => history.pins.some((pin) => same(pin, item)),
        togglePin: (item) =>
          setHistory((previous) => ({
            ...previous,
            pins: previous.pins.some((pin) => same(pin, item))
              ? previous.pins.filter((pin) => !same(pin, item))
              : previous.pins.length < 12
                ? [...previous.pins, { type: item.type, id: item.id }]
                : previous.pins,
          })),
        forget: (item) =>
          setHistory((previous) => ({
            ...previous,
            recents: previous.recents.filter((recent) => !same(recent, item)),
          })),
        pinLimit: history.pins.length >= 12,
      }}
    >
      {children}
    </context.Provider>
  );
}
