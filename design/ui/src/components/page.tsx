import { PAGE_INSET, PageScroll } from "@workspace/ui/components/page-frame"
import { cn } from "cn"

// Otto: page anatomy. The page has no surface of its own: it is the frame, and
// the column on it (`PageFrame`, 768px) is the header row, then surfaces, as
// SIBLINGS. A surface (`PageCard`, `PageCenterpiece`) never contains another
// surface. Two kinds of page:
// - blocks (`PageColumn`): settings, lists, overviews. Stacked `PageSection`s
//   (a small title above its `PageCard`) 32px apart, scrolling as a whole.
// - a centerpiece (`PageCenterpiece`): long-form content read or written top to
//   bottom (the chat, a document). ONE card as wide as the column and as tall
//   as the space under the header row, scrolling inside. The chat adds a
//   sibling composer card under it.
// The first block (`data-content-start`) is where the sidecar starts:
// `PageFrame` measures it.
function PageColumn({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <PageScroll>
      <div
        data-slot="page-column"
        className={cn("flex w-full flex-col gap-8 pt-7 pb-8", className)}
        {...props}
      >
        {children}
      </div>
    </PageScroll>
  )
}

// Otto: the one big card of a centerpiece page: the `PageCard` surface, full
// column width, filling the height that is left. Its content scrolls inside
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

export { PageCard, PageCenterpiece, PageColumn, PageSection }
