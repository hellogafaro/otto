"use client"

import { cn } from "cn"
import * as React from "react"

import { PageTitle } from "@workspace/ui/components/page-title"

// Otto: the main region, right of the sidebar. It has NO surface: it is the
// frame (`--sidebar`, the sidebar's own layer) with nothing wrapped around the
// page, so there is no seam, ring or shadow against the sidebar. A page is the
// column on it: ONE column of 768px (48rem) for every page (chat, lists,
// settings, empty states), centered in the free space, under a 52px header row
// that starts 8px from the top. Narrower than 768px + 2 x 20px the column
// fills the width, 20px from each side.
//
// Three tracks make it: [left gutter | column | right gutter]. The left gutter
// holds `FloatingNav` (portaled in by `PageHeader`); the right one holds the
// `aside` (the `Sidecar`). Closed, both gutters are equal and the column
// is centered. An open aside reserves its 324px (20px gap, 296px canvas, 8px from
// the window) in the right track: while the free space is wider than that the
// column stays centered, otherwise it shifts left to make room (never narrower
// than 768px: from 1280px of region width there is always room). Below 1280px
// of region width the aside overlays the page instead (on a card surface, since
// it floats over content) and below 768px it spans the width. Both gutters stay
// put while the center scrolls: only the column's body scrolls.
//
// The region is the `frame` container and the column is the `panel` container,
// so what is inside answers to the column's width, not the window's.
const NAV_GUTTER = 56

// Otto: the page inset, ONE constant. 16px, the padding of a row inside a
// card. The header row and every section header (title, description, action)
// take it, so their content lines up with the text in the cards below while
// their boxes still span the column. A card row's own `px-4` is the same value.
const PAGE_INSET = "px-4"

type PageFrameContextValue = {
  /** Where `PageHeader` portals its header row (column width, above the body). */
  header: HTMLElement | null
  /** Where `PageHeader` portals the floating navigation (the left gutter). */
  nav: HTMLElement | null
  /** The left gutter is wide enough (56px) for the floating navigation. */
  navFits: boolean
}

const PageFrameContext = React.createContext<PageFrameContextValue | null>(null)

/** The frame around a page, or null outside the shell (a demo, a test). */
function usePageFrame() {
  return React.useContext(PageFrameContext)
}

function PageFrame({
  aside,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  /** The sidecar; it places itself in the right track. */
  aside?: React.ReactNode
}) {
  const [header, setHeader] = React.useState<HTMLElement | null>(null)
  const [nav, setNav] = React.useState<HTMLElement | null>(null)
  const [navFits, setNavFits] = React.useState(false)

  React.useLayoutEffect(() => {
    if (!nav) return
    const measure = () =>
      setNavFits(nav.getBoundingClientRect().width >= NAV_GUTTER)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(nav)
    return () => observer.disconnect()
  }, [nav])

  const value = React.useMemo(
    () => ({ header, nav, navFits }),
    [header, nav, navFits]
  )

  return (
    <PageFrameContext.Provider value={value}>
      <div
        data-slot="page-frame"
        className={cn(
          "@container/frame relative h-full min-h-0 min-w-0 flex-1 overflow-hidden",
          className
        )}
        {...props}
      >
        {/* Electron: the whole top band, gutters included, drags the window. */}
        <div
          aria-hidden
          className="titlebar-drag-region absolute inset-x-0 top-0 h-15"
        />
        <div
          className={cn(
            "relative grid h-full grid-cols-[minmax(1.25rem,1fr)_minmax(0,48rem)_minmax(var(--aside,1.25rem),1fr)] grid-rows-[auto_minmax(0,1fr)] py-2",
            "transition-[grid-template-columns] duration-200 ease-out motion-reduce:transition-none",
            "@[1280px]/frame:has-[>[data-slot=sidecar][data-state=open]]:[--aside:20.25rem]"
          )}
        >
          <div
            data-slot="page-header-slot"
            ref={setHeader}
            className="relative col-start-2 row-start-1 min-w-0"
          />
          <div
            data-slot="floating-nav-slot"
            ref={setNav}
            className="relative z-10 col-start-1 row-start-2 flex items-start justify-end pr-2"
          />
          <div
            data-slot="page-body"
            className="@container/panel relative col-start-2 row-start-2 flex min-h-0 min-w-0 flex-col"
          >
            {children}
          </div>
          {aside}
        </div>
      </div>
    </PageFrameContext.Provider>
  )
}

// Otto: the 52px header row, on the frame above the column and as wide as it,
// so its left and right edges are the cards' edges, with its content inset
// (`PAGE_INSET`) to line up with the cards' content. From the left: a `leading`
// slot (the menu button below 768px, the back button on a drill-down page),
// the page title (`PageTitle`, 21px medium), a quiet trail of crumbs, and the
// page's actions on the right. Controls are 28px.
function PageHeaderRow({
  leading,
  title,
  crumbs,
  actions,
  className,
  ...props
}: Omit<React.ComponentProps<"header">, "title"> & {
  leading?: React.ReactNode
  title?: React.ReactNode
  /** The quiet trail after the title, e.g. `<PageCrumbs />`. */
  crumbs?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <header
      data-slot="page-header-row"
      className={cn(
        "flex h-13 items-center gap-1 select-none",
        PAGE_INSET,
        className
      )}
      {...props}
    >
      {leading}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <PageTitle className="min-w-0 truncate">{title}</PageTitle>
        {crumbs}
      </div>
      {actions && (
        <div
          data-slot="page-header-actions"
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
function PageCrumbs({
  crumbs,
  className,
  ...props
}: React.ComponentProps<"nav"> & { crumbs: Crumb[] }) {
  return (
    <nav
      data-slot="page-crumbs"
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
function PageScroll({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="page-scroll"
      className={cn(
        "no-scrollbar min-h-0 flex-1 scroll-fade-y overflow-y-auto",
        className
      )}
      {...props}
    />
  )
}

export {
  PAGE_INSET,
  PageCrumbs,
  PageFrame,
  PageHeaderRow,
  PageScroll,
  usePageFrame,
  type Crumb,
}
