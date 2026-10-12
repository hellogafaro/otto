import * as Predicate from "effect/Predicate";
import type { DesktopBridge } from "@otto/contracts";
import { safeErrorLogAttributes } from "@otto/client-runtime/errors";
import * as Schema from "effect/Schema";
import { resolveDesktopTheme } from "./themePreference";
import { ThemePreference, type ThemePreferenceMode } from "./themeTypes";
import { type Theme } from "./preferenceStorage";

type DesktopThemeBridge = Pick<DesktopBridge, "setTheme">;

export class DesktopThemeSyncError extends Schema.TaggedErrorClass<DesktopThemeSyncError>()(
  "DesktopThemeSyncError",
  {
    theme: ThemePreference,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to sync the ${this.theme} theme to the desktop shell.`;
  }
}

export const isDesktopThemeSyncError = Schema.is(DesktopThemeSyncError);

let lastDesktopTheme: "light" | "dark" | "system" | null = null;

export async function syncDesktopThemePreference(
  bridge: DesktopThemeBridge,
  theme: Theme,
  followSystem?: boolean,
  appearanceMode?: ThemePreferenceMode,
): Promise<void> {
  try {
    await bridge.setTheme(resolveDesktopTheme(theme, followSystem, appearanceMode));
  } catch (cause) {
    throw new DesktopThemeSyncError({ theme, cause });
  }
}

export function syncDesktopTheme(
  theme: Theme,
  followSystem?: boolean,
  appearanceMode?: ThemePreferenceMode,
) {
  if (typeof window === "undefined") return;
  const bridge = window.desktopBridge;
  const desktopTheme = resolveDesktopTheme(theme, followSystem, appearanceMode);

  if (!bridge || !Predicate.isFunction(bridge.setTheme) || lastDesktopTheme === desktopTheme) {
    return;
  }

  lastDesktopTheme = desktopTheme;
  void syncDesktopThemePreference(bridge, theme, followSystem, appearanceMode).catch(
    (cause: unknown) => {
      const error = isDesktopThemeSyncError(cause)
        ? cause
        : new DesktopThemeSyncError({ theme, cause });

      console.error(error.message, {
        theme: error.theme,
        ...safeErrorLogAttributes(error),
      });

      if (lastDesktopTheme === desktopTheme) {
        lastDesktopTheme = null;
      }
    },
  );
}
