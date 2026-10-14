"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import { cn } from "~/lib/utils";

/**
 * Otto: A full-screen preview over everything, on the page background. The
 * caller lays out its top bar, the preview and any sidebar inside; Escape and
 * the backdrop close it like any dialog.
 */
function LightboxPopup({ className, children, ...props }: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Popup
        className={cn(
          "fixed inset-0 z-50 flex flex-col bg-background text-foreground outline-none transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0",
          className,
        )}
        data-slot="lightbox-popup"
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

const Lightbox = DialogPrimitive.Root;

/** Otto: The lightbox's top-bar title, 13px/500 in full foreground. */
function LightboxTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      className={cn("text-13px font-medium text-foreground", className)}
      {...props}
    />
  );
}

const LightboxClose = DialogPrimitive.Close;

export { Lightbox, LightboxClose, LightboxPopup, LightboxTitle };
