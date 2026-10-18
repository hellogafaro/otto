import { createFileRoute, redirect } from "@tanstack/react-router";

import { encodeTaskSearch, parseTaskSearch } from "../components/work/work.logic";
import { TasksPage } from "../components/work/work-pages";

export const Route = createFileRoute("/tasks/")({
  // Otto: The URL keeps the encoded view, so statuses stay one readable comma list.
  validateSearch: (search) => encodeTaskSearch(parseTaskSearch(search)),
  beforeLoad: async ({ context }) => {
    if (context.authGateState.status !== "authenticated") {
      throw redirect({ to: "/login", replace: true });
    }
  },
  component: function TasksRoute() {
    return <TasksPage view={parseTaskSearch(Route.useSearch())} />;
  },
});
