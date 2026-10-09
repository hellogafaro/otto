"use client"

import { cn } from "cn"
import * as React from "react"
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from "react-resizable-panels"
import { useIsMobile } from "@workspace/ui/hooks/use-mobile"

import { PageTitle } from "@workspace/ui/components/page-title"

// Otto: one rounded panel contains the page, composer and optional resizable details.
// Controls sit directly at the upper corners without a separate topbar. The
// content keeps its 768px column; narrow screens split details below it.
const FRAME_TOKENS = {
  "--gr-8": "0.5rem",
  "--gr-13": "0.8125rem",
  "--gr-21": "1.3125rem",
  "--gr-34": "2.125rem",
  "--gr-55": "3.4375rem",
  "--header-gap": "1.5rem",
  "--header-compact": "calc(2 * var(--header-gap) + 2rem)",
  // Clear space between the floating composer bar and the content above it.
  "--composer-gap": "1.5rem",
  "--nav-top-roomy": "4rem",
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
  /** Upper-left controls: the mobile menu and parent-route Back. */
  leading: HTMLElement | null
  /** Upper-right controls, including item navigation and the details toggle. */
  trailing: HTMLElement | null
}

const PageFrameContext = React.createContext<PageFrameContextValue | null>(null)

/** The frame around a page, or null outside the shell (a demo, a test). */
function usePageFrame() {
  return React.useContext(PageFrameContext)
}

