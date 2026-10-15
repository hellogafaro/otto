import { createFileRoute, redirect } from "@tanstack/react-router";

import { parseLibrarySearch } from "../components/library/library.logic";
import { LibraryPage } from "../components/library/library-page";

export const Route = createFileRoute("/library/")({
  validateSearch: parseLibrarySearch,
  beforeLoad: async ({ context }) => {
    if (context.authGateState.status !== "authenticated") {
      throw redirect({ to: "/login", replace: true });
    }
  },
  component: function LibraryRoute() {
    return <LibraryPage search={Route.useSearch()} />;
  },
});
