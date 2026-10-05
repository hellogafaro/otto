import { ContentCardBody } from "@workspace/ui/components/content-card"
import { cn } from "cn"

// Otto: page anatomy. A page is the title in the `ContentCardHeader` (on the
// card, above everything) and ONE centered column of sections under it. Two
// surface levels only: the page card, then inner cards (`PageCard`); never a
// card in a card, a panel in a panel, or a wrapper, divider or border around a
// section. Sections are stacked 32px apart; the column is 768px (3xl) wide and
// 20px from the card's sides, so an inner card's 12px corners sit well inside
// the page card's 12px ones. A page that scrolls scrolls in the column's body,
// edge fade and no scrollbar.
function PageColumn({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <ContentCardBody>
      <div
        data-slot="page-column"
        className={cn(
          "mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 py-7",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </ContentCardBody>
  )
}

// Otto: a small section title (heading size, medium) with an optional one-line
// description, 12px above the section's card; `action` ends the title row.
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
      className={cn("space-y-3", className)}
      {...props}
    >
      <div className="flex items-start justify-between gap-4">
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

// Otto: the inner card: `bg-card`, the hairline ring, `shadow-xs`, 12px corners.
// Only rows live in it, split by full-bleed hairlines (`divide-y`, drawn between
// the children that exist, so a collapsed row leaves no line); controls nested
// in a row are 28px with 6px corners.
function PageCard({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="page-card"
      className={cn(
        "divide-y divide-foreground/10 overflow-hidden rounded-xl bg-card shadow-xs ring-1 ring-foreground/10",
        className
      )}
      {...props}
    />
  )
}

export { PageCard, PageColumn, PageSection }
