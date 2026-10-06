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

// Otto: the Details blocks of a sidecar (task, project, file, document). A
// section is a quiet title outside any surface and its rows under it; sections
// stack 20px apart (the sidebar's one gap), no dividers. The title is a 20px
// row, 12px medium muted, starting on the rows' slot line (4px in); its whole
// row folds the section (Enter or Space): the title, its `Count` (not drawn
// for 0), then a 14px chevron, right when folded and down when open, shown on
// hover, focus or while folded (always on touch). Rows start 4px under it and
// sit 2px apart, like the sidebar's. A section with no rows is not drawn.
function PropertySection({
  title,
  count,
  defaultOpen = true,
  className,
  children,
}: {
  title: React.ReactNode
  /** Shown after the title; 0 is not drawn. */
  count?: number
  defaultOpen?: boolean
  className?: string
  children?: React.ReactNode
}) {
  if (React.Children.toArray(children).length === 0) return null
  return (
    <Collapsible
      data-slot="property-section"
      defaultOpen={defaultOpen}
      className={cn("not-first:mt-5", className)}
    >
      <CollapsibleTrigger className="group/property-section flex h-5 w-full items-center gap-2 rounded-xs px-1 text-left text-xs font-medium text-muted-foreground outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
        <span className="min-w-0 truncate">{title}</span>
        {!!count && <Count>{count}</Count>}
        <ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-data-panel-open/property-section:rotate-90 group-data-panel-open/property-section:opacity-0 group-hover/property-section:opacity-100! group-focus-visible/property-section:opacity-100! not-pointer-fine:opacity-100! motion-reduce:transition-none" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 flex flex-col gap-0.5">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

// Otto: one property: a 28px row with `sm` 6 corners as wide as the sidecar.
// Even insets (DESIGN Layout): the 20px `icon` slot 4px in (a 14px glyph
// centered, a 20px avatar fills it), 8px, the `label` (muted, a 96px column so
// the values line up), then the `value` (foreground, truncated; `placeholder`
// in muted when there is none). A row with only a `value` is a list item (a
// link, a chat, a time entry: foreground, full width); one with only a `label`
// is the "New …" row that ends a list (muted, full width). An optional `kbd` (the row's hotkey, the
// 20px `Kbd` 4px from the end, shown on hover, focus or while open; never on
// touch). As a button (the default) it opens its menu or popover: pass it as
// the trigger's `render`. The ghost states: hover `foreground/5`, pressed and
// open (`aria-expanded`) `/10`, the inset focus ring, disabled 50%. `readOnly`
// draws plain text with no states. `actions` (an `icon-xs` ghost Button, such
// as Remove, drawn here at 20px with `xs` 4 corners and a `foreground/10`
// hover that stacks on the row's) sit 4px inside the end, shown on hover or
// focus (always on touch); hovering one keeps the row highlighted.
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
      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-3.5">
        {icon}
      </span>
      {label !== undefined && (
        <span
          className={cn(
            "truncate text-muted-foreground",
            hasValue ? "w-24 shrink-0" : "min-w-0 flex-1"
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
    "flex h-7 w-full items-center gap-2 rounded-sm px-1 text-left text-sm text-foreground",
    actions && "pr-7",
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
        <div className="absolute inset-y-1 right-1 flex items-center opacity-0 *:data-[slot=button]:size-5 *:data-[slot=button]:rounded-xs *:data-[slot=button]:hover:bg-foreground/10 group-focus-within/property-row:opacity-100 group-hover/property-row:opacity-100 has-aria-expanded:opacity-100 not-pointer-fine:opacity-100">
          {actions}
        </div>
      )}
    </div>
  )
}

export { PropertyRow, PropertySection }
