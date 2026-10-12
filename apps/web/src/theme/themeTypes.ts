import * as Schema from "effect/Schema";
import type { ThemeAppearance } from "@otto/shared/themePalettes";

export const THEME_FOLLOW_SYSTEM_STORAGE_KEY = "otto:theme-follow-system";

export const THEME_APPEARANCE_MODE_STORAGE_KEY = "otto:theme-appearance-mode";

export const LEGACY_THEME_FOLLOW_SYSTEM_STORAGE_KEY = "ottoLegacy:theme-follow-system";

export const LEGACY_THEME_APPEARANCE_MODE_STORAGE_KEY = "ottoLegacy:theme-appearance-mode";

export const ThemePreference = Schema.String;

export type ThemePreference = typeof ThemePreference.Type;

export type ThemePreferenceMode = ThemeAppearance | "system";
