import { useQuery } from "@tanstack/react-query";
import { read } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

/** Resolve current actor authority independently of the displayed directory page. Server remains authority. */
export function useProjectMembership(projectId?: string | null) {
  const { api, workspaceId, user } = useWorkspace();
  return useQuery({
    queryKey: [
      "workspace",
      workspaceId,
      "project",
      projectId,
      "membership",
      user.id,
    ],
    enabled: Boolean(projectId),
    retry: false,
    queryFn: async ({ signal }) => {
      let after: string | undefined;
      do {
        const page = await read(
          await api.projects[":id"].members.$get(
            {
              param: { workspaceId, id: projectId ?? "" },
              query: { limit: "100", after },
            },
            { init: { signal } },
          ),
        );
        const self = page.items.find((member) => member.userId === user.id);
        if (self) return self;
        after = page.next ?? undefined;
      } while (after);
      return null;
    },
  });
}
