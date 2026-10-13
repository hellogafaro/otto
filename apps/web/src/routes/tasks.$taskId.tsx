import { TaskId } from "@otto/contracts";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { TaskPage } from "../components/work/TaskPage";

export const Route = createFileRoute("/tasks/$taskId")({
  beforeLoad: async ({ context }) => {
    if (context.authGateState.status !== "authenticated") {
      throw redirect({ to: "/login", replace: true });
    }
  },
  component: function TaskRoute() {
    return <TaskPage taskId={TaskId.make(Route.useParams().taskId)} />;
  },
});