function PageFrame({
  aside,
  asideOpen = false,
  onAsideOpenChange,
  background,
  composer,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  /** Optional details, kept inside the panel's resizable split. */
  aside?: React.ReactNode
  asideOpen?: boolean
  onAsideOpenChange?: (open: boolean) => void
  background?: React.ReactNode
  /** The shell's full composer at the bottom of the column, outside its scroll. */
  composer?: React.ReactNode
}) {
  const [header, setHeader] = React.useState<HTMLElement | null>(null)
  const [title, setTitle] = React.useState<HTMLElement | null>(null)
  const [leading, setLeading] = React.useState<HTMLElement | null>(null)
  const [trailing, setTrailing] = React.useState<HTMLElement | null>(null)
  const [composerSlot, setComposerSlot] = React.useState<HTMLElement | null>(null)
  const [composerHeight, setComposerHeight] = React.useState(0)
  const isMobile = useIsMobile()
  const asidePanel = React.useRef<ImperativePanelHandle>(null)
  React.useLayoutEffect(() => {
    if (asideOpen) asidePanel.current?.expand()
    else asidePanel.current?.collapse()
  }, [asideOpen])

  // Otto: the composer is in the
  // layout: the column keeps the slot's measured height (the composer and its
  // gap below) free plus `--composer-gap` (24px) above it, frame by frame while it grows
  // or shrinks (`--composer-clearance`).
  React.useLayoutEffect(() => {
    if (!composerSlot) return
    const measure = () =>
      setComposerHeight(
        composerSlot.querySelector("[data-slot=composer]")
          ? composerSlot.offsetHeight
          : 0
      )
    measure()
    const resizes = new ResizeObserver(measure)
    resizes.observe(composerSlot)
    const mutations = new MutationObserver(measure)
    mutations.observe(composerSlot, {
      subtree: true,
      childList: true,
    })
    return () => {
      resizes.disconnect()
      mutations.disconnect()
    }
  }, [composerSlot])

  // Otto: desktop toasts share the shell's bottom edge while they fit beside
  // the composer. A narrow pane lifts them above its actual position, including
  // stacked details, instead of counting only the composer's own height.
  React.useLayoutEffect(() => {
    if (!composerSlot) return
    const root = document.documentElement
    const toaster = document.querySelector<HTMLElement>('[data-sonner-toaster]')
    const publish = () => {
      const composer = composerSlot.querySelector('[data-slot="composer"]')
      const lift = composer ? Math.max(0, window.innerHeight - composerSlot.getBoundingClientRect().top) : 0
      const composerBounds = composer?.getBoundingClientRect()
      const toastBounds = toaster?.getBoundingClientRect()
      const overlaps = composerBounds && toastBounds && toastBounds.left < composerBounds.right && toastBounds.right > composerBounds.left
      root.style.setProperty('--composer-lift', `${lift}px`)
      root.style.setProperty('--toast-clearance', `${isMobile || overlaps ? lift : 0}px`)
    }
    publish()
    const resizes = new ResizeObserver(publish)
    resizes.observe(composerSlot)
    const pane = composerSlot.closest('[data-panel-id="page-content"]')
    if (pane) resizes.observe(pane)
    if (toaster) resizes.observe(toaster)
    window.addEventListener('resize', publish)
    return () => {
      resizes.disconnect()
      window.removeEventListener('resize', publish)
      root.style.removeProperty("--composer-lift")
      root.style.removeProperty('--toast-clearance')
    }
  }, [composerSlot, isMobile])

  const frameRef = React.useRef<HTMLDivElement>(null)

  const value = React.useMemo(
    () => ({ header, title, setTitle, leading, trailing }),
    [header, title, leading, trailing]
  )

  return (
    <PageFrameContext.Provider value={value}>
      <div
        ref={frameRef}
        data-slot="page-frame"
        className={cn(
          "relative h-full min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-background",
          className
        )}
        {...props}
      >
        {background}
        {/* Electron: the whole top band, gutters included, drags the window. */}
        <div
          aria-hidden
          className="titlebar-drag-region absolute inset-x-0 top-0 h-15"
        />
        <PanelGroup direction={isMobile ? "vertical" : "horizontal"} className="relative h-full w-full">
          <Panel id="page-content" order={1} defaultSize={75} minSize={40}>
            <div
              className={cn(
                "@container/frame group/page relative grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)]"
              )}
              style={
                {
                  ...FRAME_TOKENS,
                  "--composer-slot-height": `${composerHeight}px`,
                  "--composer-clearance": composerHeight
                    ? `calc(${composerHeight}px + var(--composer-gap))`
                    : "0px",
                } as React.CSSProperties
              }
            >
              <div data-slot="page-header-layer" className="relative z-10 col-start-1 row-start-1 flex min-w-0 items-center gap-2 px-4">
                <div data-slot="page-leading-slot" ref={setLeading} className="titlebar-no-drag absolute top-(--header-gap) left-4 flex items-center gap-1 group-has-[[data-slot=page-header-row][data-density=compact]]/page:static" />
                <div data-slot="page-header-slot" ref={setHeader} className="mx-auto min-w-0 flex-1 empty:hidden" />
                <div data-slot="page-trailing-slot" ref={setTrailing} className="titlebar-no-drag absolute top-(--header-gap) right-4 flex items-center gap-1 group-has-[[data-slot=page-header-row][data-density=compact]]/page:static" />
              </div>
              <div
                data-slot="page-body"
                // Electron: the column is no drag region, so what scrolls under the
                // top band stays clickable (the gutters and the sidebar's header drag).
                className="titlebar-no-drag @container/panel relative col-start-1 row-start-2 flex min-h-0 min-w-0 flex-col"
              >
                {children}
              </div>
              <div
                aria-hidden
                data-slot="page-composer-fade"
                className="pointer-events-none absolute inset-x-0 -bottom-2 z-10"
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
                // ONE place for every
                // page, the chat included: the sides on the column's content edges
                // (24px in from 768px; the frame's 20px gutter below), 8px above
                // the body's end (16px above the window's). The slot's height
                // (composer + bottom gap) is published as `--composer-lift`.
                className="pointer-events-none relative z-10 col-start-1 row-start-2 flex min-w-0 justify-center self-end pb-[calc(0.25rem+env(safe-area-inset-bottom,0px))] *:pointer-events-auto empty:hidden"
              >
                {composer}
              </div>
            </div>
          </Panel>
          <PanelResizeHandle aria-label="Resize details" className={cn("relative shrink-0 touch-none bg-border focus-visible:outline-2 focus-visible:outline-ring data-[panel-group-direction=horizontal]:w-px data-[panel-group-direction=vertical]:h-px after:absolute after:-inset-1.5", !asideOpen && "hidden")} />
          <Panel id="page-details" order={2} ref={asidePanel} defaultSize={25} minSize={20} maxSize={40} collapsedSize={0} collapsible onCollapse={() => { if (asideOpen) onAsideOpenChange?.(false) }} className="min-h-0 min-w-0 overflow-hidden">
            {aside}
          </Panel>
        </PanelGroup>
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
// stepping through a list uses the panel's upper-corner controls. ONE row, two densities (a prop, never
// a per-page class; the numbers are `FRAME_TOKENS`):
// - `roomy` (default): the first block of the page's column, inset 16px (to line
//   up with the cards' content), 32px tall, 64px from the top on every width,
//   below the upper-corner controls and 40px above the first
//   block; the big page title (21px medium); it scrolls away with the page.
// - `compact` (the open chat): the row in the frame's header slot, pinned above
//   the transcript: 32px between two 24px gaps (the block ends 80px from the top,
//   where the transcript starts); the section title size (16.5px medium), between
//   the upper-corner controls without overlapping them on a narrow pane.
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
          ? "min-h-(--header-compact) py-(--header-gap) md:px-6"
          : "mt-(--nav-top-roomy) h-8",
        !compact && PAGE_INSET,
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
