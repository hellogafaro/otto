import { ChevronRightIcon } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { Count } from "@workspace/ui/components/count"
import { PAGE_INSET } from "@workspace/ui/components/page-frame"
import { cn } from "cn"

// Otto: the grouped list (Otto v1's table, Linear's and Codex's pattern) for
// collections you work through: Chats, Tasks, Routines. The groups sit in ONE
// content-sized card (`PageCard`: it grows with its rows and never stretches
// to the page's bottom; the page scrolls), as wide as the column. Inside it
// nothing is a surface: group headers and rows are full-bleed rows, clipped by
// the card's corners, split by hairlines only between a group's header and its
// rows and between groups (the card's own `divide-y`).
//
// Proportions (DESIGN.md, Data patterns): body text 13px on a 20px line; a
// row is 44px (20 + 12 + 12), a group header 36px (20 + 8 + 8), a metadata
// badge 24px (16 + 4 + 4): the padding steps down the 12 · 8 · 4 of the golden
// ladder.
//
// ONE column grid for headers and rows, so icons and text line up: both take
// `PAGE_INSET` (16px, the page title's line), then a 14px icon column (the
// group's icon, the row's status icon or avatar) ON that line, 8px, then the
// text (the group's name, the row's title) at 38px.

// A 14px column: a status icon, an avatar, a glyph; centered, so 16px ones fit.
function ListSlot({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "flex w-3.5 shrink-0 items-center justify-center [&>svg:not([class*='size-'])]:size-3.5",
        className
      )}
      {...props}
    />
  )
}

// Otto: a group: a 36px full-bleed header row on a `foreground` 5% fill whose
// whole row toggles the group (Enter or Space too): the group's icon, its name
// (medium), its `Count`, then a muted chevron that points right when folded and
// down when open. `action` (a 24px ghost icon button, such as Linear's "+")
// sits 6px inside the row's end, shown on hover or focus (always on touch).
// A hairline splits the header from its rows. Empty groups render nothing.
function ListGroup({
  icon,
  label,
  count,
  defaultOpen = true,
  action,
  className,
  children,
}: {
  /** The group's 14px icon (a status icon, a Lucide icon). */
  icon?: React.ReactNode
  label: React.ReactNode
  count: number
  defaultOpen?: boolean
  /** One 24px ghost icon button at the header's end. */
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  if (count === 0) return null
  return (
    <Collapsible
      data-slot="list-group"
      defaultOpen={defaultOpen}
      className={className}
    >
      <div className="group/band relative">
        <CollapsibleTrigger
          className={cn(
            "group/trigger flex h-9 w-full items-center gap-2 bg-foreground/5 text-left text-sm font-medium text-foreground outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            PAGE_INSET,
            action && "pr-10"
          )}
        >
          <ListSlot>{icon}</ListSlot>
          <span className="min-w-0 truncate">{label}</span>
          <Count>{count}</Count>
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover/trigger:text-foreground group-data-panel-open/trigger:rotate-90 motion-reduce:transition-none" />
        </CollapsibleTrigger>
        {action && (
          <div className="absolute inset-y-0 right-1.5 flex items-center opacity-0 group-focus-within/band:opacity-100 group-hover/band:opacity-100 has-aria-expanded:opacity-100 not-pointer-fine:opacity-100">
            {action}
          </div>
        )}
      </div>
      <CollapsibleContent>
        <ul className="flex flex-col border-t border-(--card-divider)">
          {children}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

// Otto: a row: 44px, full-bleed, the whole row opens its item. On the
// header's grid: the 14px `media` (status icon or avatar) on the 16px line,
// then the title (13px, truncated; `muted` reads it at 80% for an item that
// needs nothing from you, such as a read chat) and its `marks` (small glyphs
// right after it: unread, flagged, working). At the end: `meta`, metadata
// badges 6px apart (hidden in a column under 448px), then `end`, a muted
// 12px tabular date in a 40px right-aligned column so the badges line up.
// States are the ghost ones, edge to edge: hover `foreground` 5%, current
// (`active`) and pressed 10%, an inset focus ring. `actions` (a 28px ⋯) covers
// the date on hover, focus or while its menu is open (always on touch), 8px
// from the row's top, bottom and end, and keeps the row highlighted while open.
function ListRow({
  media,
  title,
  marks,
  meta,
  end,
  actions,
  active,
  muted,
  className,
  ...props
}: Omit<React.ComponentProps<"button">, "title" | "children"> & {
  media?: React.ReactNode
  title: React.ReactNode
  marks?: React.ReactNode
  meta?: React.ReactNode
  end?: React.ReactNode
  actions?: React.ReactNode
  active?: boolean
  muted?: boolean
}) {
  return (
    <li data-slot="list-row" className="group/row relative">
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-11 w-full items-center gap-2 text-left text-sm text-foreground transition-colors outline-none select-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-foreground/10 disabled:pointer-events-none disabled:opacity-50 aria-[current=page]:bg-foreground/10 group-has-aria-expanded/row:bg-foreground/5",
          PAGE_INSET,
          className
        )}
        {...props}
      >
        <ListSlot>{media}</ListSlot>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className={cn("truncate", muted && "text-foreground/80")}>
            {title}
          </span>
          {marks}
        </span>
        {meta && (
          <span className="flex shrink-0 items-center gap-1.5 @max-md/panel:hidden">
            {meta}
          </span>
        )}
        {end && (
          <span
            className={cn(
              "min-w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums",
              actions &&
                "group-focus-within/row:invisible group-hover/row:invisible group-has-aria-expanded/row:invisible not-pointer-fine:invisible"
            )}
          >
            {end}
          </span>
        )}
      </button>
      {actions && (
        <div className="absolute inset-y-0 right-2 flex items-center opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 has-aria-expanded:opacity-100 not-pointer-fine:opacity-100">
          {actions}
        </div>
      )}
    </li>
  )
}

export { ListGroup, ListRow }
