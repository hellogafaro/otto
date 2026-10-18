import { createFileRoute, redirect } from "@tanstack/react-router";

import { RoutinesPage } from "../components/routines/routines-page";
import { encodeRoutineSearch, parseRoutineSearch } from "../components/routines/routines.logic";

export const Route = createFileRoute("/routines/")({
  // Otto: The URL keeps the encoded view, so statuses stay one readable comma list.
  validateSearch: (search) => encodeRoutineSearch(parseRoutineSearch(search)),
  beforeLoad: async ({ context }) => {
    if (context.authGateState.status !== "authenticated") {
      throw redirect({ to: "/login", replace: true });
    }
  },
  component: function RoutinesRoute() {
    return <RoutinesPage view={parseRoutineSearch(Route.useSearch())} />;
  },
});
