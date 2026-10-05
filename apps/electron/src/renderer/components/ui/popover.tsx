import * as React from "react"

import {
  Popover as DSPopover,
  PopoverContent as DSPopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger as DSPopoverTrigger,
} from "@workspace/ui/components/popover"
import { asChildProps } from "./as-child"

/**
 * Adapter over the design-system Popover (Base UI). Keeps the Radix-shaped API the
 * app was written against: `asChild` on the trigger, and the `onOpenAutoFocus`,
 * `onCloseAutoFocus`, `onEscapeKeyDown`, `onPointerDownOutside`,
 * `onInteractOutside` props on PopoverContent.
 *
 * Dropped (not exposed by the design-system PopoverContent): `collisionPadding`,
 * `sticky`, `avoidCollisions`, `PopoverAnchor` (unused).
 */

type DismissHandlers = {
  onEscapeKeyDown?: (event: KeyboardEvent) => void
  onPointerDownOutside?: (event: Event) => void
  onInteractOutside?: (event: Event) => void
}

const DismissContext = React.createContext<React.RefObject<DismissHandlers> | null>(null)

/** Radix-style `onXAutoFocus(event)`: preventDefault() turns into Base UI's "do not move focus". */
function toFocusHandler(handler?: (event: Event) => void) {
  if (!handler) return undefined
  return () => {
    const event = new Event("focus", { cancelable: true })
    handler(event)
    return !event.defaultPrevented
  }
}

function Popover({
  onOpenChange,
  ...props
}: Omit<React.ComponentProps<typeof DSPopover>, "children"> & { children?: React.ReactNode }) {
  const handlers = React.useRef<DismissHandlers>({})

  const handleOpenChange = React.useCallback<NonNullable<typeof onOpenChange>>(
    (open, details) => {
      if (!open) {
        const h = handlers.current
        const event = details.event
        const call = (fn: ((e: any) => void) | undefined) => {
          if (!fn || !event || event.defaultPrevented) return
          fn(event)
          if (event.defaultPrevented) details.cancel()
        }
        if (details.reason === "escape-key") call(h.onEscapeKeyDown)
        else if (details.reason === "outside-press") {
          call(h.onPointerDownOutside)
          if (!details.isCanceled) call(h.onInteractOutside)
        } else if (details.reason === "focus-out") call(h.onInteractOutside)
        if (details.isCanceled) return
      }
      onOpenChange?.(open, details)
    },
    [onOpenChange],
  )

  return (
    <DismissContext.Provider value={handlers}>
      <DSPopover onOpenChange={handleOpenChange} {...props} />
    </DismissContext.Provider>
  )
}

function PopoverTrigger({
  asChild,
  children,
  ...props
}: React.ComponentProps<typeof DSPopoverTrigger> & { asChild?: boolean }) {
  return <DSPopoverTrigger {...asChildProps({ asChild, children, ...props })} />
}

function PopoverContent({
  onOpenAutoFocus,
  onCloseAutoFocus,
  onEscapeKeyDown,
  onPointerDownOutside,
  onInteractOutside,
  // Radix positioning props the design-system content does not expose.
  collisionPadding: _collisionPadding,
  sticky: _sticky,
  avoidCollisions: _avoidCollisions,
  ...props
}: React.ComponentProps<typeof DSPopoverContent> & {
  onOpenAutoFocus?: (event: Event) => void
  onCloseAutoFocus?: (event: Event) => void
  onEscapeKeyDown?: (event: KeyboardEvent) => void
  onPointerDownOutside?: (event: Event) => void
  onInteractOutside?: (event: Event) => void
  collisionPadding?: number | Partial<Record<"top" | "right" | "bottom" | "left", number>>
  sticky?: "partial" | "always" | boolean
  avoidCollisions?: boolean
}) {
  const handlers = React.useContext(DismissContext)
  React.useEffect(() => {
    if (handlers) handlers.current = { onEscapeKeyDown, onPointerDownOutside, onInteractOutside }
  })
  return (
    <DSPopoverContent
      initialFocus={toFocusHandler(onOpenAutoFocus)}
      finalFocus={toFocusHandler(onCloseAutoFocus)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
}
