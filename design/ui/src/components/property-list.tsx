import * as React from "react"
import { ChevronRightIcon } from "lucide-react"
import { cn } from "cn"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { Count } from "@workspace/ui/components/count"
import { Kbd } from "@workspace/ui/components/kbd"

// Otto: the Details blocks of a sidecar (task, project, routine, library item),
// Otto v1's right column: plain text on the page background, no surface. A
// section is a quiet title and its rows under it; sections stack 24px apart, no
// dividers. The title is a 24px row, 13px muted, starting on the rows' icon line
// (8px in); its whole row folds the section (Enter or Space): the title, its
// `Count` (not drawn for 0), then a 14px chevron, right when folded and down
// when open, shown on hover, focus or while folded (always on touch). Rows start
// 4px under it, edge to edge. A section with no rows is not drawn.
// Otto: `action` is the section's create "+" (a 24px ghost icon button), at
// the end of the title row and beside the folding trigger, not inside it; a
// section with an action is drawn even with no rows.
function PropertySection({
  title,
  count,
  action,
  defaultOpen = true,
  className,
  children,
}: {
  title: React.ReactNode
  /** Shown after the title; 0 is not drawn. Otto: text too (a total, such as a task's logged time). */
  count?: number | string
  action?: React.ReactNode
  defaultOpen?: boolean
  className?: string
  children?: React.ReactNode
}) {
  if (!action && React.Children.toArray(children).length === 0) return null
  return (
    <Collapsible
      data-slot="property-section"
      defaultOpen={defaultOpen}
      className={cn("not-first:mt-6", className)}
    >
      <div className="relative">
        <CollapsibleTrigger className="group/property-section flex h-6 w-full items-center gap-2 rounded-sm px-2 text-left text-sm text-muted-foreground outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
          <span className="min-w-0 truncate">{title}</span>
          {!!count && <Count>{count}</Count>}
          <ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-data-panel-open/property-section:rotate-90 group-data-panel-open/property-section:opacity-0 group-hover/property-section:opacity-100! group-focus-visible/property-section:opacity-100! not-pointer-fine:opacity-100! motion-reduce:transition-none" />
        </CollapsibleTrigger>
        {action && <div className="absolute inset-y-0 right-0 flex items-center">{action}</div>}
      </div>
      <CollapsibleContent>
        <div className="mt-1 flex flex-col">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

// Otto: one property, Otto v1's row: icon + value, a 32px row with `md` 8
// corners as wide as the sidecar. The 16px `icon` slot 8px in (a 14px glyph
// centered, an avatar shrinks to fill it), 8px, then the `value` (foreground,
// truncated; `placeholder` in muted when there is none). The `label` names the
// value for screen readers only (the icon and the value say it on screen); a row
// with only a `label` shows it as a muted full-width row (a list's create is the
// section's `action`, not a row). A row with only a `value` is a list item (a
// link, a chat, a time entry). An optional `kbd` (the row's hotkey, the 20px
// `Kbd` at the end, shown on hover, focus or while open; never on touch). As a
// button (the default) it opens its menu or popover: pass it as the trigger's
// `render`. The ghost states: hover `foreground/5`, pressed and open
// (`aria-expanded`) `/10`, the inset focus ring, disabled 50%. `readOnly` draws
// plain text with no states. `actions` (an `icon-xs` ghost Button, such as
// Remove, drawn here at 20px with `xs` 4 corners and a `foreground/10` hover
// that stacks on the row's) sit 6px inside the end, shown on hover or focus
// (always on touch); hovering one keeps the row highlighted.
function PropertyRow({
  icon,
  label,
  value,
  placeholder,
  kbd,
  actions,
  readOnly = false,
  className,
  ...props
}: Omit<React.ComponentProps<"button">, "value"> & {
  icon?: React.ReactNode
  label?: React.ReactNode
  value?: React.ReactNode
  /** Shown muted when there is no value ("No due date"). */
  placeholder?: React.ReactNode
  /** The row's hotkey, as a `Kbd`. */
  kbd?: React.ReactNode
  /** One 20px ghost icon button at the row's end. */
  actions?: React.ReactNode
  readOnly?: boolean
}) {
  const empty = value === undefined || value === null || value === ""
  const hasValue = !empty || placeholder !== undefined
  const content = (
    <>
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&>[data-slot=avatar]]:size-4! [&>svg]:size-3.5">
        {icon}
      </span>
      {label !== undefined && (
        <span
          className={cn(
            hasValue ? "sr-only" : "min-w-0 flex-1 truncate text-muted-foreground"
          )}
        >
          {label}
        </span>
      )}
      {hasValue && (
        <span
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 [&>svg]:size-3.5 [&>svg]:shrink-0",
            empty && "text-muted-foreground"
          )}
        >
          {empty ? (
            placeholder
          ) : typeof value === "string" ? (
            <span className="truncate">{value}</span>
          ) : (
            value
          )}
        </span>
      )}
      {kbd && !readOnly && (
        <Kbd className="opacity-0 group-focus-within/property-row:opacity-100 group-hover/property-row:opacity-100 group-has-aria-expanded/property-row:opacity-100 not-pointer-fine:hidden">
          {kbd}
        </Kbd>
      )}
    </>
  )
  const rowClass = cn(
    "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-foreground",
    actions && "pr-8",
    className
  )
  return (
    <div data-slot="property-row" className="group/property-row relative">
      {readOnly ? (
        <div className={rowClass}>{content}</div>
      ) : (
        <button
          type="button"
          className={cn(
            "transition-colors outline-none select-none enabled:group-hover/property-row:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-foreground/10 disabled:pointer-events-none disabled:opacity-50 aria-expanded:bg-foreground/10",
            rowClass
          )}
          {...props}
        >
          {content}
        </button>
      )}
      {actions && (
        <div className="absolute inset-y-1.5 right-1.5 flex items-center opacity-0 *:data-[slot=button]:size-5 *:data-[slot=button]:rounded-xs *:data-[slot=button]:hover:bg-foreground/10 group-focus-within/property-row:opacity-100 group-hover/property-row:opacity-100 has-aria-expanded:opacity-100 not-pointer-fine:opacity-100">
          {actions}
        </div>
      )}
    </div>
  )
}

export { PropertyRow, PropertySection }
