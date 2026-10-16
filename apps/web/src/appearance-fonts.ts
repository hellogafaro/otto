/**
 * Otto: Font sizes from Settings → Appearance, applied as CSS custom
 * properties. The families are fixed: Inter for the interface, Geist Mono for
 * code.
 */

import {
  DEFAULT_CODE_FONT_SIZE,
  DEFAULT_INTERFACE_FONT_SIZE,
  MAX_CODE_FONT_SIZE,
  MAX_INTERFACE_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_INTERFACE_FONT_SIZE,
} from "@otto/contracts";

function quoteFontFamilyName(name: string): string {
  const bare = name.trim();

  if (bare.length === 0) return "";

  // Already quoted, or a single ident that needs no quoting.
  if (/^(['"]).*\1$/.test(bare)) return bare;

  if (/^[a-zA-Z][a-zA-Z0-9-]*$/.test(bare)) return bare;

  return `"${bare.replaceAll('"', "")}"`;
}

/**
 * Normalize a user-entered family (single name or comma-separated list) into a
 * safe CSS font-family list, or null when the input is effectively empty.
 */
export function cssFontFamilies(input: string): string | null {
  const families = input
    .split(",")
    .map(quoteFontFamilyName)
    .filter((name) => name.length > 0);

  return families.length > 0 ? families.join(", ") : null;
}

export interface AppearanceFontPreferences {
  readonly sizeInterface: number;
  readonly sizeCode: number;
}

/**
 * The interface size drives the root font size (and with it every rem-based
 * dimension), while the code size stays in absolute pixels so it does not
 * scale twice.
 */
export function applyAppearanceFontVariables(
  root: HTMLElement,
  preferences: AppearanceFontPreferences,
): void {
  root.style.fontSize = `${clampInterfaceFontSize(preferences.sizeInterface)}px`;
  const code = clampCodeFontSize(preferences.sizeCode);
  root.style.setProperty("--font-size-code", `${code}px`);
  // The @pierre/diffs surfaces read their own hook for code text.
  root.style.setProperty("--diffs-font-size", `${code}px`);
}

function clampFontSize(value: number, minimum: number, maximum: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;

  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

export function clampInterfaceFontSize(value: number): number {
  return clampFontSize(
    value,
    MIN_INTERFACE_FONT_SIZE,
    MAX_INTERFACE_FONT_SIZE,
    DEFAULT_INTERFACE_FONT_SIZE,
  );
}

export function clampCodeFontSize(value: number): number {
  return clampFontSize(value, MIN_CODE_FONT_SIZE, MAX_CODE_FONT_SIZE, DEFAULT_CODE_FONT_SIZE);
}

const MONOSPACE_PROBE_VARIANTS = ["normal 400", "normal 700", "italic 400", "italic 700"] as const;

const MONOSPACE_PROBE_GLYPHS = ["i", "M", "W", "0", "@", "#", ".", " "] as const;

const MONOSPACE_ADVANCE_TOLERANCE = 0.01;

export function areFontAdvancesMonospace(advances: readonly number[]): boolean {
  const reference = advances[0];

  if (
    reference === undefined ||
    reference <= 0 ||
    advances.some((advance) => !Number.isFinite(advance) || advance <= 0)
  ) {
    return true;
  }

  return advances.every((advance) => Math.abs(advance - reference) < MONOSPACE_ADVANCE_TOLERANCE);
}

/**
 * Whether a family renders every character on the same advance. Cell-grid
 * surfaces (the terminal) require this: a proportional face draws its text
 * narrower than the lattice the cursor and selection are placed on, which
 * reads as ragged gaps and a cursor stranded to the right of the text.
 *
 * Unmeasurable environments answer true, so a missing canvas never blocks a
 * legitimate font.
 */
export function isMonospaceFamily(family: string): boolean {
  const families = cssFontFamilies(family);

  if (families === null) return true;

  try {
    const context = document.createElement("canvas").getContext("2d");

    if (context === null) return true;

    // Fall back to a generic mono so an absent face measures as monospace and
    // is left for the normal fallback chain to resolve.
    for (const variant of MONOSPACE_PROBE_VARIANTS) {
      context.font = `${variant} 32px ${families}, monospace`;
      const advances = MONOSPACE_PROBE_GLYPHS.map((glyph) => context.measureText(glyph).width);

      if (!areFontAdvancesMonospace(advances)) return false;
    }

    return true;
  } catch {
    return true;
  }
}
