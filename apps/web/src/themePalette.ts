export {
  OTTO_PAPER_THEME,
  BUILT_IN_THEMES,
  THEME_COLOR_ROLES,
  type ThemeAppearance,
  type ThemeColorRole,
  type ThemeColors,
  type ThemeDefinition,
  type ThemeVariants,
} from "@otto/shared/themePalettes";

export {
  THEME_FOLLOW_SYSTEM_STORAGE_KEY,
  THEME_APPEARANCE_MODE_STORAGE_KEY,
  LEGACY_THEME_FOLLOW_SYSTEM_STORAGE_KEY,
  LEGACY_THEME_APPEARANCE_MODE_STORAGE_KEY,
  ThemePreference,
  type ThemePreferenceMode,
} from "./theme/themeTypes";

export { applyThemePalette } from "./theme/applyPalette";

export {
  getThemeDefinition,
  getThemeColorsForMode,
  getThemeModes,
  getThemePreferenceMode,
} from "./theme/themeDefinitions";

export { resolveThemeAppearance, resolveDesktopTheme } from "./theme/themePreference";
