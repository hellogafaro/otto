/**
 * Otto: Compact roster rows, copied from Capy's sidebar: 28px, a 16px avatar
 * 6px in and centered under the 24px in-row chevron, 8px gap and right inset, 13px name at 80% (68% in dark) that turns full strength
 * when active, and an 11px short time at 52% on the right. Names never ellipsize: they
 * run under the right slot (ROSTER_TRAIL_CLASS), which fades over them.
 */
export const ROSTER_NAME_CLASS =
  "min-w-0 flex-1 overflow-hidden whitespace-nowrap text-13px font-normal text-sidebar-foreground/80 dark:text-sidebar-foreground/68";

/**
 * Otto: A row's keyboard focus: a 1px inset ring drawn over the whole row, above the right
 * slot's fade, so the fade never cuts it off.
 */
export const ROSTER_ROW_FOCUS_CLASS =
  "after:pointer-events-none after:absolute after:inset-0 after:rounded-md after:ring-inset after:ring-ring has-[>button:focus-visible]:after:ring-1";

/** Row controls appear on hover or keyboard focus, like Capy's row actions. */
export const ROSTER_REVEAL_CLASS =
  "opacity-0 transition-opacity duration-100 group-focus-within/row:opacity-100 group-hover/row:opacity-100 motion-reduce:transition-none";

/**
 * Otto: The row's right slot, like Capy's: info at rest, actions on hover, keyboard focus or
 * while their menu is open, on a
 * gradient in the row's fill that is only as wide as what it shows. The row (group/row)
 * carries a sidebar-row-* fill so hovering an action keeps the whole row hovered.
 */
export const ROSTER_TRAIL_CLASS =
  "sidebar-row-trail pointer-events-none absolute inset-y-0 right-0 flex items-center rounded-e-md ps-6 pe-0.5";

export const ROSTER_TRAIL_INFO_CLASS =
  "flex items-center gap-2 pe-1.5 group-hover/row:hidden group-has-focus-visible/row:hidden group-has-data-popup-open/row:hidden";

export const ROSTER_TRAIL_ACTIONS_CLASS =
  "pointer-events-auto hidden group-hover/row:flex group-has-focus-visible/row:flex group-has-data-popup-open/row:flex";

export const ROSTER_TIME_CLASS =
  "flex min-w-6 shrink-0 justify-end text-11px tabular-nums text-sidebar-foreground/52";
