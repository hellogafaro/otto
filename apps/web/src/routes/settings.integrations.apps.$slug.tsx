import { createFileRoute } from "@tanstack/react-router";

import { CustomizeAppPage } from "../components/customize/customize-apps";
import { parseCustomizeAppsSearch } from "../components/customize/customize.logic";

export const Route = createFileRoute("/settings/integrations/apps/$slug")({
  validateSearch: parseCustomizeAppsSearch,
  component: function AppRoute() {
    const { slug } = Route.useParams();
    const search = Route.useSearch();

    return <CustomizeAppPage slug={slug} visibility={search.visibility ?? "user"} />;
  },
});
