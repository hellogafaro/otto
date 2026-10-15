import type { ThemePreferenceMode } from "./theme-types";

export function resolveDesktopTheme(
  theme: string,
  followSystem?: boolean,
  appearanceMode?: ThemePreferenceMode,
): ThemePreferenceMode {
  if (appearanceMode) return appearanceMode;

  if (followSystem) return "system";

  return theme === "light" || theme === "dark" ? theme : "system";
}

export function resolveThemeAppearance(
  theme: string,
  systemDark: boolean,
  followSystem?: boolean,
  appearanceMode?: ThemePreferenceMode,
): "light" | "dark" {
  const mode = resolveDesktopTheme(theme, followSystem, appearanceMode);

  return mode === "system" ? (systemDark ? "dark" : "light") : mode;
}
