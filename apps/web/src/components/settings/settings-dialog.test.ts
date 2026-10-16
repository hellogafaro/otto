import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_SETTINGS_SECTION,
  SETTINGS_SECTIONS,
  settingsSectionFromPathname,
  useSettingsDialogStore,
} from "~/settings-dialog-store";
import { SETTINGS_NAV_GROUPS, SETTINGS_NAV_ITEMS, settingsSectionLabel } from "./settings-dialog";

describe("settings dialog navigation", () => {
  it("lists General first and lands there by default", () => {
    expect(DEFAULT_SETTINGS_SECTION).toBe("general");
    expect(SETTINGS_NAV_GROUPS[0]?.label).toBeNull();
    expect(SETTINGS_NAV_ITEMS[0]?.section).toBe("general");
    expect(settingsSectionFromPathname("/settings")).toBe("general");
    expect(settingsSectionFromPathname("/settings/unknown")).toBe("general");

    useSettingsDialogStore.getState().openSettings();
    expect(useSettingsDialogStore.getState().section).toBe("general");
    useSettingsDialogStore.getState().closeSettings();
  });

  it("shows Channels in the Bots group", () => {
    const bots = SETTINGS_NAV_GROUPS.find((group) => group.label === "Bots");
    expect(bots?.items).toContainEqual(
      expect.objectContaining({ section: "channels", label: "Channels" }),
    );
  });

  it("opens Usage as an ordinary Organization settings section", () => {
    const organization = SETTINGS_NAV_GROUPS.find((group) => group.label === "Organization");

    expect(organization?.items).toContainEqual(
      expect.objectContaining({ section: "usage", label: "Usage" }),
    );
    expect(settingsSectionFromPathname("/settings/usage")).toBe("usage");
    useSettingsDialogStore.getState().openSettings("usage");
    expect(useSettingsDialogStore.getState().section).toBe("usage");
    useSettingsDialogStore.getState().closeSettings();
  });

  it("flattens the groups in visual order without losing or duplicating a section", () => {
    const grouped = SETTINGS_NAV_GROUPS.flatMap((group) => group.items);

    expect(SETTINGS_NAV_ITEMS).toEqual(grouped);
    expect(new Set(SETTINGS_NAV_ITEMS.map((item) => item.section)).size).toBe(
      SETTINGS_NAV_ITEMS.length,
    );
  });

  it("heads the list with your own pages and labels every later group", () => {
    const [personal, ...rest] = SETTINGS_NAV_GROUPS;

    expect(personal?.label).toBeNull();

    for (const group of rest) {
      expect(group.label?.length).toBeGreaterThan(0);
      expect(group.items.length).toBeGreaterThan(0);
    }
  });

  it("keeps the nav small and free of coding-agent leftovers", () => {
    const sections = SETTINGS_NAV_ITEMS.map((item) => item.section);
    const organization = SETTINGS_NAV_GROUPS.find((group) => group.label === "Organization");
    expect(organization?.items.map((item) => item.section)).toEqual([
      "organization",
      "members",
      "usage",
    ]);
    expect(SETTINGS_NAV_ITEMS).toHaveLength(16);
    expect(SETTINGS_NAV_GROUPS).toHaveLength(3);
    expect(new Set(sections).size).toBe(sections.length);
    expect(sections).not.toContain("source-control");
    expect(sections).not.toContain("diagnostics");
    expect(sections).not.toContain("advanced");
  });

  it("labels every page, listed or not", () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(settingsSectionLabel(section)).not.toBe(section);
    }
  });
});
