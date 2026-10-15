import { ProjectId } from "@otto/contracts";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { ProjectPage } from "../components/work/project-page";
import { parseProjectPageSearch } from "../components/work/work.logic";

export const Route = createFileRoute("/projects/$projectId")({
  validateSearch: parseProjectPageSearch,
  beforeLoad: async ({ context }) => {
    if (context.authGateState.status !== "authenticated") {
      throw redirect({ to: "/login", replace: true });
    }
  },
  component: function ProjectRoute() {
    return (
      <ProjectPage
        projectId={ProjectId.make(Route.useParams().projectId)}
        tab={Route.useSearch().tab ?? "overview"}
      />
    );
  },
});
