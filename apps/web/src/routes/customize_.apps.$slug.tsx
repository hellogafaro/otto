import { createFileRoute, redirect } from "@tanstack/react-router";

import { parseCustomizeAppsSearch } from "../components/customize/customize.logic";

// Otto: app pages moved under Settings > Integrations; old links land there.
export const Route = createFileRoute("/customize_/apps/$slug")({
  validateSearch: parseCustomizeAppsSearch,
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: "/settings/integrations/apps/$slug",
      params: { slug: params.slug },
      search,
      replace: true,
    });
  },
});
