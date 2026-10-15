import { createFileRoute, redirect } from "@tanstack/react-router";

import { SettingsRoutePage } from "../components/settings/settings-route-page";
import { DEFAULT_SETTINGS_SECTION } from "../settings-dialog-store";

export const Route = createFileRoute("/settings")({
  beforeLoad: async ({ context, location }) => {
    if (context.authGateState.status !== "authenticated") {
      throw redirect({ to: "/login", replace: true });
    }

    if (location.pathname === "/settings") {
      throw redirect({
        to: "/settings/$section",
        params: { section: DEFAULT_SETTINGS_SECTION },
        replace: true,
      });
    }
  },
  component: SettingsRoutePage,
});
