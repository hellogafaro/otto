import * as Predicate from "effect/Predicate";
import { safeErrorLogAttributes } from "@otto/client-runtime/errors";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  applyThemePalette,
  resolveThemeAppearance,
  LEGACY_THEME_APPEARANCE_MODE_STORAGE_KEY,
  LEGACY_THEME_FOLLOW_SYSTEM_STORAGE_KEY,
  THEME_APPEARANCE_MODE_STORAGE_KEY,
  THEME_FOLLOW_SYSTEM_STORAGE_KEY,
  type ThemePreferenceMode,
} from "../theme-palette";
import {
  type Theme,
  STORAGE_KEY,
  LEGACY_STORAGE_KEY,
  DEFAULT_THEME,
  ThemeStorageError,
  isThemeStorageError,
  readAppearanceModePreference,
  writeAppearanceModePreference,
  persistThemePreference,
} from "../theme/preference-storage";
import { syncBrowserChromeTheme } from "../theme/browser-chrome";
import { syncDesktopTheme } from "../theme/desktop-sync";

type ThemeSnapshot = {
  theme: Theme;
  systemDark: boolean;
  followSystem: boolean;
  appearanceMode: ThemePreferenceMode;
};

const MEDIA_QUERY = "(prefers-color-scheme: dark)";

const DEFAULT_THEME_SNAPSHOT: ThemeSnapshot = {
  theme: DEFAULT_THEME,
  systemDark: false,
  followSystem: true,
  appearanceMode: "system",
};

let listeners: Array<() => void> = [];

let lastSnapshot: ThemeSnapshot | null = null;

let snapshotStale = true;

let lastAppliedTheme: ThemeSnapshot | null = null;

let themeStorageReadFailure: ThemeStorageError | null = null;

function emitChange() {
  snapshotStale = true;

  for (const listener of listeners) listener();
}

function getSystemDark() {
  return (
    typeof window !== "undefined" &&
    Predicate.isFunction(window.matchMedia) &&
    window.matchMedia(MEDIA_QUERY).matches
  );
}

export function writeThemePreference(theme: Theme): void {
  if (typeof window === "undefined") return;
  persistThemePreference(theme);
  themeStorageReadFailure = null;
}

function getStored(): Theme {
  if (themeStorageReadFailure !== null) {
    return DEFAULT_THEME_SNAPSHOT.theme;
  }

  try {
    const stored =
      window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);

    return stored === "light" || stored === "dark" ? stored : DEFAULT_THEME;
  } catch (cause) {
    const error = isThemeStorageError(cause)
      ? cause
      : new ThemeStorageError({
          operation: "read",
          storageKey: STORAGE_KEY,
          cause,
        });

    themeStorageReadFailure = error;
    console.error(error.message, {
      operation: error.operation,
      storageKey: error.storageKey,
      ...safeErrorLogAttributes(error),
    });

    return DEFAULT_THEME_SNAPSHOT.theme;
  }
}

function applyTheme(theme: Theme, suppressTransitions = false) {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const appearanceMode = readAppearanceModePreference(theme);
  const followSystem = appearanceMode === "system";
  const systemDark = followSystem ? getSystemDark() : false;

  if (
    lastAppliedTheme?.theme === theme &&
    lastAppliedTheme.systemDark === systemDark &&
    lastAppliedTheme.followSystem === followSystem &&
    lastAppliedTheme.appearanceMode === appearanceMode
  ) {
    syncDesktopTheme(DEFAULT_THEME, followSystem, appearanceMode);

    return;
  }

  if (suppressTransitions) {
    document.documentElement.classList.add("no-transitions");
  }

  const resolvedAppearance = resolveThemeAppearance(
    DEFAULT_THEME,
    systemDark,
    followSystem,
    appearanceMode,
  );

  applyThemePalette(DEFAULT_THEME, resolvedAppearance);
  const isDark = resolvedAppearance === "dark";
  document.documentElement.classList.toggle("dark", isDark);
  lastAppliedTheme = { theme, systemDark, followSystem, appearanceMode };
  syncBrowserChromeTheme();
  syncDesktopTheme(DEFAULT_THEME, followSystem, appearanceMode);

  if (suppressTransitions) {
    // Force a reflow so the no-transitions class takes effect before removal
    void document.documentElement.offsetHeight;
    requestAnimationFrame(() => {
      document.documentElement.classList.remove("no-transitions");
    });
  }
}

// Apply immediately on module load to prevent flash
if (typeof document !== "undefined" && typeof window !== "undefined") {
  applyTheme(getStored());
}

