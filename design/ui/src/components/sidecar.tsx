"use client"

import { Button } from "@workspace/ui/components/button"
import { cn } from "cn"
import { XIcon } from "lucide-react"
import * as React from "react"

// Otto: the sidecar, for an inspector or details (session info, files, a
// source's details), on the sidelines of the column. Docked in the right gutter
// it is a canvas, not a surface: no background, ring, shadow or corners, just
// quiet metadata blocks floating on the frame beside the column, 296px wide,
// 20px from it and level with the header row (its title is the first subtitle,
// Close a ghost 28px icon at its end). A block is a small muted subtitle
// outside any surface with flat rows, 13px text, chips and avatars under it;
// controls in it may be bordered, panels never. It does not move while the
// center scrolls (only the center column scrolls) and scrolls itself, with the
// edge fade, when taller than the window.
//
// `surface` wraps the same content in a card (`bg-card`, hairline ring,
// `shadow-xs`, 12px corners, 16px padding, as tall as the column) for A/B
// testing; undecided, so the canvas is the default. Pass it as the `aside` of
// `PageFrame`, which gives it the right gutter: from 1280px of region width it
// sits there and the column stays centered while the gutter is wide enough,
// else the column shifts left to make room. Narrower it overlays the page, and
// an overlay always has a surface (`bg-card`, ring, `shadow-md`) since it
// floats over content; below 768px it spans the width.
//
// Closed by default; opening and closing is a 200ms slide and fade, none with
// reduced motion. Its content stays at full width while it moves, so nothing
// reflows. Escape closes it while focus is inside.
function Sidecar({
  open,
  onOpenChange,
  title,
  closeLabel = "Close",
  surface = false,
  actions,
  className,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: React.ReactNode
  closeLabel?: string
  /** Wrap the docked sidecar in a card (A/B test); an overlay always has one. */
  surface?: boolean
  /** Buttons before Close in the header. */
  actions?: React.ReactNode
  className?: string
  children?: React.ReactNode
}) {
  return (
    <section
      data-slot="sidecar"
      data-state={open ? "open" : "closed"}
      aria-label={typeof title === "string" ? title : undefined}
      inert={!open}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation()
          onOpenChange(false)
        }
      }}
      className={cn(
        "z-20 flex w-74 max-w-[calc(100%-1rem)] flex-col overflow-hidden rounded-xl bg-card",
        "transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
        // Overlay (under 1280px): over the page, right and spanning on phones.
        "absolute inset-y-2 right-2 card-surface [--card-shadow:var(--shadow-md)] max-md:inset-x-2 max-md:w-auto max-md:max-w-none",
        // Docked: a grid item of the right gutter, 20px from the column, no surface.
        "@[1280px]/frame:static @[1280px]/frame:col-start-3 @[1280px]/frame:row-span-2 @[1280px]/frame:row-start-1 @[1280px]/frame:ml-5 @[1280px]/frame:[--card-shadow:var(--shadow-xs)]",
        !surface &&
          "@[1280px]/frame:rounded-none @[1280px]/frame:bg-transparent @[1280px]/frame:[box-shadow:none]",
        open
          ? "translate-x-0 opacity-100"
          : "pointer-events-none translate-x-4 opacity-0",
        className
      )}
    >
      <header
        data-slot="sidecar-header"
        className={cn(
          "flex h-13 shrink-0 items-center gap-1 pr-3.5 pl-4",
          !surface && "@[1280px]/frame:px-0"
        )}
      >
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
          {title}
        </h2>
        {actions}
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
        className={cn(
          "no-scrollbar min-h-0 flex-1 scroll-fade-y overflow-y-auto px-4 pb-4 text-sm",
          !surface && "@[1280px]/frame:px-0"
        )}
      >
        {children}
      </div>
    </section>
  )
}

export { Sidecar }
