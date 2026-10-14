import { createFileRoute, redirect } from "@tanstack/react-router";

import { CustomizePage } from "../components/customize/CustomizePage";
import { parseCustomizePageSearch } from "../components/customize/customize.logic";

export const Route = createFileRoute("/customize")({
  validateSearch: parseCustomizePageSearch,
  beforeLoad: async ({ context }) => {
    if (context.authGateState.status !== "authenticated") {
      throw redirect({ to: "/login", replace: true });
    }
  },
  component: function CustomizeRoute() {
    const search = Route.useSearch();

    return <CustomizePage tab={search.tab ?? "integrations"} />;
  },
});
