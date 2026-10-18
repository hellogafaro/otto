import { createFileRoute, redirect } from "@tanstack/react-router";

import { encodeLibrarySearch, parseLibrarySearch } from "../components/library/library.logic";
import { LibraryPage } from "../components/library/library-page";

export const Route = createFileRoute("/library/")({
  // Otto: The URL keeps the encoded view, so types stay one readable comma list.
  validateSearch: (search) => encodeLibrarySearch(parseLibrarySearch(search)),
  beforeLoad: async ({ context }) => {
    if (context.authGateState.status !== "authenticated") {
      throw redirect({ to: "/login", replace: true });
    }
  },
  component: function LibraryRoute() {
    return <LibraryPage search={parseLibrarySearch(Route.useSearch())} />;
  },
});
