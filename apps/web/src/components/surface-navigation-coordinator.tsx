import { useEffect } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import {
  acknowledgeCustomizeNavigation,
  useCustomizeNavigationStore,
} from "../customize-navigation";
import {
  acknowledgeSettingsNavigation,
  clearSettingsEnvironment,
  useSettingsDialogStore,
} from "../settings-dialog-store";
import { channelProviderFromSettingsTarget } from "./settings/channel-provider-meta";
import { providerCatalogSlugFromSettingsTarget } from "./settings/provider-catalog";

/** Bridges legacy imperative open helpers to the routed workspace surfaces. */
export function SurfaceNavigationCoordinator() {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const settingsSection = useSettingsDialogStore((state) => state.section);
  const settingsTarget = useSettingsDialogStore((state) => state.targetId);
  const customizeRequest = useCustomizeNavigationStore((state) => state.request);

  useEffect(() => {
    if (settingsSection !== null) {
      // A channel or provider target, such as a repair link, opens that provider's own page.
      const channel =
        settingsSection === "channels" ? channelProviderFromSettingsTarget(settingsTarget) : null;

      const providerId =
        settingsSection === "models" ? providerCatalogSlugFromSettingsTarget(settingsTarget) : null;

      void (channel
        ? navigate({ to: "/settings/channels/$channel", params: { channel } })
        : providerId
          ? navigate({ to: "/settings/models/$providerId", params: { providerId } })
          : navigate({
              to: "/settings/$section",
              params: { section: settingsSection },
              hash: settingsTarget ?? "",
            }));
      acknowledgeSettingsNavigation();

      return;
    }

    if (!pathname.startsWith("/settings")) clearSettingsEnvironment();
  }, [navigate, pathname, settingsSection, settingsTarget]);

  useEffect(() => {
    if (customizeRequest === null) return;

    void (customizeRequest.app
      ? navigate({
          to: "/settings/integrations/apps/$slug",
          params: { slug: customizeRequest.app },
        })
      : customizeRequest.query
        ? navigate({ to: "/settings/integrations/apps", search: { q: customizeRequest.query } })
        : navigate({ to: "/settings/$section", params: { section: customizeRequest.tab } }));
    acknowledgeCustomizeNavigation();
  }, [navigate, customizeRequest]);

  return null;
}
