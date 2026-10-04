import { useQuery } from "@tanstack/react-query";
import { read } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

/** Real, workspace-scoped directory shared by pickers and identity presentation. */
export function useDirectory() {
  const { api, workspaceId, user } = useWorkspace();
  const members = useQuery({
    queryKey: ["workspace", workspaceId, "members"],
    queryFn: async () =>
      read(
        await api.members.$get({
          param: { workspaceId },
          query: { limit: "100", sort: "name" },
        }),
      ),
  });
  const agents = useQuery({
    queryKey: ["workspace", workspaceId, "agents"],
    queryFn: async () =>
      read(
        await api.agents.$get({
          param: { workspaceId },
          query: { limit: "100", sort: "title" },
        }),
      ),
  });
  const projects = useQuery({
    queryKey: ["workspace", workspaceId, "projects"],
    queryFn: async () =>
      read(
        await api.projects.$get({
          param: { workspaceId },
          query: { limit: "100", sort: "title" },
        }),
      ),
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
