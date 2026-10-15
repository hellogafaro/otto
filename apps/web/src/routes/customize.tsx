import { createFileRoute, redirect } from "@tanstack/react-router";

import { parseCustomizePageSearch } from "../components/customize/customize.logic";

// Otto: Customize moved into Settings; its tabs are the Skills and Integrations pages there.
export const Route = createFileRoute("/customize")({
  validateSearch: parseCustomizePageSearch,
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/settings/$section",
      params: { section: search.tab ?? "integrations" },
      replace: true,
    });
  },
});
