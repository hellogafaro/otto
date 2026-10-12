import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { getThemeDefinition, resolveDesktopTheme, resolveThemeAppearance } from "./themePalette";
import { readThemePreference, readAppearanceModePreference } from "./theme/preferenceStorage";

afterEach(() => vi.unstubAllGlobals());

describe("stored appearance preferences", () => {
  it.each(["otto-noir", "otto-chat", "grove", "ocean", "ember", "iris", "aurora"])(
    "does not resolve the retired %s palette or read its saved data",
    (id) => {
      const getItem = vi.fn((key: string) => (key === "otto:theme" ? id : null));
      vi.stubGlobal("window", { localStorage: { getItem } });
      expect(getThemeDefinition(id)).toBeNull();
      expect(readThemePreference()).toBe("otto-paper");
      expect(readAppearanceModePreference(readThemePreference())).toBe("system");
      expect(getItem.mock.calls.flat()).not.toContain("otto:themes:v1");
      expect(getItem.mock.calls.flat()).not.toContain("otto:theme-halves:v1");
    },
  );

  it.each(["light", "dark", "system"] as const)("respects explicit %s mode", (mode) => {
    const getItem = (key: string) => (key === "otto:theme-appearance-mode" ? mode : "iris");
    vi.stubGlobal("window", { localStorage: { getItem } });
    expect(readAppearanceModePreference(readThemePreference())).toBe(mode);
    expect(resolveDesktopTheme("otto-paper", undefined, mode)).toBe(mode);
    expect(resolveThemeAppearance("otto-paper", false, undefined, mode)).toBe(
      mode === "dark" ? "dark" : "light",
    );
    expect(resolveThemeAppearance("otto-paper", true, undefined, mode)).toBe(
      mode === "light" ? "light" : "dark",
    );
  });

  it.each(["light", "dark"] as const)(
    "migrates the old %s mode without a named palette",
    (mode) => {
      vi.stubGlobal("window", {
        localStorage: { getItem: (key: string) => (key === "ottoLegacy:theme" ? mode : null) },
      });
      expect(readThemePreference()).toBe(mode);
      expect(readAppearanceModePreference(mode)).toBe(mode);
    },
  );

  it.each(["light", "dark"] as const)("follows a %s OS in system mode", (appearance) => {
    expect(resolveThemeAppearance("otto-paper", appearance === "dark", true)).toBe(appearance);
    expect(resolveDesktopTheme("otto-paper", true)).toBe("system");
  });
});
