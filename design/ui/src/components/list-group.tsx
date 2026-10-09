import { ChevronRightIcon } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { ContextMenu, ContextMenuTrigger } from "@workspace/ui/components/context-menu"
import { Count } from "@workspace/ui/components/count"
import { PageCard } from "@workspace/ui/components/page"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "cn"

// Otto: collection lists are plain surfaces within the enclosing page panel.
// Group labels, collapse, row menus, hover and keyboard behavior are unchanged.
// Bands own a 16px leading inset. Standalone card lists keep their existing
// 8px wrapper plus 8px row inset; plain ListCard rows own the full 16px.
function ListCard({ className, ...props }: React.ComponentProps<"div">) {
  return <PageCard surface={false} data-slot="list-card" className={cn("divide-y-0", className)} {...props} />
}

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

// Otto: a group: a 36px rounded band (`md` 8) on a `foreground` 5% fill (10%
// on hover), laid over with `tint` (the group's status color) at 5% when it has
// one; the whole band toggles the group (Enter or Space too). Left to right: a
// muted chevron (down when open, right when folded), the group's icon, its name
// (medium) and its `Count`; the label never hosts a creation action.
// Empty groups render nothing.
function ListGroup({
  icon,
  label,
  count,
  tint,
  defaultOpen = true,
  className,
  children,
}: {
  /** The group's 14px icon (a status icon, a Lucide icon). */
  icon?: React.ReactNode
  label: React.ReactNode
  count: number
  /** The group's status color (any CSS color); none keeps the band neutral. */
  tint?: string
  defaultOpen?: boolean
  className?: string
  children: React.ReactNode
}) {
  if (count === 0) return null
  return (
    <Collapsible
      data-slot="list-group"
      defaultOpen={defaultOpen}
      className={cn("not-first:mt-2", className)}
    >
      <div className="group/band relative">
        <CollapsibleTrigger
          style={tint ? ({ "--list-tint": tint } as React.CSSProperties) : undefined}
          className={cn(
            "group/trigger flex h-9 w-full items-center gap-2 rounded-md bg-foreground/5 px-4 text-left text-sm font-medium text-foreground transition-colors outline-none select-none hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            tint &&
              "bg-[linear-gradient(color-mix(in_oklab,var(--list-tint)_5%,transparent),color-mix(in_oklab,var(--list-tint)_5%,transparent))]"
          )}
        >
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover/trigger:text-foreground group-data-panel-open/trigger:rotate-90 motion-reduce:transition-none" />
          <ListSlot>{icon}</ListSlot>
          <span className="min-w-0 truncate">{label}</span>
          <Count>{count}</Count>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <ul className="flex flex-col pt-1">{children}</ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

// Otto: a row: 44px, rounded (`md` 8), plain on the card, 8px in; the whole
// row opens its item. In a `ListGroup` it is on the band's grid: an empty 14px
// column under the chevron, the 14px `media` (status icon or avatar) under the
// group's icon, then the title at 52px. Outside a group (a flat list such as
// Notifications) `media` leads, on the band's chevron column. The title is 13px, truncated (`muted` reads
// it at 80% for an item that needs nothing from you, such as a read chat), with
// its `marks` (small glyphs right after it: unread, flagged, working). At the
// end: `meta`, metadata badges 6px apart (hidden in a column under 448px), then
// `end`, a muted 12px tabular date in a 40px right-aligned column (kept when
// empty) so the badges line up. States are the ghost ones: hover `foreground`
// 5%, current (`active`) and pressed 10%, an inset focus ring (keyboard only).
// A row never carries a ⋯ button: `menu` is the item's right-click menu (a
// `ContextMenuContent`; a long press on touch, the menu key by keyboard), and
// the row stays highlighted while it is open. `menuProps` takes over the
// menu's open state (a phone's drawer opens on the long press instead).
// `size="sm"` is the compact variant for a list inside a popover (the
// composer's Notifications list): 32px, the same slots and states.
function ListRow({
  media,
  title,
  marks,
  meta,
  end,
  menu,
  menuProps,
  active,
  muted,
  size = "default",
  className,
  ...props
}: Omit<React.ComponentProps<"button">, "title" | "children"> & {
  size?: "default" | "sm"
  media?: React.ReactNode
  title: React.ReactNode
  marks?: React.ReactNode
  meta?: React.ReactNode
  end?: React.ReactNode
  /** The right-click menu: a `ContextMenuContent`. */
  menu?: React.ReactNode
  /** Controls the menu's open state (a long press that opens a drawer instead). */
  menuProps?: Pick<React.ComponentProps<typeof ContextMenu>, "open" | "onOpenChange">
  active?: boolean
  muted?: boolean
}) {
  const row = (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-2 text-left text-sm text-foreground transition-colors outline-none select-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-foreground/10 disabled:pointer-events-none disabled:opacity-50 aria-[current=page]:bg-foreground/10 group-data-popup-open/row:bg-foreground/5 rounded-md px-2 in-data-[slot=list-card]:px-4",
        size === "sm" ? "h-8" : "h-11",
        className
      )}
      {...props}
    >
      {/* Otto: the column under the band's chevron, in a group only. */}
      <span className="hidden w-3.5 shrink-0 in-data-[slot=list-group]:block" />
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
      <span className="min-w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
        {end}
      </span>
    </button>
  )
  if (!menu && !menuProps)
    return (
      <li data-slot="list-row" className="group/row relative">
        {row}
      </li>
    )
  return (
    <ContextMenu {...menuProps}>
      <ContextMenuTrigger
        data-slot="list-row"
        className="group/row relative"
        render={<li />}
      >
        {row}
      </ContextMenuTrigger>
      {menu}
    </ContextMenu>
  )
}

// Otto: a loading row: a row's 44px and grid (the 14px media, then a title
// bar), so a loading list is the list's shape inside its `ListCard`. Its bars
// are `foreground` 10%, the selected row's fill, which reads on the card and
// on the wallpaper's glass alike.
function ListRowSkeleton() {
  return (
    <li
      data-slot="list-row-skeleton"
      className="flex h-11 items-center gap-2 px-2"
    >
      <Skeleton className="size-3.5 rounded-full bg-foreground/10" />
      <Skeleton className="h-3.5 w-1/3 bg-foreground/10" />
    </li>
  )
}

export { ListCard, ListGroup, ListRow, ListRowSkeleton }
