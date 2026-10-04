import { useInfiniteQuery } from "@tanstack/react-query";
import { read } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

/** Real, workspace-scoped directory shared by pickers and identity presentation. */
export function useDirectory() {
  const { api, workspaceId, user } = useWorkspace();
  const members = useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "directory", "members"],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      read(
        await api.members.$get({
          param: { workspaceId },
          query: { limit: "100", sort: "name", after: pageParam },
        }),
      ),
    getNextPageParam: (last) => last.next ?? undefined,
    select: (data) => ({
      items: data.pages.flatMap((page) => page.items),
      next: data.pages.at(-1)?.next ?? null,
    }),
  });
  const agents = useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "directory", "agents"],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      read(
        await api.agents.$get({
          param: { workspaceId },
          query: { limit: "100", sort: "title", after: pageParam },
        }),
      ),
    getNextPageParam: (last) => last.next ?? undefined,
    select: (data) => ({
      items: data.pages.flatMap((page) => page.items),
      next: data.pages.at(-1)?.next ?? null,
    }),
  });
  const projects = useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "directory", "projects"],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      read(
        await api.projects.$get({
          param: { workspaceId },
          query: { limit: "100", sort: "title", after: pageParam },
        }),
      ),
    getNextPageParam: (last) => last.next ?? undefined,
    select: (data) => ({
      items: data.pages.flatMap((page) => page.items),
      next: data.pages.at(-1)?.next ?? null,
    }),
  });
  const people = members.data?.items ?? [];
  const bots = agents.data?.items ?? [];
  const actorOf = (id: string) => {
    const bot = bots.find((item) => item.id === id);
    const person = people.find((item) => item.userId === id);
    const name =
      bot?.title ??
      person?.name ??
      (id === user.id ? user.name : "Unavailable person");
    return {
      id,
      name,
      initials: name
        .split(/\s+/)
        .map((part) => part.charAt(0))
        .slice(0, 2)
        .join(""),
      agent: Boolean(bot),
      color: 0,
    };
  };
  return {
    members: people,
    agents: bots,
    projects: projects.data?.items ?? [],
    actorOf,
    pending: members.isPending || agents.isPending || projects.isPending,
    error: members.error ?? agents.error ?? projects.error,
    membersQuery: members,
    agentsQuery: agents,
    projectsQuery: projects,
  };
}
