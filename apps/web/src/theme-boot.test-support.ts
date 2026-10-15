import { vi } from "vite-plus/test";
import indexHtml from "../index.html?raw";
import { OTTO_PAPER_THEME, resolveThemeAppearance } from "./theme-palette";
import { toCanonicalThemeColor } from "./theme-palette.test-support";

import { readAppearanceModePreference } from "./theme/preference-storage";

export function fixedBootColors(isDark: boolean) {
  return isDark ? OTTO_PAPER_THEME.variants!.dark! : OTTO_PAPER_THEME.colors;
}

export const THEME_STORAGE_KEY = "otto:theme";

const bootScript = (() => {
  const match = indexHtml.match(/<script>([\s\S]*?)<\/script>/);

  if (!match?.[1]) throw new Error("Could not find the inline boot script in index.html");

  return match[1];
})();

type BootResult = {
  isDark: boolean;
  themeId: string | undefined;
  themeSelected: string | undefined;
  backgroundColor: string;
  bootVariables: Record<string, string>;
  metaContent: string | null;
};

export function runBootScript(options: {
  storage?: Record<string, string>;
  storageThrows?: boolean;
  prefersDark: boolean;
}): BootResult {
  const classes = new Set<string>();
  const bootVariables: Record<string, string> = {};

  type ThemeMeta = { content: string | null; setAttribute: (name: string, value: string) => void };

  const meta: ThemeMeta = {
    content: null,
    setAttribute(_name: string, value: string) {
      this.content = value;
    },
  };

  const dataset: DOMStringMap = {};

  const documentElement = {
    dataset,
    classList: {
      add: (name: string) => void classes.add(name),
      remove: (name: string) => void classes.delete(name),
      toggle: (name: string, force?: boolean) => {
        const next = force ?? !classes.has(name);

        if (next) classes.add(name);
        else classes.delete(name);

        return next;
      },
    },
    style: {
      backgroundColor: "",
      setProperty: (name: string, value: string) => {
        bootVariables[name] = value;
      },
    },
  };

  const fakeDocument = {
    documentElement,
    querySelectorAll: (selector: string) => (selector === 'meta[name="theme-color"]' ? [meta] : []),
  };

  const fakeWindow = {
    localStorage: {
      getItem: (key: string): string | null => {
        if (options.storageThrows) throw new Error("storage blocked");

        return options.storage?.[key] ?? null;
      },
    },
    matchMedia: () => ({ matches: options.prefersDark }),
  };

  const fakeCss = {
    supports: (property: string, value: string) =>
      property === "color" && toCanonicalThemeColor(value) !== null,
  };

  new Function("window", "document", "CSS", bootScript)(fakeWindow, fakeDocument, fakeCss);

  return {
    isDark: classes.has("dark"),
    themeId: documentElement.dataset.themeId,
    themeSelected: documentElement.dataset.themeSelected,
    backgroundColor: documentElement.style.backgroundColor,
    bootVariables,
    metaContent: meta.content,
  };
}

/** Mirrors getStored + readAppearanceModePreference + resolveThemeAppearance from the runtime. */
export function runtimeResolvedAppearance(
  storage: Record<string, string>,
  prefersDark: boolean,
): "light" | "dark" {
  vi.stubGlobal("window", {
    localStorage: { getItem: (key: string) => storage[key] ?? null },
    matchMedia: () => ({ matches: prefersDark }),
  });

  try {
    const raw = storage[THEME_STORAGE_KEY] ?? storage["ottoLegacy:theme"] ?? null;
    const theme = raw === "light" || raw === "dark" ? raw : "otto-paper";
    const mode = readAppearanceModePreference(theme);

    return resolveThemeAppearance("otto-paper", prefersDark, mode === "system", mode);
  } finally {
    vi.unstubAllGlobals();
  }
}

export const AURORA_DUAL = {
  id: "aurora",
  label: "Aurora",
  appearance: "light",
  colors: { canvas: "#f8fbff", text: "#10243d", accent: "#5b6cff" },
  variants: { dark: { canvas: "#101827", text: "#eef5ff", accent: "#7c93ff" } },
};

export const CHARCOAL_DARK_ONLY = {
  id: "charcoal",
  label: "Charcoal",
  appearance: "dark",
  colors: { canvas: "#1c1210", text: "#ffe8d9", accent: "#ff7a45" },
};
