import { createFileRoute, redirect } from "@tanstack/react-router";

import { CustomizeAppPage } from "../components/customize/CustomizeApps";
import { parseCustomizeAppsSearch } from "../components/customize/customize.logic";

export const Route = createFileRoute("/customize_/apps/$slug")({
  validateSearch: parseCustomizeAppsSearch,
  beforeLoad: async ({ context }) => {
    if (context.authGateState.status !== "authenticated") {
      throw redirect({ to: "/login", replace: true });
    }
  },
  component: function CustomizeAppRoute() {
    const { slug } = Route.useParams();
    const search = Route.useSearch();

    return <CustomizeAppPage slug={slug} visibility={search.visibility ?? "user"} />;
  },
});
