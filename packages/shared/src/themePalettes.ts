import { type ThemeAppearance, type ThemeColors, type ThemeDefinition } from "./themes/types.ts";
import { OTTO_PAPER_THEME } from "./themes/otto-paper.ts";

export const BUILT_IN_THEMES: ReadonlyArray<ThemeDefinition> = [OTTO_PAPER_THEME];

export function getBuiltInTheme(id: string): ThemeDefinition | null {
  return BUILT_IN_THEMES.find((theme) => theme.id === id) ?? null;
}

export function getThemeColorsForAppearance(
  theme: ThemeDefinition,
  appearance: ThemeAppearance,
): ThemeColors | null {
  if (theme.appearance === appearance) return theme.colors;

  return theme.variants?.[appearance] ?? null;
}

export {
  BUILT_IN_THEME_IDS,
  MOBILE_DEFAULT_THEME_ID,
  MOBILE_THEME_IDS,
  type BuiltInThemeId,
  type MobileThemeId,
  type ThemeAppearance,
  THEME_COLOR_ROLES,
  type ThemeColorRole,
  type ThemeColors,
  type ThemeVariants,
  type ThemeDefinition,
} from "./themes/types.ts";

export { OTTO_PAPER_THEME } from "./themes/otto-paper.ts";
