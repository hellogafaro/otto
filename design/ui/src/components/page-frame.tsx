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
// holds `FloatingNav` (portaled in by `PageHeader`), centered on the header row's
// axis (its Back button, the title and the sidebar's mark share one line); the
// right one holds the `aside` (the `Sidecar`), which starts at the CONTENT START,
// the top of the first block under the header row (see `--content-start`).
// Closed, both gutters are equal and the column is centered. An open aside
// reserves its 324px (20px gap, 296px canvas, 8px from the window) in the right track: while the free space is wider than that the
// column stays centered, otherwise it shifts left to make room (never narrower
// than 768px: from 1280px of region width there is always room). Below 1280px
// of region width the aside overlays the page instead (on a card surface, since
// it floats over content) and below 768px it spans the width. Both gutters stay
// put while the center scrolls: only the column's body scrolls.
//
// The region is the `frame` container and the column is the `panel` container,
// so what is inside answers to the column's width, not the window's.
// The floating navigation's gutter: 20px from the window's sidebar side, the
// 32px buttons, then 20px to the column.
const NAV_GUTTER = 72

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

// Otto: the content start. The first block under the header row (`data-content-start`:
// a `PageSection`, `PageCard`, `PageCenterpiece`, or a page's own first block)
// begins this far below the body's top (28px on a blocks page, 0 on a
// centerpiece). The frame measures it, so the sidecar starts on the first block
// whatever the page puts first, and publishes it as `--content-start`.
function measureContentStart(body: HTMLElement) {
  const block = body.querySelector<HTMLElement>("[data-content-start]")
  if (!block) return 0
  let top = block.getBoundingClientRect().top - body.getBoundingClientRect().top
  // A scrolled page: count back to where the block sits unscrolled.
  for (let el = block.parentElement; el && el !== body; el = el.parentElement) {
    top += el.scrollTop
  }
  return Math.max(0, top)
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
  const [body, setBody] = React.useState<HTMLElement | null>(null)
  const [contentStart, setContentStart] = React.useState(0)

  React.useLayoutEffect(() => {
    if (!body) return
    let raf = 0
    const measure = () => setContentStart(measureContentStart(body))
    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    }
    measure()
    const mutations = new MutationObserver(schedule)
    mutations.observe(body, { childList: true, subtree: true })
    const resizes = new ResizeObserver(schedule)
    resizes.observe(body)
    return () => {
      cancelAnimationFrame(raf)
      mutations.disconnect()
      resizes.disconnect()
    }
  }, [body])

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
          style={
            { "--content-start": `${contentStart}px` } as React.CSSProperties
          }
        >
          <div
            data-slot="page-header-slot"
            ref={setHeader}
            className="relative col-start-2 row-start-1 min-w-0"
          />
          <div
            data-slot="floating-nav-slot"
            ref={setNav}
            // Spans the header row and the body: Back is centered on the header
            // row (52px, a 32px button: 10px down), 20px from the column.
            className="relative z-10 col-start-1 row-span-2 row-start-1 flex items-start justify-end pt-2.5 pr-5"
          />
          <div
            data-slot="page-body"
            ref={setBody}
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
// slot (only the menu button below 768px, the sidebar sheet's opener), the page
// title (`PageTitle`, 21px medium) and the page's actions on the right. The title
// is plain text on one line, never an ellipsis: it fades out over its last 16px,
// where the actions start (a mask, as the sidebar's rows do; a short title is
// untouched). It never has a dropdown, a back button or a trail of crumbs: going
// back and stepping through a list is `FloatingNav`. Controls are 28px.
function PageHeaderRow({
  leading,
  title,
  actions,
  className,
  ...props
}: Omit<React.ComponentProps<"header">, "title"> & {
  leading?: React.ReactNode
  title?: React.ReactNode
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
        <PageTitle className="min-w-0 flex-1 overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,#000_calc(100%_-_16px),transparent)]">
          {title}
        </PageTitle>
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

export { PAGE_INSET, PageFrame, PageHeaderRow, PageScroll, usePageFrame }
