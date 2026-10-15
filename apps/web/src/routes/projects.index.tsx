import { createFileRoute, redirect } from "@tanstack/react-router";

import { parseProjectSearch } from "../components/work/work.logic";
import { ProjectsPage } from "../components/work/work-pages";

export const Route = createFileRoute("/projects/")({
  validateSearch: parseProjectSearch,
  beforeLoad: async ({ context }) => {
    if (context.authGateState.status !== "authenticated") {
      throw redirect({ to: "/login", replace: true });
    }
  },
  component: function ProjectsRoute() {
    return <ProjectsPage filter={Route.useSearch()} />;
  },
});
