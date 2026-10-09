"use client"

import { Button } from "@workspace/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "cn"
import { List } from "lucide-react"
import * as React from "react"

// Otto: details stay inside the shell panel's resizable split, without a floating
// card, header separator or shadow. The narrow split stacks below the page.
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
  const close = (event: React.SyntheticEvent<HTMLElement>) => {
    const frame = event.currentTarget.closest('[data-slot="page-frame"]')
    onOpenChange(false)
    requestAnimationFrame(() => frame?.querySelector<HTMLElement>('[data-slot="sidecar-toggle"]')?.focus())
  }
  return (
    <section
      data-slot="sidecar"
      data-state={open ? "open" : "closed"}
      aria-label={title}
      inert={!open}
      onKeyDownCapture={(event) => {
        // Otto: only while focus is inside it in the DOM: a dialog opened from it (a portal) bubbles here in React.
        if (
          event.key === "Escape" &&
          event.currentTarget.contains(event.target as Node)
        ) {
          event.stopPropagation()
          close(event)
        }
      }}
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden",
        !open && "pointer-events-none",
        className
      )}
    >
      <header
        data-slot="sidecar-header"
        className="flex h-12 shrink-0 items-center gap-1 p-2"
      >
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
          {title}
        </h2>
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon" data-slot="sidecar-close" aria-label={closeLabel} aria-expanded={open} onClick={close} />}>
            <List />
          </TooltipTrigger>
          <TooltipContent side="bottom">{closeLabel}</TooltipContent>
        </Tooltip>
      </header>
      <div
        data-slot="sidecar-body"
        className="no-scrollbar min-h-0 flex-1 scroll-fade-y overflow-y-auto px-4 pb-4 text-sm"
      >
        {children}
      </div>
    </section>
  )
}

// Otto: the details opener is an upper-right panel action only while closed.
function SidecarToggle({
  open,
  onOpenChange,
  label,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  label: string
}) {
  if (open) return null
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            data-slot="sidecar-toggle"
            aria-label={label}
            aria-expanded={open}
            className="titlebar-no-drag"
            onClick={(event) => {
              const frame = event.currentTarget.closest('[data-slot="page-frame"]')
              onOpenChange(true)
              requestAnimationFrame(() => frame?.querySelector<HTMLElement>('[data-slot="sidecar-close"]')?.focus())
            }}
          >
            <List />
          </Button>
        }
      />
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

export { Sidecar, SidecarToggle }
