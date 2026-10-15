import { createFileRoute } from "@tanstack/react-router";

import { CustomizeAppsPage } from "../components/customize/customize-apps";
import { parseCustomizeAppsSearch } from "../components/customize/customize.logic";

export const Route = createFileRoute("/settings/integrations/apps/")({
  validateSearch: parseCustomizeAppsSearch,
  component: function AppsRoute() {
    const search = Route.useSearch();

    return <CustomizeAppsPage query={search.q ?? ""} visibility={search.visibility ?? "user"} />;
  },
});
