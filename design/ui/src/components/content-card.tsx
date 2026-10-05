import { cn } from "cn"

// Otto: THE main card, the one surface every page lives on. It sits on the
// frame (`--sidebar`) beside the sidebar: `bg-background`, a 1px
// `ring-foreground/10` hairline and `shadow-xs`, 12px corners, 8px from the top,
// right and bottom and flush against the sidebar's own 8px gutter. Content is
// clipped to the corners. Full bleed (no inset, ring or corners) below 768px,
// where the sidebar is a sheet. It is the `panel` container, so its children
// respond to the card's width (not the window's). A `FloatingCard` opens to its right and the
// card shrinks to make room.
function ContentCard({ className, ...props }: React.ComponentProps<"main">) {
  return (
    <main
      data-slot="content-card"
      className={cn(
        "@container/panel relative flex min-h-0 min-w-0 flex-1 flex-col bg-background md:m-2 md:ml-0 md:overflow-hidden md:rounded-xl md:shadow-xs md:ring-1 md:ring-foreground/10",
        className
      )}
      {...props}
    />
  )
}

// Otto: the 44px in-card header. From the left: a `leading` slot (the menu
// button below 768px, the back button on a drill-down page), the title (heading
// size, medium, 16px from the card's edge when nothing leads), a quiet trail of
// crumbs, and the page's actions on the right. Controls are 28px, 8px from every
// edge, so their 6px corners sit inside the card's 12px (12 - 8 + ...).
function ContentCardHeader({
  leading,
  title,
  crumbs,
  actions,
  className,
  ...props
}: Omit<React.ComponentProps<"header">, "title"> & {
  leading?: React.ReactNode
  title?: React.ReactNode
  /** The quiet trail after the title, e.g. `<ContentCardCrumbs />`. */
  crumbs?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <header
      data-slot="content-card-header"
      className={cn(
        "flex h-11 shrink-0 items-center gap-1 px-2 select-none",
        className
      )}
      {...props}
    >
      {leading}
      <div
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2",
          !leading && "pl-2"
        )}
      >
        <h1
          data-slot="content-card-title"
          className="min-w-0 truncate text-base leading-6 font-medium"
        >
          {title}
        </h1>
        {crumbs}
      </div>
      {actions && (
        <div
          data-slot="content-card-actions"
          className="flex shrink-0 items-center gap-1"
        >
          {actions}
        </div>
      )}
    </header>
  )
}

type Crumb = { label: string; onClick?: () => void }

// Otto: a muted trail of the pages above this one, nearest first, each a link
// to its page, divided by a slash. 13px, muted, foreground on hover.
function ContentCardCrumbs({
  crumbs,
  className,
  ...props
}: React.ComponentProps<"nav"> & { crumbs: Crumb[] }) {
  return (
    <nav
      data-slot="content-card-crumbs"
      className={cn(
        "flex min-w-0 items-center text-sm text-muted-foreground",
        className
      )}
      {...props}
    >
      {crumbs.map((crumb) => (
        <span key={crumb.label} className="flex min-w-0 items-center">
          <span aria-hidden className="mx-1.5">
            /
          </span>
          {crumb.onClick ? (
            <button
              type="button"
              onClick={crumb.onClick}
              className="truncate rounded-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              {crumb.label}
            </button>
          ) : (
            <span className="truncate">{crumb.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

// Otto: the scroll region under the header for pages that scroll as a whole:
// the edge fade is the only sign (no scrollbar), like every scrolling area.
function ContentCardBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="content-card-body"
      className={cn(
        "no-scrollbar min-h-0 flex-1 scroll-fade-y overflow-y-auto",
        className
      )}
      {...props}
    />
  )
}

export {
  ContentCard,
  ContentCardBody,
  ContentCardCrumbs,
  ContentCardHeader,
  type Crumb,
}
