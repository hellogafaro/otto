import {
  getBuiltInTheme,
  getThemeColorsForAppearance,
  type ThemeAppearance,
  type ThemeDefinition,
} from "@otto/shared/themePalettes";

export const getThemeDefinition = getBuiltInTheme;

export const getThemeColorsForMode = getThemeColorsForAppearance;

export function getThemeModes(theme: ThemeDefinition): ReadonlyArray<ThemeAppearance> {
  return (["light", "dark"] as const).filter(
    (mode) => getThemeColorsForAppearance(theme, mode) !== null,
  );
}

export function getThemePreferenceMode(theme: string): ThemeAppearance | null {
  return theme === "light" || theme === "dark" ? theme : null;
}
