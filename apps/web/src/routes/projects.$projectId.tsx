import { ProjectId } from "@otto/contracts";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { ProjectPage } from "../components/work/WorkPages";

export const Route = createFileRoute("/projects/$projectId")({
  beforeLoad: async ({ context }) => {
    if (context.authGateState.status !== "authenticated") {
      throw redirect({ to: "/login", replace: true });
    }
  },
  component: function ProjectRoute() {
    return <ProjectPage projectId={ProjectId.make(Route.useParams().projectId)} />;
  },
});
