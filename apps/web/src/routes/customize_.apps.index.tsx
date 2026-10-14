import { createFileRoute, redirect } from "@tanstack/react-router";

import { CustomizeAppsPage } from "../components/customize/CustomizeApps";
import { parseCustomizeAppsSearch } from "../components/customize/customize.logic";

export const Route = createFileRoute("/customize_/apps/")({
  validateSearch: parseCustomizeAppsSearch,
  beforeLoad: async ({ context }) => {
    if (context.authGateState.status !== "authenticated") {
      throw redirect({ to: "/login", replace: true });
    }
  },
  component: function CustomizeAppsRoute() {
    const search = Route.useSearch();

    return <CustomizeAppsPage query={search.q ?? ""} visibility={search.visibility ?? "user"} />;
  },
});
