"use client"

import { cn } from "cn"
import * as React from "react"

import { PageTitle } from "@workspace/ui/components/page-title"

// Otto: the main region, right of the sidebar. It has NO surface: it is the
// frame (`--sidebar`, the sidebar's own layer) with nothing wrapped around the
// page, so there is no seam, ring or shadow against the sidebar. A page is the
// column on it: ONE column of 768px (48rem) for every page (chat, lists,
// settings, empty states), centered in the free space. Narrower than 768px +
// 2 x 20px the column fills the width, 20px from each side.
//
// Nothing is pinned above a page: its title row is the first block of the
// column, 64px from the top, and scrolls away with it (`PageHeaderRow`;
// `PageColumn` gives it its slot). The open chat is the one exception: a
// compact pinned header (`PageHeaderRow density="compact"`, 80px) in the frame's header slot
// above its transcript (the row between two 24px gaps, not on the axis).
// Below 768px every other title row is on the axis (`--axis-y`, see globals.css),
// beside the sheet's menu button.
//
// Three tracks make it: [left gutter | column | right gutter]. The left gutter
// holds `FloatingNav` (portaled in by `PageHeader`), Back level with the title
// row (the transcript's first row on the chat); the right one mirrors it with
// the sidecar's toggle (the trailing slot, `SidecarToggle`). The `aside` (the
// `Sidecar`) floats: it is absolute, in the right gutter's area from the CONTENT
// START (the top of the first block, see `--content-start`). Closed, both
// gutters are equal and the column is centered. An open aside reserves
// `--sidecar-reserve` (320px: `--nav-gap` 16, `--sidecar-width` 296, 8px to the
// window) in the right track: while the gutter is wider the column stays
// centered, otherwise it shifts left (with the composer, which is in the
// column's track) to make room, never narrower than 768px. That needs 1160px of
// region width (72 + 768 + 320; a container query takes no variable, so the
// number is written out in `Sidecar` and here); below it the aside overlays the
// page instead (on a card surface, since it floats over content) and below
// 768px it spans the width. Both gutters stay put while the center scrolls:
// only the column's body scrolls, from the window's top edge (no strip above
// it) to 8px above its bottom.
//
// The region is the `frame` container and the column is the `panel` container,
// so what is inside answers to the column's width, not the window's.
// The floating navigation's gutter: 20px from the window's sidebar side, the
// 32px buttons, then 20px to the column.
const NAV_GUTTER = 72

// Otto: the frame's spacing tokens, ONE place to tweak and compare. The scale is
// the golden ratio from 8 (8, 13, 21, 34, 55; the type scale's 13, 16.5, 21 are the
// same steps). They are published on the frame's grid, so the header row, the nav
// slot and the chat's transcript (below it) all read them.
// - `--gr-*`: the scale.
// - roomy density: the title row and the pinned navigation sit 64px down
//   (`--nav-top-roomy`), the big page title (21px).
// - compact density (the chat's header): the header block is the 32px row between
//   two equal gaps (`--header-gap`, 24: above the row and below it), so the
//   transcript starts at `--header-compact` (80); the title is the section size
//   (16.5px) on the column's content edge (24px sides from 768px, as every page and
//   the composer). The navigation's top is the transcript's first row: 80 + the 16px
//   a turn row carries on top (the transcript's top fade covers it), `--nav-top-compact` 96.
// - the navigation is `--nav-gap` (16) from the column on every page, so its x never changes.
const FRAME_TOKENS = {
  "--gr-8": "0.5rem",
  "--gr-13": "0.8125rem",
  "--gr-21": "1.3125rem",
  "--gr-34": "2.125rem",
  "--gr-55": "3.4375rem",
  "--header-gap": "1.5rem",
  "--header-compact": "calc(2 * var(--header-gap) + 2rem)",
  "--nav-gap": "1rem",
  // Clear space between the floating composer bar and the content above it.
  "--composer-gap": "1.5rem",
  "--nav-top-roomy": "4rem",
  "--nav-top-compact": "calc(var(--header-compact) + 1rem)",
  // The sidecar's width and what an open one reserves right of the column: the
  // nav gap, its width, 8px to the window (16 + 296 + 8 = 320).
  "--sidecar-width": "18.5rem",
  "--sidecar-reserve": "calc(var(--nav-gap) + var(--sidecar-width) + 0.5rem)",
} as React.CSSProperties

