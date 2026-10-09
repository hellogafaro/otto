import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cn } from "cn"

import {
  ContextMenu,
  ContextMenuTrigger,
} from "@workspace/ui/components/context-menu"
import { Skeleton } from "@workspace/ui/components/skeleton"

// Otto: the gallery (Projects, Library, a project's Documents and Files tabs):
// not cards, but tiles with the title UNDER them. Columns sit 12px apart and
// rows 20px, so a title stays with its tile. Columns follow the page column's
// width (`@container/panel`): `columns={3}` (projects) is one,
// two from 400px, three from 640px; `columns={4}` (documents, files) two, three
// from 400px, four from 640px.
function Gallery({
  columns,
  className,
  ...props
}: React.ComponentProps<"ul"> & { columns: 3 | 4 }) {
  return (
    <ul
      data-slot="gallery"
      className={cn(
        "grid gap-x-3 gap-y-5",
        columns === 3
          ? "grid-cols-1 @[25rem]/panel:grid-cols-2 @[40rem]/panel:grid-cols-3"
          : "grid-cols-2 @[25rem]/panel:grid-cols-3 @[40rem]/panel:grid-cols-4",
        className
      )}
      {...props}
    />
  )
}

const RATIO = {
  "16:9": "aspect-video",
  "4:5": "aspect-[4/5]",
  "1:1": "aspect-square",
} as const

type GalleryRatio = keyof typeof RATIO

// Otto: the tile, `md` 8 corners, `bg-card` (one layer step over the frame;
// DESIGN token `gallery-tile`), its hairline an inset `foreground/10` ring on a
// pseudo-element over the content, so a scroller never clips it and a cover
// would not hide it. Hover, the open right-click menu and `current` darken
// it to `/20` (the gallery's only hover look: no fill, no lift); keyboard focus
// draws the 2px inset `--ring` on the tile. A tile never changes size.
const tileClass =
  "relative flex w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-md bg-card text-muted-foreground after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:ring-1 after:ring-foreground/10 after:ring-inset after:transition-shadow motion-reduce:after:transition-none"

// Otto: one tile and its title. The whole item (tile and title) is the link or
// button (`render`). In the tile: `media`, a glyph centered in
// the 32px `md` `bg-muted` icon tile (16px), with an optional `label` 8px under
// it (12px medium muted: a file's type, "PDF"); `badge`, a static `Badge` 8px
// inside the tile's top-start corner (an agent's "Default"); `cover`, a picture
// (or its skeleton) filling the tile, under the ring and over the media. Under the tile, 8px down: the
// 14px muted `icon`, 8px, the title (13px medium, truncated). `menu` is the
// item's menu (a `ContextMenuContent`): right-click, a long press on touch,
// the menu key by keyboard. A tile never carries a ⋯ button or any hover icon.
// `disabled` (a pending item) dims it to 60% and takes no pointer or focus.
// `muted` (an archived item) reads its title in `muted-foreground`; it stays
// clickable.
function GalleryItem({
  title,
  icon,
  media,
  cover,
  label,
  badge,
  ratio = "4:5",
  menu,
  current = false,
  disabled = false,
  muted = false,
  render,
  className,
  ...props
}: Omit<useRender.ComponentProps<"button">, "title"> &
  Omit<React.ComponentProps<"button">, "title"> & {
    title: React.ReactNode
    /** The 14px icon before the title. */
    icon?: React.ReactNode
    /** The glyph centered in the tile, drawn in a 32px icon tile. */
    media?: React.ReactNode
    /** A picture filling the tile (an image's thumbnail, or its skeleton while it loads); it hides the media. */
    cover?: React.ReactNode
    /** A short caption under the media (a file's type). */
    label?: React.ReactNode
    /** A static `Badge` 8px inside the tile's top-start corner (the default agent's "Default"). */
    badge?: React.ReactNode
    ratio?: GalleryRatio
    /** The item's menu (right-click, long press): a `ContextMenuContent`. */
    menu?: React.ReactNode
    /** The item that is open (keeps the hover look). */
    current?: boolean
    /** Pending or unavailable: 60%, no pointer, no focus. */
    disabled?: boolean
    /** Archived: the title in `muted-foreground`, still a link. */
    muted?: boolean
  }) {
  const item = useRender({
    defaultTagName: "button",
    render,
    props: mergeProps<"button">(
      {
        ...(render ? {} : { type: "button" as const }),
        "aria-current": current ? "page" : undefined,
        "aria-disabled": disabled || undefined,
        tabIndex: disabled ? -1 : undefined,
        className: cn(
          "group/gallery-link flex w-full flex-col gap-2 text-left outline-none select-none",
          className
        ),
        children: (
          <>
            <div
              data-slot="gallery-tile"
              className={cn(
                tileClass,
                RATIO[ratio],
                "group-hover/gallery-item:after:ring-foreground/20 group-data-popup-open/gallery-item:after:ring-foreground/20 group-focus-visible/gallery-link:after:ring-2 group-focus-visible/gallery-link:after:ring-ring",
                current && "after:ring-foreground/20"
              )}
            >
              {media && (
                <span className="flex size-8 items-center justify-center rounded-md bg-muted [&>svg]:size-4">
                  {media}
                </span>
              )}
              {label && (
                <span className="max-w-full truncate px-3 text-xs font-medium">
                  {label}
                </span>
              )}
              {cover && <span className="absolute inset-0">{cover}</span>}
              {badge && (
                <span className="absolute top-2 left-2 flex">{badge}</span>
              )}
            </div>
            <span
              className={cn(
                "flex h-5 min-w-0 items-center gap-2 px-4 text-sm font-medium",
                muted ? "text-muted-foreground" : "text-foreground"
              )}
            >
              {icon && (
                <span className="flex shrink-0 text-muted-foreground [&>svg]:size-3.5">
                  {icon}
                </span>
              )}
              <span className="truncate">{title}</span>
            </span>
          </>
        ),
      },
      props
    ),
  })

  const itemClass = cn(
    "group/gallery-item relative",
    disabled && "pointer-events-none opacity-60"
  )

  if (!menu)
    return (
      <li data-slot="gallery-item" className={itemClass}>
        {item}
      </li>
    )
  return (
    <ContextMenu>
      <ContextMenuTrigger
        data-slot="gallery-item"
        className={itemClass}
        render={<li />}
      >
        {item}
      </ContextMenuTrigger>
      {menu}
    </ContextMenu>
  )
}

// Otto: a loading item, the same box: the tile as a `Skeleton` with the tile's
// `md` corners (it is as big as the tile, so `xs` would read sharp) and a
// title line, 14px tall in its 20px row, at `xs`.
function GalleryItemSkeleton({ ratio = "4:5" }: { ratio?: GalleryRatio }) {
  return (
    <li data-slot="gallery-item-skeleton" className="flex flex-col gap-2">
      <Skeleton className={cn("w-full rounded-md", RATIO[ratio])} />
      <span className="flex h-5 items-center px-4">
        <Skeleton className="h-3.5 w-2/3" />
      </span>
    </li>
  )
}

export { Gallery, GalleryItem, GalleryItemSkeleton, type GalleryRatio }
