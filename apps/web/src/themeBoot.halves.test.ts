const CUSTOM_THEMES_STORAGE_KEY = "otto:themes:v1";

import { fixedBootColors } from "./themeBoot.test-support";
import { describe, expect, it } from "vite-plus/test";

import { THEME_APPEARANCE_MODE_STORAGE_KEY } from "./themePalette";

import { THEME_STORAGE_KEY, runBootScript } from "./themeBoot.test-support";

describe("index.html boot script", () => {
  it("ignores stored automatic mix halves in both appearances", () => {
    const storage = {
      [THEME_STORAGE_KEY]: "otto-chat",
      [THEME_APPEARANCE_MODE_STORAGE_KEY]: "system",
      "otto:theme-halves:v1": JSON.stringify({ dark: "grove" }),
    };

    const dark = runBootScript({ storage, prefersDark: true });
    expect(dark.isDark).toBe(true);
    expect(dark.themeId).toBeUndefined();
    expect(dark.bootVariables["--boot-background"]).toBe(fixedBootColors(dark.isDark).chrome);

    const light = runBootScript({ storage, prefersDark: false });
    expect(light.isDark).toBe(false);
    expect(light.themeId).toBeUndefined();
    expect(light.bootVariables["--boot-background"]).toBe(fixedBootColors(light.isDark).chrome);
  });

  it("follows the OS despite a saved light-only palette", () => {
    const boot = runBootScript({
      storage: {
        [THEME_STORAGE_KEY]: "paper",
        [THEME_APPEARANCE_MODE_STORAGE_KEY]: "system",
        [CUSTOM_THEMES_STORAGE_KEY]: JSON.stringify([
          {
            id: "paper",
            label: "Paper",
            appearance: "light",
            colors: { canvas: "#f8fbff", text: "#10243d", accent: "#5b6cff" },
          },
        ]),
        "otto:theme-halves:v1": JSON.stringify({ dark: "grove" }),
      },
      prefersDark: true,
    });

    expect(boot.isDark).toBe(true);
    expect(boot.themeId).toBeUndefined();
  });

  it("uses the canonical splash when a saved base no longer exists", () => {
    const boot = runBootScript({
      storage: {
        [THEME_STORAGE_KEY]: "gone-theme",
        [THEME_APPEARANCE_MODE_STORAGE_KEY]: "system",
        "otto:theme-halves:v1": JSON.stringify({ dark: "grove" }),
      },
      prefersDark: true,
    });

    expect(boot.isDark).toBe(true);
    expect(boot.themeId).toBeUndefined();
    expect(boot.themeSelected).toBe("true");
    expect(boot.bootVariables["--boot-background"]).toBe(fixedBootColors(boot.isDark).chrome);
  });

  it("ignores legacy-prefixed mix halves", () => {
    const boot = runBootScript({
      storage: {
        [THEME_STORAGE_KEY]: "otto-chat",
        [THEME_APPEARANCE_MODE_STORAGE_KEY]: "system",
        "otto:theme-halves:v1": JSON.stringify({ dark: "ottoLegacy-grove" }),
      },
      prefersDark: true,
    });

    expect(boot.isDark).toBe(true);
    expect(boot.themeId).toBeUndefined();
    expect(boot.bootVariables["--boot-background"]).toBe(fixedBootColors(boot.isDark).chrome);
  });

  it("ignores a mix half that names an unknown theme", () => {
    const boot = runBootScript({
      storage: {
        [THEME_STORAGE_KEY]: "otto-chat",
        [THEME_APPEARANCE_MODE_STORAGE_KEY]: "system",
        "otto:theme-halves:v1": JSON.stringify({ dark: "gone-theme" }),
      },
      prefersDark: true,
    });

    expect(boot.themeId).toBeUndefined();
    expect(boot.isDark).toBe(true);
  });
});
