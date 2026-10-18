import { createFileRoute, redirect } from "@tanstack/react-router";

import { encodeProjectSearch, parseProjectSearch } from "../components/work/work.logic";
import { ProjectsPage } from "../components/work/work-pages";

export const Route = createFileRoute("/projects/")({
  // Otto: The URL keeps the encoded view, so statuses stay one readable comma list.
  validateSearch: (search) => encodeProjectSearch(parseProjectSearch(search)),
  beforeLoad: async ({ context }) => {
    if (context.authGateState.status !== "authenticated") {
      throw redirect({ to: "/login", replace: true });
    }
  },
  component: function ProjectsRoute() {
    return <ProjectsPage view={parseProjectSearch(Route.useSearch())} />;
  },
});
