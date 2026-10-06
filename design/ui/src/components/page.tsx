import {
  PAGE_INSET,
  PageScroll,
  usePageFrame,
} from "@workspace/ui/components/page-frame"
import { cn } from "cn"

// Otto: page anatomy. The page has no surface of its own: it is the frame, and
// the column on it (`PageColumn`, in the frame's 768px track) holds the title
// row, then surfaces, as SIBLINGS. A surface (`PageCard`, `PageCenterpiece`)
// never contains another surface. Every page but the open chat takes this roomy
// column: from 768px 24px sides (content 720px), the title row 64px from the
// top (its own margin, see `PageHeaderRow`), 40px between blocks and, on a
// blocks page, 40px under the last one. Below 768px the title row stays on the
// top axis beside the sheet's menu button and the frame's 20px sides are the
// inset; the gaps stay 40px. Two kinds of page:
// - blocks (`PageColumn`): settings, lists, overviews, galleries. The title row
//   first, then stacked `PageSection`s (a small title above its `PageCard`) or a
//   page's own blocks, scrolling as a whole: nothing is pinned.
// - a centerpiece (`PageColumn fill` + `PageCenterpiece`): long-form content
//   read or written top to bottom (a task, a document, a file). The title row,
//   then ONE card as wide as the content and as tall as the space left (to the
//   frame's 8px bottom), scrolling inside.
// The open chat is the one exception and takes no `PageColumn`: its compact
// pinned row (`PageHeaderRow pinned`) sits in the frame's header slot and its
// centerpiece and composer span the whole 768px track.
// The column's first child is the title slot: `PageHeader`, called anywhere in
// the page, draws its row there, so the title scrolls with the content. It holds
// the title row and, on an item's page, its description (the lead line, 4px
// under the title): one block, so the gap comes after both. The first block
// (`data-content-start`) is where the sidecar starts: `PageFrame` measures it.
function PageColumn({
  fill = false,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  /** A centerpiece page: the column fills the height and does not scroll as a whole. */
  fill?: boolean
}) {
  const frame = usePageFrame()
  const column = (
    <div
      data-slot="page-column"
      className={cn(
        "flex w-full flex-col gap-10 md:px-6",
        fill ? "h-full min-h-0" : "pb-10",
        className
      )}
      {...props}
    >
      <div
        data-slot="page-title-slot"
        ref={frame?.setTitle}
        className="flex flex-col gap-1 empty:hidden"
      />
      {children}
    </div>
  )
  return fill ? column : <PageScroll>{column}</PageScroll>
}

// Otto: the one big card of a centerpiece page: the `PageCard` surface, as
// wide as the column's content, filling the height that is left. Its content scrolls inside
// (put a `PageScroll` or a scroll area in it); the edge fade is the only sign.
function PageCenterpiece({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="page-centerpiece"
      data-content-start=""
      className={cn(
        "relative flex min-h-0 flex-1 flex-col overflow-hidden card-surface rounded-xl bg-card",
        className
      )}
      {...props}
    />
  )
}

// Otto: a section title (`text-base`, 16.5px, medium: the golden step between
// body 13 and the page title 21) with an optional one-line body-size muted
// description, 12px above the section's card; `action` ends the title row. The
// row takes `PAGE_INSET` so title and action line up with the card's content.
function PageSection({
  title,
  description,
  action,
  danger,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"section">, "title"> & {
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  danger?: boolean
}) {
  return (
    <section
      data-slot="page-section"
      data-content-start=""
      className={cn("space-y-3", className)}
      {...props}
    >
      <div
        className={cn("flex items-start justify-between gap-4", PAGE_INSET)}
      >
        <div className="space-y-0.5">
          <h2
            className={cn(
              "text-base font-medium",
              danger && "text-destructive"
            )}
          >
            {title}
          </h2>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  )
}

// Otto: the inner card: `bg-card`, the card edge (`card-surface`), 12px corners.
// Only rows live in it, split by full-bleed hairlines (`divide-y`, drawn between
// the children that exist, so a collapsed row leaves no line); controls nested
// in a row are 28px with 6px corners.
function PageCard({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="page-card"
      data-content-start=""
      className={cn(
        "divide-y divide-(--card-divider) overflow-hidden card-surface rounded-xl bg-card",
        className
      )}
      {...props}
    />
  )
}

// Otto: the line-only wrapper of a DENSE list or table page (many small rows
// with small details: Chats, Tasks, Inbox), under its title row and filter
// chips, as Threads wraps its feed. The card edge's hairline (`--card-ring`),
// `2xl` 20 corners, NO fill (the frame shows through), no shadow, no padding:
// its rows and group headers run to the line, split by full-bleed hairlines
// between its children (`divide-y`, so no line doubles the box's own edge),
// and it clips them (`overflow-hidden`), so a fill at the first or last row
// follows the rounded corner. Pages of bigger cards and structured sections
// (settings, overviews, galleries, details) never use it: their cards sit on
// the frame. An empty state stays centered on the frame, outside it.
function PageWrap({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="page-wrap"
      data-content-start=""
      className={cn(
        "divide-y divide-(--card-divider) overflow-hidden rounded-2xl border border-(--card-ring)",
        className
      )}
      {...props}
    />
  )
}

export { PageCard, PageCenterpiece, PageColumn, PageSection, PageWrap }