// Otto: the page inset, ONE constant. 16px, the padding of a row inside a
// card. The title row and every section header (title, description, action)
// take it, so their content lines up with the text in the cards below while
// their boxes still span the column. A card row's own `px-4` is the same value.
const PAGE_INSET = "px-4"

type PageFrameContextValue = {
  /** Where the chat's pinned row goes (column width, above the body). */
  header: HTMLElement | null
  /** Where an in-content title row goes: the top of the page's `PageColumn`. */
  title: HTMLElement | null
  setTitle: (element: HTMLElement | null) => void
  /** Fixed over the column's top-left on the axis: the sheet's menu button below 768px. */
  leading: HTMLElement | null
  /** Where `PageHeader` portals the floating navigation (the left gutter). */
  nav: HTMLElement | null
  /** The left gutter is wide enough (72px) for the floating navigation. */
  navFits: boolean
  /** Where the sidecar's toggle goes: the right gutter, or over the column's top-right when it is narrow. */
  trailing: HTMLElement | null
}

// Otto: the content start. The first block (`data-content-start`:
// a `PageSection`, `PageCard`, `PageCenterpiece`, or a page's own first block)
// begins this far below the body's top (136px from 768px: the title row 64px
// down, 32px tall, then 40px; 0 under the chat's pinned row). The frame
// measures it, so the sidecar starts on the first block
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
  composer,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  /** The sidecar; it places itself in the right track. */
  aside?: React.ReactNode
  /** The shell's composer: the compact bar over the bottom of the column (outside its scroll), or the full composer under it. */
  composer?: React.ReactNode
}) {
  const [header, setHeader] = React.useState<HTMLElement | null>(null)
  const [title, setTitle] = React.useState<HTMLElement | null>(null)
  const [leading, setLeading] = React.useState<HTMLElement | null>(null)
  const [nav, setNav] = React.useState<HTMLElement | null>(null)
  const [trailing, setTrailing] = React.useState<HTMLElement | null>(null)
  const [navFits, setNavFits] = React.useState(false)
  const [body, setBody] = React.useState<HTMLElement | null>(null)
  const [contentStart, setContentStart] = React.useState(0)
  const [composerSlot, setComposerSlot] = React.useState<HTMLElement | null>(null)
  const [fullClearance, setFullClearance] = React.useState<number | null>(null)

  // Otto: the full composer (the chat, the new chat, the Inbox) is in the
  // layout: the column keeps the slot's measured height (the composer and its
  // gap below) free plus `--composer-gap` (24px) above it, frame by frame while it grows
  // or shrinks (`--composer-clearance`).
  // The compact bar floats over the page instead (the class below, 56px).
  React.useLayoutEffect(() => {
    if (!composerSlot) return
    const measure = () =>
      setFullClearance(
        composerSlot.querySelector("[data-slot=composer][data-variant=full]")
          ? composerSlot.offsetHeight
          : null
      )
    measure()
    const resizes = new ResizeObserver(measure)
    resizes.observe(composerSlot)
    const mutations = new MutationObserver(measure)
    mutations.observe(composerSlot, {
      subtree: true,
      childList: true,
      attributeFilter: ["data-variant"],
    })
    return () => {
      resizes.disconnect()
      mutations.disconnect()
    }
  }, [composerSlot])

  // Otto: toasts live outside the frame, so the composer's band (the slot's
  // height; 0 with no bar) is published on the root as `--composer-lift` and the
  // Toaster stands that much higher (never over the bar).
  React.useLayoutEffect(() => {
    if (!composerSlot) return
    const root = document.documentElement
    const publish = () =>
      root.style.setProperty("--composer-lift", `${composerSlot.offsetHeight}px`)
    publish()
    const resizes = new ResizeObserver(publish)
    resizes.observe(composerSlot)
    return () => {
      resizes.disconnect()
      root.style.removeProperty("--composer-lift")
    }
  }, [composerSlot])

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

  // Otto: the whole page area right of the sidebar scrolls the page. The scroll
  // region is only the column, so a wheel over the gutters (or the nav) is
  // forwarded to it. A NATIVE listener: React's bubbles through portals (a
  // popover would scroll the page). Not over the sidecar or the composer's text
  // (they scroll themselves), not a pinch (ctrl) nor a sideways swipe.
  const frameRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const onWheel = (event: WheelEvent) => {
      const target = event.target as Element
      const scroll = frame.querySelector<HTMLElement>(
        "[data-slot=page-body] [data-slot=page-scroll]"
      )
      if (
        !scroll ||
        event.ctrlKey ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY) ||
        scroll.contains(target) ||
        target.closest("[data-slot=sidecar]") ||
        target.closest("[data-slot=composer-input]")
      )
        return
      scroll.scrollBy({ top: event.deltaY })
    }
    frame.addEventListener("wheel", onWheel, { passive: true })
    return () => frame.removeEventListener("wheel", onWheel)
  }, [])

  const value = React.useMemo(
    () => ({ header, title, setTitle, leading, nav, navFits, trailing }),
    [header, title, leading, nav, navFits, trailing]
  )

  return (
    <PageFrameContext.Provider value={value}>
      <div
        ref={frameRef}
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
            // `--nav-top`: the ONE top of the pinned navigation (Back and the stacked Previous / Next),
            // from 768px, by the density of the page's header row: roomy 64px (level with its title
            // row), compact 96px (the transcript's first row). Its x never changes.
            "group/page relative grid [--nav-top:var(--nav-top-roomy)] has-[[data-slot=page-header-row][data-density=compact]]:[--nav-top:var(--nav-top-compact)] h-full grid-cols-[minmax(1.25rem,1fr)_minmax(0,48rem)_minmax(var(--aside,1.25rem),1fr)] grid-rows-[auto_minmax(0,1fr)] pb-2",
            "transition-[grid-template-columns] duration-200 ease-out motion-reduce:transition-none",
            "@[1160px]/frame:has-[>[data-slot=sidecar][data-state=open]]:[--aside:var(--sidecar-reserve)]",
            // While the composer bar shows, the column keeps its band free (see `PageColumn`).
            "has-[>[data-slot=page-composer-slot]:not(:empty)]:[--composer-clearance:calc(3rem+var(--composer-gap))]"
          )}
          style={
            {
              ...FRAME_TOKENS,
              "--content-start": `${contentStart}px`,
              ...(fullClearance === null
                ? {}
                : {
                    "--composer-clearance": `calc(${fullClearance}px + var(--composer-gap))`,
                  }),
            } as React.CSSProperties
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
            // Spans the whole height: the navigation is `--nav-gap` (16px) from the column (the same x on
            // EVERY detail page, the chat included), its top `--nav-top` by density, and it
            // stays put while the column scrolls.
            className="relative z-10 col-start-1 row-span-2 row-start-1 flex items-start justify-end pt-(--nav-top) pr-(--nav-gap)"
          />
          <div
            data-slot="page-body"
            ref={setBody}
            // Electron: the column is no drag region, so what scrolls under the
            // top band stays clickable (the gutters and the sidebar's header drag).
            className="titlebar-no-drag @container/panel relative col-start-2 row-start-2 flex min-h-0 min-w-0 flex-col"
          >
            {children}
          </div>
          <div
            data-slot="page-leading-slot"
            ref={setLeading}
            // Over the body's top-left, outside its scroll: a 32px button on the axis.
            className={cn(
              "pointer-events-none relative z-10 col-start-2 row-start-2 h-0 self-start pt-[calc(var(--axis-y)-1rem)] *:pointer-events-auto",
              PAGE_INSET
            )}
          />
          <div
            data-slot="page-trailing-slot"
            ref={setTrailing}
            // The sidecar's toggle, the floating navigation mirrored: from 912px
            // (a 72px right gutter) in the gutter, `--nav-gap` from the column,
            // its top `--nav-top`; narrower over the column's top-right, on the
            // title row's line (its end, 40px in from 768px; 16px in on the axis
            // below), and the title row clears it. It stays put while the column scrolls.
            className={cn(
              "pointer-events-none relative z-10 col-start-2 row-start-2 flex h-0 justify-end self-start pt-[calc(var(--axis-y)-1rem)] pr-4 *:pointer-events-auto md:pt-(--nav-top) md:pr-10",
              "@[912px]/frame:col-start-3 @[912px]/frame:row-span-2 @[912px]/frame:row-start-1 @[912px]/frame:justify-start @[912px]/frame:pr-0 @[912px]/frame:pl-(--nav-gap)"
            )}
          />
          <div
            data-slot="page-composer-slot"
            ref={setComposerSlot}
            // Otto: the composer's layer. Over the column's bottom, OUTSIDE its
            // scroll (a masked scroller stops the bar's backdrop blur), 8px above
            // the body's end (16px above the window's), centered on the column's
            // content (24px sides from 768px, the frame's 20px below). Only the
            // bar takes clicks. Above the page (`z-10`), under the overlaid
            // sidecar (`z-20`), the sheet, popovers and dialogs. Empty (no bar on
            // this page), it is nothing and the column keeps its own end. The
            // ONE place for every look (compact, expanded, full) and every
            // page, the chat included: the sides on the column's content edges
            // (24px in from 768px; the frame's 20px gutter below), 8px above
            // the body's end (16px above the window's). The slot's height
            // (composer + bottom gap) is published as `--composer-lift`.
            className="pointer-events-none relative z-10 col-start-2 row-start-2 flex min-w-0 justify-center self-end pb-2 *:pointer-events-auto empty:hidden md:px-6"
          >
            {composer}
          </div>
          {aside}
        </div>
      </div>
    </PageFrameContext.Provider>
  )
}

