import { describe, expect, it } from "vite-plus/test";
import * as NodeFS from "node:fs";

import { BUILT_IN_THEME_IDS, BUILT_IN_THEMES } from "@otto/shared/themePalettes";

import {
  createMobileThemeVariables,
  DEFAULT_MOBILE_THEME_ID,
  getMobileThemeVariables,
  MOBILE_THEME_IDS,
  normalizeMobileThemeId,
  normalizeMobileThemeMode,
  themeColorWithAlpha,
  themeColorToNativeColor,
} from "./mobileTheme";

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));

  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);

  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

function compositeOver(overlay: string, background: string): string {
  const overlayMatch = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(overlay)!;

  const backgroundChannels = background
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16));

  const alpha = Number(overlayMatch[4]);

  const channels = [1, 2, 3].map((index) =>
    Math.round(Number(overlayMatch[index]) * alpha + backgroundChannels[index - 1]! * (1 - alpha)),
  );

  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

describe("mobile themes", () => {
  it("declares every runtime theme variable in the static stylesheet", () => {
    const stylesheet = NodeFS.readFileSync(new URL("../../global.css", import.meta.url), "utf8");

    const stylesheetVariables = new Set(
      Array.from(stylesheet.matchAll(/--color-[a-z0-9-]+/g), ([variable]) => variable),
    );

    expect(Array.from(stylesheetVariables).sort()).toEqual(
      Object.keys(getMobileThemeVariables(DEFAULT_MOBILE_THEME_ID, "light")).sort(),
    );
  });

  it.each(["light", "dark"] as const)(
    "keeps static %s defaults identical to runtime roles",
    (appearance) => {
      const stylesheet = NodeFS.readFileSync(new URL("../../global.css", import.meta.url), "utf8");
      const section = stylesheet.split(`@variant ${appearance} {`)[1]!.split("\n    }")[0]!;

      const declarations = Object.fromEntries(
        [...section.matchAll(/(--color-[a-z0-9-]+): ([^;]+);/g)].map((match) => [
          match[1],
          match[2],
        ]),
      );

      expect(declarations).toEqual(getMobileThemeVariables(DEFAULT_MOBILE_THEME_ID, appearance));
    },
  );

  it.each(["light", "dark"] as const)(
    "uses shared channel, fold and dictation roles in %s",
    (appearance) => {
      const colors =
        appearance === "light" ? BUILT_IN_THEMES[0].colors : BUILT_IN_THEMES[0].variants!.dark!;

      const variables = getMobileThemeVariables(DEFAULT_MOBILE_THEME_ID, appearance);
      expect(variables["--color-channel-heading"]).toBe(themeColorToNativeColor(colors.text));
      expect(variables["--color-channel-detail"]).toBe(themeColorToNativeColor(colors.textMuted));
      expect(variables["--color-work-fold-separator"]).toBe(themeColorToNativeColor(colors.border));
      expect(variables["--color-dictation-send-icon"]).toBe("#ffffff");
    },
  );

  it("uses the channel palette for headings, detail, and message-origin captions", () => {
    const channels = NodeFS.readFileSync(
      new URL("../features/threads/ThreadChannels.tsx", import.meta.url),
      "utf8",
    );

    const rows = NodeFS.readFileSync(
      new URL("../features/threads/thread-feed-rows.tsx", import.meta.url),
      "utf8",
    );

    expect(channels).toContain('className="font-ottoLegacy-medium text-sm text-channel-heading"');
    expect(channels.match(/text-channel-heading/g)).toHaveLength(3);
    expect(channels.match(/text-channel-detail/g)).toHaveLength(4);
    expect(rows).toContain('className="font-ottoLegacy-medium text-[11px] text-channel-detail"');
  });

  it("shares all built-in desktop palettes", () => {
    expect(BUILT_IN_THEME_IDS).toContain("otto-paper");
    expect(BUILT_IN_THEMES.map((theme) => theme.id)).toEqual(BUILT_IN_THEME_IDS);

    for (const themeId of BUILT_IN_THEME_IDS) {
      expect(getMobileThemeVariables(themeId, "light")["--color-screen"]).toMatch(/^#/);
      expect(getMobileThemeVariables(themeId, "dark")["--color-screen"]).toMatch(/^#/);
    }
  });

  it.each(["light", "dark"] as const)(
    "uses the same %s layers and sky actions as web",
    (appearance) => {
      const colors =
        appearance === "light" ? BUILT_IN_THEMES[0].colors : BUILT_IN_THEMES[0].variants!.dark!;

      const variables = getMobileThemeVariables(DEFAULT_MOBILE_THEME_ID, appearance);
      expect(variables["--color-screen"]).toBe(themeColorToNativeColor(colors.canvas));
      expect(variables["--color-card"]).toBe(themeColorToNativeColor(colors.surface));
      expect(variables["--color-input"]).toBe(variables["--color-card"]);
      expect(variables["--color-primary"]).toBe("#0069a8");
      expect(variables["--color-primary-foreground"]).toBe("#ffffff");
      expect(variables["--color-switch-active-track"]).toBe(variables["--color-primary"]);
      expect(variables["--color-switch-active-thumb"]).toBe("#ffffff");
    },
  );

  it.each(["ocean", "grove", "iris", "ember", "otto-chat", "otto-classic", "custom", null])(
    "normalizes retired %s palettes to the single Otto palette",
    (value) => {
      expect(normalizeMobileThemeId(value)).toBe(DEFAULT_MOBILE_THEME_ID);
      expect(MOBILE_THEME_IDS).toEqual([DEFAULT_MOBILE_THEME_ID]);
    },
  );

  it("accepts only light, dark and system appearance preferences", () => {
    for (const mode of ["light", "dark", "system"])
      expect(normalizeMobileThemeMode(mode)).toBe(mode);
    expect(normalizeMobileThemeMode("sepia")).toBe("system");
  });

  it("converts OKLCH colors to React Native sRGB ColorValues", () => {
    expect(themeColorToNativeColor("oklch(1 0 0)")).toBe("#ffffff");
    expect(themeColorToNativeColor("oklch(0 0 0)")).toBe("#000000");
    expect(themeColorToNativeColor("#123456")).toBe("#123456");
  });

  it("changes native palette color opacity for fades", () => {
    expect(themeColorWithAlpha("#123456", 0)).toBe("rgba(18, 52, 86, 0)");
    expect(themeColorWithAlpha("rgba(18, 52, 86, 0.98)", 0)).toBe("rgba(18, 52, 86, 0)");
  });

  it("maps semantic palette roles onto every mobile color variable", () => {
    const variables = createMobileThemeVariables(BUILT_IN_THEMES[0].colors, "light");
    expect(Object.keys(variables).sort()).toEqual(
      Object.keys(getMobileThemeVariables(DEFAULT_MOBILE_THEME_ID, "light")).sort(),
    );
    expect(variables["--color-sheet-solid"]).toBe(
      themeColorToNativeColor(BUILT_IN_THEMES[0].colors.chrome),
    );
    expect(variables["--color-primary"]).not.toBe(variables["--color-screen"]);
    expect(variables["--color-primary-shadow"]).toBe("#000000");
    expect(variables["--color-backdrop"]).toBe("rgba(0, 0, 0, 0.22)");
    expect(variables["--color-drawer-shadow"]).toBe("rgba(0, 0, 0, 0.12)");
    expect(variables["--color-user-bubble-foreground"]).toMatch(/^#/);
    expect(Object.keys(getMobileThemeVariables(DEFAULT_MOBILE_THEME_ID, "light")).sort()).toEqual(
      Object.keys(variables).sort(),
    );
    expect(Object.keys(getMobileThemeVariables(DEFAULT_MOBILE_THEME_ID, "dark")).sort()).toEqual(
      Object.keys(variables).sort(),
    );
  });

  it("keeps every built-in shadow and backdrop black-based in dark mode", () => {
    for (const theme of BUILT_IN_THEMES) {
      const variables = getMobileThemeVariables(normalizeMobileThemeId(theme.id), "dark");
      expect(variables["--color-primary-shadow"]).toBe("#000000");
      expect(variables["--color-backdrop"]).toBe("rgba(0, 0, 0, 0.48)");
      expect(variables["--color-drawer-shadow"]).toBe("rgba(0, 0, 0, 0.32)");
    }
  });

  it("keeps placeholders and selected-row labels readable on their mobile surfaces", () => {
    for (const themeId of MOBILE_THEME_IDS) {
      for (const appearance of ["light", "dark"] as const) {
        const variables = getMobileThemeVariables(themeId, appearance);
        expect(
          contrastRatio(variables["--color-placeholder"], variables["--color-input"]),
        ).toBeGreaterThanOrEqual(4.5);
      }
    }

    for (const themeId of BUILT_IN_THEME_IDS) {
      for (const appearance of ["light", "dark"] as const) {
        const variables = getMobileThemeVariables(themeId, appearance);
        expect(
          contrastRatio(
            variables["--color-user-bubble-foreground"],
            variables["--color-user-bubble"],
          ),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(
            variables["--color-user-bubble-skill-foreground"],
            variables["--color-user-bubble"],
          ),
        ).toBeGreaterThanOrEqual(4.5);
        expect(variables["--color-user-bubble-skill-foreground"]).not.toBe(
          variables["--color-user-bubble-foreground"],
        );

        const fenceSurface = compositeOver(
          variables["--color-md-user-fence-bg"],
          variables["--color-user-bubble"],
        );

        expect(fenceSurface).not.toBe(variables["--color-user-bubble"]);
        expect(
          contrastRatio(variables["--color-md-user-fence-text"], fenceSurface),
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
