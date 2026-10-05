import * as React from "react"

import {
  Dialog as DSDialog,
  DialogClose as DSDialogClose,
  DialogContent as DSDialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger as DSDialogTrigger,
} from "@workspace/ui/components/dialog"
import { asChildProps } from "./as-child"

/**
 * Adapter over the design-system Dialog (Base UI). Keeps the Radix-shaped API the
 * app was written against: `asChild` on Trigger/Close, and the `onOpenAutoFocus`,
 * `onCloseAutoFocus`, `onEscapeKeyDown`, `onPointerDownOutside`,
 * `onInteractOutside` props on DialogContent.
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

function Dialog({
  onOpenChange,
  ...props
}: Omit<React.ComponentProps<typeof DSDialog>, "children"> & { children?: React.ReactNode }) {
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
      <DSDialog onOpenChange={handleOpenChange} {...props} />
    </DismissContext.Provider>
  )
}

function DialogTrigger({
  asChild,
  children,
  ...props
}: React.ComponentProps<typeof DSDialogTrigger> & { asChild?: boolean }) {
  return <DSDialogTrigger {...asChildProps({ asChild, children, ...props })} />
}

function DialogClose({
  asChild,
  children,
  ...props
}: React.ComponentProps<typeof DSDialogClose> & { asChild?: boolean }) {
  return <DSDialogClose {...asChildProps({ asChild, children, ...props })} />
}

function DialogContent({
  onOpenAutoFocus,
  onCloseAutoFocus,
  onEscapeKeyDown,
  onPointerDownOutside,
  onInteractOutside,
  ...props
}: React.ComponentProps<typeof DSDialogContent> & {
  onOpenAutoFocus?: (event: Event) => void
  onCloseAutoFocus?: (event: Event) => void
  onEscapeKeyDown?: (event: KeyboardEvent) => void
  onPointerDownOutside?: (event: Event) => void
  onInteractOutside?: (event: Event) => void
}) {
  const handlers = React.useContext(DismissContext)
  React.useEffect(() => {
    if (handlers) handlers.current = { onEscapeKeyDown, onPointerDownOutside, onInteractOutside }
  })
  return (
    <DSDialogContent
      initialFocus={toFocusHandler(onOpenAutoFocus)}
      finalFocus={toFocusHandler(onCloseAutoFocus)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
