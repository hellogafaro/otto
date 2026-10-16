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
import { Toaster as Sonner, type ToasterProps } from "sonner";

import { useI18n } from "~/i18n";
import { buttonVariants } from "./button";

// Otto: 16px from the main panel's edges, like Linear and Capy.
const TOAST_INSET = 16;

/**
 * Otto: shadcn's Sonner, styled like Capy and Linear: one line on the popover
 * surface, a status icon, the title, at most one outline action and an inline
 * ghost close. It stacks bottom right, 16px inside the main panel's corner, with
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
      mobileOffset={TOAST_INSET}
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

/** The main panel's distance from the window's right and bottom edges, plus the 16px inset. */
function useMainPanelOffset(): { right: number; bottom: number } {
  const pathname = useLocation({ select: (location) => location.pathname });
  const [offset, setOffset] = useState({ right: TOAST_INSET, bottom: TOAST_INSET });

  useEffect(() => {
    const panel = document.querySelector<HTMLElement>("main[data-slot=sidebar-inset]");

    const measure = () => {
      const rect = panel?.getBoundingClientRect();

      setOffset({
        right: TOAST_INSET + (rect ? Math.max(0, window.innerWidth - rect.right) : 0),
        bottom: TOAST_INSET + (rect ? Math.max(0, window.innerHeight - rect.bottom) : 0),
      });
    };

    measure();
    const observer = new ResizeObserver(measure);

    if (panel) observer.observe(panel);
    window.addEventListener("resize", measure);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [pathname]);

  return offset;
}

export { Toaster };
