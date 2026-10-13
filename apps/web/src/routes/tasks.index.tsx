import { createFileRoute, redirect } from "@tanstack/react-router";

import { parseTaskSearch } from "../components/work/work.logic";
import { TasksPage } from "../components/work/WorkPages";

export const Route = createFileRoute("/tasks/")({
  validateSearch: parseTaskSearch,
  beforeLoad: async ({ context }) => {
    if (context.authGateState.status !== "authenticated") {
      throw redirect({ to: "/login", replace: true });
    }
  },
  component: function TasksRoute() {
    return <TasksPage filter={Route.useSearch()} />;
  },
});