function getSnapshot(): ThemeSnapshot {
  if (typeof window === "undefined") return DEFAULT_THEME_SNAPSHOT;

  // Reading the preference hits localStorage, so only recompute after a
  // change was signalled; useTheme consumers call this on every render.
  if (!snapshotStale && lastSnapshot) return lastSnapshot;
  snapshotStale = false;
  const theme = getStored();
  const appearanceMode = readAppearanceModePreference(theme);
  const followSystem = appearanceMode === "system";
  const systemDark = followSystem ? getSystemDark() : false;

  if (
    lastSnapshot &&
    lastSnapshot.theme === theme &&
    lastSnapshot.systemDark === systemDark &&
    lastSnapshot.followSystem === followSystem &&
    lastSnapshot.appearanceMode === appearanceMode
  ) {
    return lastSnapshot;
  }

  lastSnapshot = { theme, systemDark, followSystem, appearanceMode };

  return lastSnapshot;
}

function getServerSnapshot() {
  return DEFAULT_THEME_SNAPSHOT;
}

function handleSystemAppearanceChange() {
  const storedTheme = getStored();

  if (readAppearanceModePreference(storedTheme) === "system") applyTheme(storedTheme, true);
  emitChange();
}

function handleStorageChange(e: StorageEvent) {
  if (e.key === STORAGE_KEY || e.key === LEGACY_STORAGE_KEY) {
    themeStorageReadFailure = null;
    applyTheme(getStored(), true);
    emitChange();
  } else if (
    e.key === THEME_FOLLOW_SYSTEM_STORAGE_KEY ||
    e.key === LEGACY_THEME_FOLLOW_SYSTEM_STORAGE_KEY
  ) {
    applyTheme(getStored(), true);
    emitChange();
  } else if (
    e.key === THEME_APPEARANCE_MODE_STORAGE_KEY ||
    e.key === LEGACY_THEME_APPEARANCE_MODE_STORAGE_KEY
  ) {
    applyTheme(getStored(), true);
    emitChange();
  } else if (e.key === null) {
    if (e.key === null) themeStorageReadFailure = null;
    lastAppliedTheme = null;
    applyTheme(getStored(), true);
    emitChange();
  }
}

let removeWindowListeners: (() => void) | null = null;

function subscribe(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  listeners.push(listener);

  // The system-preference and cross-tab listeners are shared by all
  // subscribers; each event applies the theme once and notifies everyone.
  if (!removeWindowListeners) {
    const mq = Predicate.isFunction(window.matchMedia) ? window.matchMedia(MEDIA_QUERY) : null;
    mq?.addEventListener("change", handleSystemAppearanceChange);
    window.addEventListener("storage", handleStorageChange);
    removeWindowListeners = () => {
      mq?.removeEventListener("change", handleSystemAppearanceChange);
      window.removeEventListener("storage", handleStorageChange);
    };
  }

  return () => {
    listeners = listeners.filter((l) => l !== listener);

    if (listeners.length === 0) {
      removeWindowListeners?.();
      removeWindowListeners = null;
    }
  };
}

export function useTheme() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const theme = snapshot.theme;

  const resolvedTheme: "light" | "dark" = resolveThemeAppearance(
    DEFAULT_THEME,
    snapshot.systemDark,
    snapshot.followSystem,
    snapshot.appearanceMode,
  );

  const setAppearanceMode = useCallback((nextAppearanceMode: ThemePreferenceMode): boolean => {
    if (typeof window === "undefined") return false;

    try {
      writeAppearanceModePreference(nextAppearanceMode);
    } catch (cause) {
      const error = isThemeStorageError(cause)
        ? cause
        : new ThemeStorageError({
            operation: "write",
            storageKey: THEME_APPEARANCE_MODE_STORAGE_KEY,
            cause,
          });

      console.error(error.message, {
        operation: error.operation,
        storageKey: error.storageKey,
        ...safeErrorLogAttributes(error),
      });

      return false;
    }

    themeStorageReadFailure = null;
    applyTheme(getStored(), true);
    emitChange();

    return true;
  }, []);

  // Keep DOM in sync on mount/change
  useEffect(() => {
    applyTheme(theme);
  }, [snapshot.appearanceMode, theme]);

  return {
    theme: DEFAULT_THEME,
    setAppearanceMode,
    followSystem: snapshot.followSystem,
    appearanceMode: snapshot.appearanceMode,
    resolvedTheme,
  } as const;
}

export {
  ThemeStorageError,
  isThemeStorageError,
  readAppearanceModePreference,
  readThemePreference,
} from "../theme/preference-storage";

export { syncBrowserChromeTheme } from "../theme/browser-chrome";

export {
  DesktopThemeSyncError,
  isDesktopThemeSyncError,
  syncDesktopThemePreference,
  syncDesktopTheme,
} from "../theme/desktop-sync";
