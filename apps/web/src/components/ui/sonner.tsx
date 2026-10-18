"use client";

import {
  RiAlertLine,
  RiCheckboxCircleLine,
  RiCloseLine,
  RiErrorWarningLine,
  RiInformationLine,
  RiLoaderLine,
} from "@remixicon/react";
import { useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Toaster as Sonner, type ToasterProps, useSonner } from "sonner";

import { useI18n } from "~/i18n";
import { buttonVariants } from "./button";

// Otto: The composer's bottom padding (pb-4, sm:pb-6), so a toast's bottom lines up with the composer's.
const TOAST_INSET = 16;

const TOAST_INSET_SM = 24;

/**
 * Otto: shadcn's Sonner, styled like Capy and Linear: one line on the popover
 * surface, a status icon, the title, at most one outline action and an inline
 * ghost close. It stacks bottom right inside the main panel's corner, as far from
 * its edges as the composer sits from the bottom (16px, 24px from `sm`), with
 * a radius below the panel's so it reads as the smaller, inner shape
 * (`--toast-radius`). Its buttons keep the normal control radius and sit 4px
 * from the edges and 4px apart.
 */
function Toaster(props: ToasterProps) {
  const { t } = useI18n();
  const offset = useMainPanelOffset();

  return (
    <Sonner
      // Unstyled toasts draw every color from Otto tokens; Sonner's dark theme would
      // still paint its own fill on the close button, so it stays on light.
      theme="light"
      position="bottom-right"
      offset={offset}
      // Sonner widens a phone toast by the left offset on both sides.
      mobileOffset={{ ...offset, left: offset.right }}
      gap={8}
      closeButton
      containerAriaLabel={t("Notifications")}
      icons={{
        success: <RiCheckboxCircleLine className="size-4 text-success" />,
        info: <RiInformationLine className="size-4 text-info" />,
        warning: <RiAlertLine className="size-4 text-warning" />,
        error: <RiErrorWarningLine className="size-4 text-destructive" />,
        loading: <RiLoaderLine className="size-4 animate-spin text-muted-foreground" />,
        close: <RiCloseLine className="size-3.5" />,
      }}
      toastOptions={{
        unstyled: true,
        closeButtonAriaLabel: t("Dismiss notification"),
        classNames: {
          toast:
            "dropdown-glass flex w-full items-center gap-1 rounded-(--toast-radius) py-1 pr-1 pl-3 text-13px text-popover-foreground shadow-xl shadow-shade/25",
          icon: "me-1.5 flex size-4 shrink-0 items-center justify-center",
          content: "me-1 min-w-0 flex-1",
          title: "wrap-break-word",
          actionButton: buttonVariants({
            variant: "outline",
            size: "sm",
            className: "shrink-0",
          }),
          closeButton: buttonVariants({
            variant: "ghost",
            size: "icon-sm",
            className: "order-last shrink-0",
          }),
        },
      }}
      {...props}
    />
  );
}

/**
 * The main panel's inner right and bottom edges, measured from the window's, plus the
 * composer's inset. Otto: while a side sheet is open its corner is used instead, so a toast
 * never floats over the dimmed page beside it. It measures again whenever a toast appears and
 * whenever a sheet opens or closes, because the panel mounts after the Toaster (behind sign-in
 * and loading).
 */
function useMainPanelOffset(): { right: number; bottom: number } {
  const pathname = useLocation({ select: (location) => location.pathname });
  const toasts = useSonner().toasts.length;
  const [offset, setOffset] = useState({ right: TOAST_INSET, bottom: TOAST_INSET });

  useEffect(() => {
    const panel = document.querySelector<HTMLElement>("main[data-slot=sidebar-inset]");

    const measure = () => {
      const inset = window.matchMedia("(min-width: 40rem)").matches ? TOAST_INSET_SM : TOAST_INSET;

      const corner =
        document.querySelector<HTMLElement>("[data-slot=sheet-popup][data-open]") ?? panel;

      if (!corner) {
        setOffset({ right: inset, bottom: inset });

        return;
      }

      const rect = corner.getBoundingClientRect();

      setOffset({
        right:
          inset +
          Math.max(0, window.innerWidth - (rect.left + corner.clientLeft + corner.clientWidth)),
        bottom:
          inset +
          Math.max(0, window.innerHeight - (rect.top + corner.clientTop + corner.clientHeight)),
      });
    };

    measure();
    const resizes = new ResizeObserver(measure);
    const portals = new MutationObserver(measure);

    if (panel) resizes.observe(panel);
    portals.observe(document.body, { childList: true });
    window.addEventListener("resize", measure);

    return () => {
      resizes.disconnect();
      portals.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [pathname, toasts]);

  return offset;
}

export { Toaster };
