const CUSTOM_THEMES_STORAGE_KEY = "otto:themes:v1";

import { fixedBootColors } from "./theme-boot.test-support";
import { describe, expect, it } from "vite-plus/test";
import {
  THEME_APPEARANCE_MODE_STORAGE_KEY,
  THEME_FOLLOW_SYSTEM_STORAGE_KEY,
} from "./theme-palette";
import {
  THEME_STORAGE_KEY,
  runBootScript,
  runtimeResolvedAppearance,
  AURORA_DUAL,
  CHARCOAL_DARK_ONLY,
} from "./theme-boot.test-support";

describe("index.html boot script", () => {
  const parityCases: ReadonlyArray<{
    name: string;
    storage: Record<string, string>;
    prefersDark: boolean;
  }> = [
    { name: "no stored preference on a dark OS", storage: {}, prefersDark: true },
    {
      name: "Otto Paper follows a dark OS",
      storage: {
        [THEME_STORAGE_KEY]: "otto-paper",
        [THEME_FOLLOW_SYSTEM_STORAGE_KEY]: "true",
      },
      prefersDark: true,
    },
    {
      name: "OttoLegacy Chat follows a dark OS",
      storage: { [THEME_STORAGE_KEY]: "otto-chat", [THEME_FOLLOW_SYSTEM_STORAGE_KEY]: "true" },
      prefersDark: true,
    },
    {
      name: "an explicit global dark mode applies to OttoLegacy Chat",
      storage: {
        [THEME_STORAGE_KEY]: "otto-chat",
        [THEME_APPEARANCE_MODE_STORAGE_KEY]: "dark",
        [THEME_FOLLOW_SYSTEM_STORAGE_KEY]: "false",
      },
      prefersDark: false,
    },
    {
      name: "Grove follows a dark OS",
      storage: { [THEME_STORAGE_KEY]: "grove", [THEME_FOLLOW_SYSTEM_STORAGE_KEY]: "true" },
      prefersDark: true,
    },
    {
      name: "Ocean follows a dark OS",
      storage: { [THEME_STORAGE_KEY]: "ocean", [THEME_FOLLOW_SYSTEM_STORAGE_KEY]: "true" },
      prefersDark: true,
    },
    {
      name: "Ember follows a dark OS",
      storage: { [THEME_STORAGE_KEY]: "ember", [THEME_FOLLOW_SYSTEM_STORAGE_KEY]: "true" },
      prefersDark: true,
    },
    {
      name: "Iris follows a dark OS",
      storage: { [THEME_STORAGE_KEY]: "iris", [THEME_FOLLOW_SYSTEM_STORAGE_KEY]: "true" },
      prefersDark: true,
    },
    {
      name: "a legacy ottoLegacy-grove preference resolves through the alias",
      storage: {
        [THEME_STORAGE_KEY]: "ottoLegacy-grove",
        [THEME_FOLLOW_SYSTEM_STORAGE_KEY]: "true",
      },
      prefersDark: true,
    },
    {
      name: "a legacy ottoLegacy-chat preference follows the OS as Otto Chat",
      storage: {
        [THEME_STORAGE_KEY]: "ottoLegacy-chat",
        [THEME_FOLLOW_SYSTEM_STORAGE_KEY]: "true",
      },
      prefersDark: true,
    },
    {
      name: "legacy ottoLegacy-chat-dark resolves to dark OttoLegacy Chat",
      storage: { [THEME_STORAGE_KEY]: "ottoLegacy-chat-dark" },
      prefersDark: true,
    },
    {
      name: "a dual-mode custom theme follows the OS",
      storage: {
        [THEME_STORAGE_KEY]: "aurora",
        [THEME_FOLLOW_SYSTEM_STORAGE_KEY]: "true",
        [CUSTOM_THEMES_STORAGE_KEY]: JSON.stringify([AURORA_DUAL]),
      },
      prefersDark: true,
    },
    {
      name: "a dark-only saved theme cannot force a dark appearance",
      storage: {
        [THEME_STORAGE_KEY]: "charcoal",
        [THEME_FOLLOW_SYSTEM_STORAGE_KEY]: "true",
        [CUSTOM_THEMES_STORAGE_KEY]: JSON.stringify([CHARCOAL_DARK_ONLY]),
      },
      prefersDark: false,
    },
    {
      name: "a legacy mode-suffixed preference is treated as unknown",
      storage: {
        [THEME_STORAGE_KEY]: "aurora:dark",
        [CUSTOM_THEMES_STORAGE_KEY]: JSON.stringify([AURORA_DUAL]),
      },
      prefersDark: true,
    },
    {
      name: "a removed custom theme falls back to system",
      storage: { [THEME_STORAGE_KEY]: "gone-theme" },
      prefersDark: true,
    },
    {
      name: "a corrupted follow-system value falls back to inference",
      storage: { [THEME_STORAGE_KEY]: "system", [THEME_FOLLOW_SYSTEM_STORAGE_KEY]: "1" },
      prefersDark: true,
    },
    {
      name: "follow-system off keeps an explicit light preference on a dark OS",
      storage: { [THEME_STORAGE_KEY]: "light", [THEME_FOLLOW_SYSTEM_STORAGE_KEY]: "false" },
      prefersDark: true,
    },
    {
      name: "a bare dark preference stays dark on a light OS",
      storage: { [THEME_STORAGE_KEY]: "dark" },
      prefersDark: false,
    },
    {
      name: "follow-system off keeps a bare dark preference on a light OS",
      storage: { [THEME_STORAGE_KEY]: "dark", [THEME_FOLLOW_SYSTEM_STORAGE_KEY]: "false" },
      prefersDark: false,
    },
  ];

  it.each(parityCases)("matches the runtime appearance: $name", ({ storage, prefersDark }) => {
    const boot = runBootScript({ storage, prefersDark });
    expect(boot.isDark).toBe(runtimeResolvedAppearance(storage, prefersDark) === "dark");
  });

  it("boots a fresh profile into Otto Paper", () => {
    const boot = runBootScript({ storage: {}, prefersDark: true });

    expect(boot.themeId).toBeUndefined();
    expect(boot.themeSelected).toBe("true");
    expect(boot.isDark).toBe(true);
    expect(boot.backgroundColor).toBe(fixedBootColors(boot.isDark).chrome);
  });

  it("migrates the old system default to Otto Paper", () => {
    const boot = runBootScript({
      storage: { [THEME_STORAGE_KEY]: "system" },
      prefersDark: true,
    });

    expect(boot.themeId).toBeUndefined();
    expect(boot.isDark).toBe(true);
    expect(boot.backgroundColor).toBe(fixedBootColors(boot.isDark).chrome);
  });

  it("uses canonical boot colors for unknown preferences", () => {
    const boot = runBootScript({
      storage: { [THEME_STORAGE_KEY]: "gone-theme" },
      prefersDark: true,
    });

    expect(boot.themeId).toBeUndefined();
    expect(boot.themeSelected).toBe("true");
    expect(boot.isDark).toBe(true);
  });

  it("follows the OS appearance when storage is unavailable", () => {
    const light = runBootScript({ storageThrows: true, prefersDark: false });
    expect(light.isDark).toBe(false);
    expect(light.themeId).toBeUndefined();

    const dark = runBootScript({ storageThrows: true, prefersDark: true });
    expect(dark.isDark).toBe(true);
    expect(dark.backgroundColor).toBe(fixedBootColors(dark.isDark).chrome);
  });
});
