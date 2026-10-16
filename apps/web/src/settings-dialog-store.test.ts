import { beforeEach, describe, expect, it } from "vite-plus/test";
import { EnvironmentId } from "@otto/contracts";

import {
  clearSettingsTarget,
  closeSettings,
  openSettings,
  settingsSectionFromPathname,
  useSettingsDialogStore,
} from "./settings-dialog-store";

beforeEach(() => {
  closeSettings();
});

describe("settings dialog store", () => {
  it("opens on General when no section is named", () => {
    openSettings();
    expect(useSettingsDialogStore.getState().section).toBe("general");
  });

  it("closes back to no section", () => {
    openSettings("memory");
    expect(useSettingsDialogStore.getState().section).toBe("memory");
    expect(useSettingsDialogStore.getState().targetId).toBeNull();
    closeSettings();
    expect(useSettingsDialogStore.getState().section).toBeNull();
    expect(useSettingsDialogStore.getState().targetId).toBeNull();
  });

  it("keeps the Bot channels tab across closing and reopening", () => {
    openSettings("channels");
    useSettingsDialogStore.getState().setChannelProvider("telegram");
    closeSettings();
    openSettings("channels");
    expect(useSettingsDialogStore.getState().channelProvider).toBe("telegram");
  });

  it("clears a handled target without closing its Settings section", () => {
    openSettings("computer", "local-execution");
    clearSettingsTarget();

    expect(useSettingsDialogStore.getState()).toMatchObject({
      section: "computer",
      targetId: null,
    });
  });

  it("keeps the originating environment while navigating Settings", () => {
    const environmentId = EnvironmentId.make("env-secondary");
    openSettings("computer", "local-execution", environmentId);
    useSettingsDialogStore.getState().openSettings("models");

    expect(useSettingsDialogStore.getState()).toMatchObject({
      section: "models",
      environmentId,
    });

    closeSettings();
    expect(useSettingsDialogStore.getState().environmentId).toBeNull();
  });

  it("replaces a stale environment when an entry point names its environment", () => {
    const secondaryEnvironmentId = EnvironmentId.make("env-secondary");
    const primaryEnvironmentId = EnvironmentId.make("env-primary");
    openSettings("computer", "local-execution", secondaryEnvironmentId);

    openSettings("models", null, primaryEnvironmentId);

    expect(useSettingsDialogStore.getState()).toMatchObject({
      section: "models",
      environmentId: primaryEnvironmentId,
    });
  });
});

describe("legacy settings deep links", () => {
  it("maps a known settings path onto its section", () => {
    expect(settingsSectionFromPathname("/settings/memory")).toBe("memory");
    expect(settingsSectionFromPathname("/settings/voice")).toBe("voice");
    expect(settingsSectionFromPathname("/settings/channels")).toBe("channels");
    expect(settingsSectionFromPathname("/settings/computer")).toBe("computer");
  });

  it("maps retired sections onto the page that now owns them", () => {
    expect(settingsSectionFromPathname("/settings/source-control")).toBe("general");
    expect(settingsSectionFromPathname("/settings/providers")).toBe("models");
    expect(settingsSectionFromPathname("/settings/image-generation")).toBe("models");
    expect(settingsSectionFromPathname("/settings/sandbox")).toBe("computer");
    expect(settingsSectionFromPathname("/settings/browser")).toBe("computer");
  });

  it("opens the Bots list under Customize", () => {
    expect(settingsSectionFromPathname("/settings/bots")).toBe("bots");
  });

  it("opens archived chat links on the Archived chats page", () => {
    expect(settingsSectionFromPathname("/settings/archived")).toBe("archived");
  });

  it("maps keybinding links onto the configurable shortcut panel", () => {
    expect(settingsSectionFromPathname("/settings/keybindings")).toBe("keybindings");
  });

  it("falls back to General for the bare path and for removed sections", () => {
    expect(settingsSectionFromPathname("/settings")).toBe("general");
    expect(settingsSectionFromPathname("/settings/")).toBe("general");
    expect(settingsSectionFromPathname("/settings/groups")).toBe("general");
  });
});
