"use client";

import { RiCloseLine } from "@remixicon/react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import {
  DIALOG_BACKDROP_CLASS,
  DIALOG_MOBILE_SHEET_CLASS,
  DIALOG_POPUP_CLASS,
} from "~/components/ui/dialog-styles";
import { ScrollArea } from "~/components/ui/scroll-area";

const DialogCreateHandle = DialogPrimitive.createHandle;

const Dialog = DialogPrimitive.Root;

const DialogPortal = DialogPrimitive.Portal;

function DialogTrigger(props: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogClose(props: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogBackdrop({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      forceRender
      className={cn(DIALOG_BACKDROP_CLASS, className)}
      data-slot="dialog-backdrop"
      {...props}
    />
  );
}

function DialogViewport({ className, ...props }: DialogPrimitive.Viewport.Props) {
  return (
    <DialogPrimitive.Viewport
      className={cn(
        "fixed inset-0 z-50 grid grid-rows-[1fr_auto_1fr] justify-items-center p-4",
        className,
      )}
      data-slot="dialog-viewport"
      {...props}
    />
  );
}

function DialogPopup({
  className,
  children,
  showCloseButton = true,
  bottomStickOnMobile = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean;
  bottomStickOnMobile?: boolean;
}) {
  return (
    <DialogPortal>
      <DialogBackdrop />
      <DialogViewport
        className={cn(bottomStickOnMobile && "max-sm:grid-rows-[1fr_auto] max-sm:p-0 max-sm:pt-12")}
      >
        <DialogPrimitive.Popup
          className={cn(
            DIALOG_POPUP_CLASS,
            "row-start-2 max-h-full max-w-lg text-popover-foreground",
            bottomStickOnMobile && DIALOG_MOBILE_SHEET_CLASS,
            className,
          )}
          data-slot="dialog-popup"
          data-close-button={showCloseButton || undefined}
          {...props}
        >
          {children}
          {showCloseButton && (
            // Otto: A 28px close 14px from the corner, centered on the title's line, its glyph on the 20px content edge.
            <DialogPrimitive.Close
              aria-label="Close"
              className="absolute end-3.5 top-3.5"
              render={<Button size="icon-sm" variant="ghost-muted" />}
            >
              <RiCloseLine />
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Popup>
      </DialogViewport>
    </DialogPortal>
  );
}

function DialogHeader({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & {
  /** `directory` is the compact header above a searchable catalog; `divided` adds a rule below. */
  variant?: "default" | "directory" | "divided";
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 px-5 pt-4 pb-4 in-data-close-button:pe-12",
        variant === "directory" && "gap-3",
        variant === "divided" && "border-b",
        className,
      )}
      data-slot="dialog-header"
      {...props}
    />
  );
}

function DialogFooter({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & {
  variant?: "default" | "bare";
}) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 px-5 py-4 sm:flex-row sm:justify-end sm:gap-1.5",
        variant === "default" && "border-t",
        className,
      )}
      data-slot="dialog-footer"
      {...props}
    />
  );
}

/** `withIcon` lays the title out as a row with a leading icon. */
function DialogTitle({
  className,
  withIcon = false,
  ...props
}: DialogPrimitive.Title.Props & { withIcon?: boolean }) {
  return (
    <DialogPrimitive.Title
      className={cn(
        "text-base leading-6 font-medium tracking-title-sm text-foreground",
        withIcon && "flex items-center gap-2.5",
        className,
      )}
      data-slot="dialog-title"
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      className={cn("text-muted-foreground text-sm", className)}
      data-slot="dialog-description"
      {...props}
    />
  );
}

function DialogPanel({
  className,
  scrollFade = true,
  variant = "default",
  tone,
  pageBack = false,
  ...props
}: React.ComponentProps<"div"> & {
  scrollFade?: boolean;
  /** `directory` keeps the catalog body tight under a `directory` header. */
  variant?: "default" | "directory";
  /** Body copy size and color for prose panels. */
  tone?: "body" | "muted";
  /** Plays the backward page transition when returning to a previous view. */
  pageBack?: boolean;
}) {
  return (
    <ScrollArea scrollFade={scrollFade}>
      <div
        className={cn(
          "p-5 in-[[data-slot=dialog-popup]:has([data-slot=dialog-header])]:pt-1 in-[[data-slot=dialog-popup]:has([data-slot=dialog-footer]:not(.border-t))]:pb-1",
          variant === "directory" && "pt-5!",
          tone && "text-sm",
          tone === "muted" && "text-muted-foreground",
          pageBack && "motion-page-back",
          className,
        )}
        data-slot="dialog-panel"
        {...props}
      />
    </ScrollArea>
  );
}

export {
  DialogCreateHandle,
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogBackdrop,
  DialogBackdrop as DialogOverlay,
  DialogPopup,
  DialogPopup as DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogViewport,
};
