"use client"

import { Button } from "@workspace/ui/components/button"
import { useMediaQuery } from "@workspace/ui/hooks/use-media-query"
import { cn } from "cn"
import { XIcon } from "lucide-react"
import * as React from "react"

// Otto: the right-hand floating card, for an inspector or details (session
// info, files, a source's details). Same surface as the `ContentCard`, so it
// reads as its sibling: `bg-background`, `ring-foreground/10`, `shadow-xs`, 12px
// corners. 8px from the top, right and bottom; 320px wide (25vw, between 280 and
// 360px).
//
// From 1280px up it is a flex item beside the main card, with the card's own 8px
// right margin as the gap, so opening it shrinks the main card. Below 1280px it
// overlays the main card (shadow-md, no backdrop) instead of squeezing it, and
// below 768px it spans the width. Closed by default; opening and closing is a
// 200ms width + fade (a slide and fade when overlaid), none with reduced motion.
// Its content stays at full width while the card grows, so nothing reflows.
// Escape closes it while focus is inside.
const FLOATING_CARD_EXPANDED_QUERY = "(min-width: 1280px)"

function FloatingCard({
  open,
  onOpenChange,
  title,
  closeLabel = "Close",
  actions,
  className,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: React.ReactNode
  closeLabel?: string
  /** Buttons before Close in the header. */
  actions?: React.ReactNode
  className?: string
  children?: React.ReactNode
}) {
  const docked = useMediaQuery(FLOATING_CARD_EXPANDED_QUERY)
  const state = open ? "open" : "closed"

  const card = (
    <section
      data-slot="floating-card"
      data-state={state}
      aria-label={typeof title === "string" ? title : undefined}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation()
          onOpenChange(false)
        }
      }}
      className={cn(
        "flex h-full w-(--floating-card-width) max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-xl bg-background shadow-xs ring-1 ring-foreground/10 max-md:w-full",
        !docked && "shadow-md",
        className
      )}
    >
      <header
        data-slot="floating-card-header"
        className="flex h-11 shrink-0 items-center gap-1 pr-2 pl-4"
      >
        <h2 className="min-w-0 flex-1 truncate text-base leading-6 font-medium">
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
        data-slot="floating-card-body"
        className="no-scrollbar min-h-0 flex-1 scroll-fade-y overflow-y-auto px-4 pb-4"
      >
        {children}
      </div>
    </section>
  )

  const motion =
    "transition-[width,opacity,transform] duration-200 ease-out motion-reduce:transition-none"

  if (docked) {
    return (
      <aside
        data-slot="floating-card-slot"
        data-state={state}
        inert={!open}
        className={cn(
          "shrink-0 overflow-hidden py-2 [--floating-card-width:clamp(280px,25vw,360px)]",
          motion,
          open
            ? "w-[calc(var(--floating-card-width)+0.5rem)] opacity-100"
            : "w-0 opacity-0"
        )}
      >
        <div className="h-full w-[calc(var(--floating-card-width)+0.5rem)] pr-2">
          {card}
        </div>
      </aside>
    )
  }

  return (
    <aside
      data-slot="floating-card-slot"
      data-state={state}
      inert={!open}
      className={cn(
        "absolute inset-y-0 right-0 z-20 p-2 [--floating-card-width:clamp(280px,25vw,360px)] max-md:left-0",
        motion,
        open
          ? "translate-x-0 opacity-100"
          : "pointer-events-none translate-x-4 opacity-0"
      )}
    >
      {card}
    </aside>
  )
}

export { FloatingCard }
