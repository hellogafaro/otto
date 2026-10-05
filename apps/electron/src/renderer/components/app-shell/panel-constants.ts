/** Gap between any adjacent panels (sidebar ↔ navigator ↔ content) */
export const PANEL_GAP = 6

/** Padding from window edges to outermost panels (right, bottom, left when sidebar hidden) */
export const PANEL_EDGE_INSET = 8

/** Corner radius for interior corners between panels */
export const RADIUS_INNER = 10

/**
 * Side panel widths on the golden ratio: the list is 280 and the status
 * sidebar beside it is 280 / 1.618 ≈ 173, rounded to the 8px grid (176). The
 * list grows up to 280 × 1.618 ≈ 453.
 */
export const SIDEBAR_WIDTH = 176
export const SIDEBAR_MIN = 144
export const SIDEBAR_MAX = 232
export const LIST_WIDTH = 280
export const LIST_MIN = 240
export const LIST_MAX = 452

/** Minimum width for any content panel */
export const PANEL_MIN_WIDTH = 440

/** Extra vertical space reserved in panel stack for box-shadows. */
export const PANEL_STACK_VERTICAL_OVERFLOW = 8

/**
 * Shared resize sash geometry.
 *
 * Keep all seams (sidebar, navigator/content, panel/panel) aligned by deriving
 * offsets from these constants instead of hardcoded pixel literals.
 */
export const PANEL_SASH_HIT_WIDTH = 8
export const PANEL_SASH_LINE_WIDTH = 2

/**
 * When the sash is inserted between two flex items, flex gap would apply twice
 * (item↔sash and sash↔item). Pull it back by half the gap on both sides so
 * the visible distance remains exactly PANEL_GAP.
 */
export const PANEL_SASH_FLEX_MARGIN = -(PANEL_GAP / 2)

/** Half-width helper for centering sash containers on seam coordinates. */
export const PANEL_SASH_HALF_HIT_WIDTH = PANEL_SASH_HIT_WIDTH / 2
