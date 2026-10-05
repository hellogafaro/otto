/**
 * The design system's menu look (`@workspace/ui` dropdown-menu) for the menus
 * that cannot be a Base UI menu: caret-anchored suggestion lists (/, @, labels)
 * and cmdk lists, which own their keyboard handling. One copy: surface, 28px
 * rows (6px radius inside a 4px padded container), highlight `foreground/10`.
 * A chosen row shows a check icon, never a fill.
 */

/** Floating surface: dark, translucent, blurred, `lg` radius with 4px padding. Needs a positioned element: `fixed` or `relative`. */
export const MENU_SURFACE =
  'dark overflow-hidden rounded-lg bg-popover/70 p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-2xl before:backdrop-saturate-150'

/** Scrolling list inside the surface (the surface already pads it). */
export const MENU_LIST = 'max-h-[240px] overflow-y-auto'

/** One row: 28px, `sm` radius, 14px icons. Add `MENU_ROW_HIGHLIGHT` or the cmdk variant for the active row. */
export const MENU_ROW =
  'flex h-7 shrink-0 cursor-default select-none items-center gap-2 rounded-sm px-2 text-sm outline-hidden [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-3.5'

/** Highlighted row (keyboard or pointer) in a hand-rolled list. */
export const MENU_ROW_HIGHLIGHT = 'bg-foreground/10'

/** Highlighted row in a cmdk list. */
export const MENU_ROW_CMDK = `${MENU_ROW} data-[selected=true]:bg-foreground/10`

/** Group heading above rows. */
export const MENU_LABEL = 'px-2 py-1.5 text-xs font-medium text-muted-foreground'

/** Hairline between groups, edge to edge of the 4px padding. */
export const MENU_SEPARATOR = '-mx-1 my-1 h-px bg-foreground/5'
