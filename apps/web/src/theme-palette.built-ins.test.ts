import { describe, expect, it } from "vite-plus/test";
import { BUILT_IN_THEME_IDS, BUILT_IN_THEMES, MOBILE_THEME_IDS } from "@otto/shared/themePalettes";
import {
  OTTO_PAPER_THEME,
  getThemeColorsForMode,
  getThemeModes,
  THEME_COLOR_ROLES,
} from "./theme-palette";
import {
  expectThemeColors,
  contrastRatio,
  toCanonicalThemeColor,
} from "./theme-palette.test-support";

describe("the shared Otto palette", () => {
  it("ships one palette with two appearances on every client", () => {
    expect(BUILT_IN_THEME_IDS).toEqual(["otto-paper"]);
    expect(MOBILE_THEME_IDS).toEqual(BUILT_IN_THEME_IDS);
    expect(BUILT_IN_THEMES).toEqual([OTTO_PAPER_THEME]);
    expect(getThemeModes(OTTO_PAPER_THEME)).toEqual(["light", "dark"]);
  });

  it.each(["light", "dark"] as const)("defines every %s role in canonical OKLCH", (appearance) => {
    const colors = getThemeColorsForMode(OTTO_PAPER_THEME, appearance)!;
    expect(Object.keys(colors).sort()).toEqual([...THEME_COLOR_ROLES].sort());

    for (const value of Object.values(colors)) expect(toCanonicalThemeColor(value)).toBe(value);
    expect(contrastRatio(colors.text, colors.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.textMuted, colors.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(colors.messageActionForeground, colors.messageAction),
    ).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.terminalCursor, colors.terminalBackground)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(colors.terminalBackground).toBe(colors.canvas);
    expect(colors.terminalForeground).toBe(colors.text);
    expect(colors.chrome).toBe(colors.sidebar);
    expect(colors.toolbar).toBe(colors.canvas);
    expect(colors.surfaceRaised).toBe(colors.surfaceOverlay);
  });

  it("uses the measured Capy light hierarchy with sky actions", () => {
    expectThemeColors(OTTO_PAPER_THEME.colors, {
      chrome: "#ececec",
      canvas: "#f9f9f9",
      surface: "#ffffff",
      surfaceOverlay: "#ffffff",
      text: "#1e1e1e",
      accent: "#0069a8",
      messageAction: "#0069a8",
      messageActionForeground: "#ffffff",
      sidebar: "#ececec",
    });
  });

  it("uses the measured Capy dark hierarchy with readable sky accents", () => {
    expectThemeColors(OTTO_PAPER_THEME.variants!.dark!, {
      chrome: "#0a0a0b",
      canvas: "#131314",
      surface: "#181819",
      surfaceOverlay: "#202021",
      text: "#f5f5f5",
      accent: "#00a6f4",
      messageAction: "#0069a8",
      messageActionForeground: "#ffffff",
      sidebar: "#0a0a0b",
    });
  });
});
