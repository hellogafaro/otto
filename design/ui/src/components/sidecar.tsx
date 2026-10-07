"use client"

import { Button } from "@workspace/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "cn"
import { PanelRightIcon, XIcon } from "lucide-react"
import * as React from "react"

// Otto: the sidecar, for an item's details (Otto v1's right column: plain text
// on the page background, muted section labels, rows of icon + value). It
// FLOATS: an absolute layer, never a grid item, so opening it never reflows the
// page by itself. Pass it as the `aside` of `PageFrame`:
// - from 1160px of frame width (the nav's 72px gutter + the 768px column + the
//   320px it reserves: `--nav-gap` 16, `--sidecar-width` 296, 8 to the window)
//   both fit. It sits in the right gutter on the frame with NO surface (no
//   background, ring, shadow, corners or title), `--nav-gap` from the column
//   (the x of `SidecarToggle` above it) and from the content start
//   (`--content-start`) to the frame's 8px bottom; `PageFrame` reserves its 320px
//   in the right track, so the column (and the composer in it) shifts left only
//   as far as the gutter is too narrow. Its toggle is its close.
// - narrower it overlays the page on a card (`bg-card`, ring, `shadow-md`; it
//   floats over content) with its title and Close, since it covers the toggle;
//   below 768px it spans the width (the phone sheet).
// Closed by default; opening and closing is a 200ms slide and fade, none with
// reduced motion. It scrolls itself, with the edge fade, when taller than the
// window. Escape closes it while focus is inside.
function Sidecar({
  open,
  onOpenChange,
  title,
  closeLabel = "Close",
  className,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  closeLabel?: string
  className?: string
  children?: React.ReactNode
}) {
  return (
    <section
      data-slot="sidecar"
      data-state={open ? "open" : "closed"}
      aria-label={title}
      inert={!open}
      onKeyDown={(event) => {
        // Otto: only while focus is inside it in the DOM: a dialog opened from it (a portal) bubbles here in React.
        if (
          event.key === "Escape" &&
          event.currentTarget.contains(event.target as Node)
        ) {
          event.stopPropagation()
          onOpenChange(false)
        }
      }}
      className={cn(
        "absolute z-20 flex flex-col overflow-hidden",
        "transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
        // Overlay (under 1160px): a card over the page, right, spanning on phones.
        "inset-y-2 right-2 w-(--sidecar-width) max-w-[calc(100%-1rem)] rounded-xl bg-card card-surface [--card-shadow:var(--shadow-md)] max-md:inset-x-2 max-md:w-auto max-md:max-w-none",
        // Floating beside the column: the right gutter's area, no surface.
        "@[1160px]/frame:col-start-3 @[1160px]/frame:row-start-2 @[1160px]/frame:top-(--content-start) @[1160px]/frame:right-auto @[1160px]/frame:bottom-0 @[1160px]/frame:left-(--nav-gap) @[1160px]/frame:max-w-none @[1160px]/frame:rounded-none @[1160px]/frame:border-0 @[1160px]/frame:bg-transparent @[1160px]/frame:[box-shadow:none]",
        open
          ? "translate-x-0 opacity-100"
          : "pointer-events-none translate-x-4 opacity-0",
        className
      )}
    >
      <header
        data-slot="sidecar-header"
        className="flex h-13 shrink-0 items-center gap-1 pr-3.5 pl-4 @[1160px]/frame:hidden"
      >
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
          {title}
        </h2>
        <Button
          variant="ghost"
          size="icon-compact"
          aria-label={closeLabel}
          onClick={() => onOpenChange(false)}
        >
          <XIcon />
        </Button>
      </header>
      <div
        data-slot="sidecar-body"
        className="no-scrollbar min-h-0 flex-1 scroll-fade-y overflow-y-auto px-2 pb-4 text-sm @[1160px]/frame:px-0"
      >
        {children}
      </div>
    </section>
  )
}

// Otto: the sidecar's toggle, never in the title row: the floating
// navigation's raised icon button (`outline`, 32px, `md` 8), mirrored. `PageFrame`
// gives it its slot: in the right gutter `--nav-gap` from the column, level with
// the title row, while that gutter is 72px wide (from 912px of frame width); else
// fixed over the column's top-right on the title row's line (the title row
// clears it), on the axis below 768px. Open, it is the Close in the same place.
function SidecarToggle({
  open,
  onOpenChange,
  label,
  closeLabel = "Close",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  label: string
  closeLabel?: string
}) {
  const text = open ? closeLabel : label
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="outline"
            size="icon"
            aria-label={text}
            aria-expanded={open}
            className="titlebar-no-drag"
            onClick={() => onOpenChange(!open)}
          >
            {open ? <XIcon /> : <PanelRightIcon />}
          </Button>
        }
      />
      <TooltipContent side="bottom">{text}</TooltipContent>
    </Tooltip>
  )
}

export { Sidecar, SidecarToggle }