// Otto: a page's title row. From the left: a `leading` slot (the chat's menu
// button below 768px, the sidebar sheet's opener), the page title (`PageTitle`)
// and the page's actions on the right (28px controls). The title is plain text on
// one line, never an ellipsis: it fades out over its last 16px, where the
// actions start (a mask, as the sidebar's rows do; a short title is untouched).
// It never has a dropdown, a back button or a trail of crumbs: going back and
// stepping through a list is `FloatingNav`. ONE row, two densities (a prop, never
// a per-page class; the numbers are `FRAME_TOKENS`):
// - `roomy` (default): the first block of the page's column, inset 16px (to line
//   up with the cards' content), 32px tall, 64px from the top (below 768px its
//   center is the axis, beside the sheet's menu button), 40px above the first
//   block; the big page title (21px medium); it scrolls away with the page.
// - `compact` (the open chat): the row in the frame's header slot, pinned above
//   the transcript: 32px between two 24px gaps (the block ends 80px from the top,
//   where the transcript starts); the section title size (16.5px medium), on the
//   column's content edge (24px from 768px, the transcript's and composer's left).
function PageHeaderRow({
  leading,
  title,
  actions,
  density = "roomy",
  className,
  ...props
}: Omit<React.ComponentProps<"header">, "title"> & {
  leading?: React.ReactNode
  title?: React.ReactNode
  actions?: React.ReactNode
  density?: "roomy" | "compact"
}) {
  const compact = density === "compact"
  return (
    <header
      data-slot="page-header-row"
      data-density={density}
      className={cn(
        "flex items-center gap-1 select-none",
        compact
          ? "mt-(--header-gap) mb-(--header-gap) h-8 md:px-6"
          : "mt-[calc(var(--axis-y)-1rem)] h-8 md:mt-(--nav-top-roomy)",
        !compact && PAGE_INSET,
        // The sidecar's toggle is over the column's top-right on a narrow frame: clear it (16 + 32 + 8).
        !compact &&
          "group-has-[[data-slot=page-trailing-slot]:not(:empty)]/page:@max-[912px]/frame:pr-14",
        className
      )}
      {...props}
    >
      {leading}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <PageTitle
          className={cn(
            "min-w-0 flex-1 overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,#000_calc(100%_-_16px),transparent)]",
            compact && "text-base"
          )}
        >
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

// Otto: a scroll region (a blocks page's column, a centerpiece's content): the
// edge fade is the only sign (no scrollbar), like every scrolling area. The
// fade is scroll-driven, so at scroll 0 the top is not faded (the title is
// whole) and it shows only once the content has scrolled under the edge.
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
