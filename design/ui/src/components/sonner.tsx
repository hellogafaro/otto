"use client"

import { buttonVariants } from "@workspace/ui/components/button"
import { cn } from "cn"
import { CircleCheckIcon, InfoIcon, LoaderIcon, OctagonXIcon, TriangleAlertIcon } from "lucide-react"
import { Toaster as Sonner, toast as sonner, type ToasterProps } from "sonner"

// Otto: stock shadcn Sonner; toasts come from Sonner's own `toast`
// (`toast.success("Link copied")`), re-exported below. Each is one plain row
// and nothing else: its icon in its status color, a short sentence-case
// message, and Close at the end. On the menus' surface in both themes (dark,
// translucent, blurred, hairline, 12px corners like a card). Close is the
// 28px ghost button 6px in (its 6px corners + 6 = 12, nested); the message
// sits 12px in and wraps, so a toast is as tall as what it says (40px for
// one line). Bottom right, out of the floating chat's way. Styled through
// Sonner's classNames (unstyled), so no defaults fight it.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      position="bottom-right"
      className="toaster group"
      closeButton
      icons={{
        success: <CircleCheckIcon className="size-3.5 text-status-done" />,
        info: <InfoIcon className="size-3.5 text-muted-foreground" />,
        warning: <TriangleAlertIcon className="size-3.5 text-status-review" />,
        error: <OctagonXIcon className="size-3.5 text-destructive" />,
        loading: (
          <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "cn-toast dark flex w-(--width) items-center gap-2 rounded-xl bg-popover/70 p-1.5 pl-3 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 backdrop-blur-2xl backdrop-saturate-150",
          content: "min-w-0 flex-1 py-1",
          // On the first line's middle when the message wraps.
          icon: "mt-1 flex h-5 w-3.5 shrink-0 items-center justify-center self-start",
          title: "font-normal",
          // Last in the row: the 28px ghost button itself. Sonner's theme
          // paints its close button (background, border, color) with
          // stronger selectors, so those three are forced back to ghost: no
          // border, no fill until hovered.
          closeButton: cn(
            buttonVariants({ variant: "ghost", size: "icon-compact" }),
            "order-last self-start border-transparent! bg-transparent! text-muted-foreground! hover:bg-muted/50! hover:text-foreground!"
          ),
        },
      }}
      {...props}
    />
  )
}

// Otto: a toast is one sentence with no period, whatever message reaches it
// (server and form messages end in one).
const plain =
  <A extends unknown[], R>(show: (message: string, ...rest: A) => R) =>
  (message: string, ...rest: A) =>
    show(message.replace(/\.$/, ""), ...rest)
const toast = {
  success: plain(sonner.success),
  error: plain(sonner.error),
  info: plain(sonner.info),
  warning: plain(sonner.warning),
}

export { Toaster, toast }
