import { createFileRoute, redirect } from "@tanstack/react-router";

import { parseCustomizeAppsSearch } from "../components/customize/customize.logic";

// Otto: the app catalog moved under Settings > Integrations; old links land there.
export const Route = createFileRoute("/customize_/apps/")({
  validateSearch: parseCustomizeAppsSearch,
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/settings/integrations/apps", search, replace: true });
  },
});
