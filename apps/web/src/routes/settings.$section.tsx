import { createFileRoute, redirect } from "@tanstack/react-router";

import { SettingsPanelForSection } from "../components/settings/settings-dialog";
import {
  LEGACY_SETTINGS_SECTIONS,
  SETTINGS_SECTIONS,
  type SettingsSection,
} from "../settings-dialog-store";

function isSettingsSection(value: string): value is SettingsSection {
  return SETTINGS_SECTIONS.some((section) => section === value);
}

export const Route = createFileRoute("/settings/$section")({
  beforeLoad: ({ params }) => {
    if (isSettingsSection(params.section)) return;

    // Plugins moved out of Settings into Customize.
    if (params.section === "plugins") {
      throw redirect({
        to: "/settings/$section",
        params: { section: "integrations" },
        replace: true,
      });
    }

    const legacy = Object.entries(LEGACY_SETTINGS_SECTIONS).find(
      ([key]) => key === params.section,
    )?.[1];

    throw redirect({
      to: "/settings/$section",
      params: { section: legacy?.section ?? "general" },
      ...(legacy && "targetId" in legacy ? { hash: legacy.targetId } : {}),
      replace: true,
    });
  },
  component: SettingsSectionPage,
});

function SettingsSectionPage() {
  const { section } = Route.useParams();

  if (!isSettingsSection(section)) return null;

  return <SettingsPanelForSection section={section} />;
}
