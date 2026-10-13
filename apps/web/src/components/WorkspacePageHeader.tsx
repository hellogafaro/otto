import { RiArrowLeftSLine } from "@remixicon/react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "../workspaceTitlebar";

/**
 * Right inset for a header that a details panel toggle floats over. The toggle
 * is always fixed at the top-right below the inline breakpoint, and on wider
 * screens only while the desktop panel is closed.
 */
export function detailsToggleInsetClass(detailsPanelOpen: boolean | undefined): string | null {
  if (detailsPanelOpen === undefined) return null;

  return detailsPanelOpen
    ? "max-[980px]:pr-[calc(var(--workspace-controls-header-right)+var(--workspace-titlebar-control-size)+var(--workspace-titlebar-control-gap))]!"
    : "pr-[calc(var(--workspace-controls-header-right)+var(--workspace-titlebar-control-size)+var(--workspace-titlebar-control-gap))]!";
}

/**
 * Otto: Shared workspace top bar. 44px tall with 8px insets so its 28px
 * buttons sit 8px from every edge, 6px apart.
 */
export function WorkspacePageHeader({
  electron = false,
  reserveNativeControls = electron,
  detailsPanelOpen,
  className,
  ...props
}: ComponentPropsWithoutRef<"header"> & {
  readonly electron?: boolean;
  readonly reserveNativeControls?: boolean;
  /** Set on pages with a bot or group details panel so its toggle never covers header actions. */
  readonly detailsPanelOpen?: boolean;
}) {
  return (
    <header
      data-workspace-header=""
      className={cn(
        "flex h-(--workspace-topbar-height) min-h-(--workspace-topbar-height) shrink-0 items-center gap-1.5 pl-safe-left-0.5rem pr-safe-right-0.5rem transition-padding-left duration-200 ease-linear motion-reduce:transition-none",
        electron && "drag-region",
        reserveNativeControls && "wco:pr-(--workspace-native-controls-inset)",
        COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
        // Below md the main sidebar hides and a fixed toggle sits at the left
        // edge of the top bar, so the title starts after it.
        "max-md:pl-titlebar-controls-end!",
        detailsToggleInsetClass(detailsPanelOpen),
        className,
      )}
      {...props}
    />
  );
}

/**
 * Otto: A sub page's top bar holds one quiet back button named after the
 * page it returns to, chevron then title, never a breadcrumb. The page's own
 * title opens its content.
 */
export function WorkspaceBackButton({
  label,
  onBack,
}: {
  readonly label: string;
  readonly onBack: () => void;
}) {
  return (
    <Button variant="ghost-muted" size="back-title" className="min-w-0" onClick={onBack}>
      <RiArrowLeftSLine aria-hidden className="size-4" />
      <span className="truncate">{label}</span>
    </Button>
  );
}

/**
 * Otto: A chat's title in the top bar, on the back button's grid: a 28px row
 * whose 16px leading visual sits where a back chevron would, then the name in
 * the back button's 13px/500.
 */
export function WorkspaceHeaderTitle({
  visual,
  children,
}: {
  readonly visual: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex h-7 min-w-0 items-center gap-1.5 px-1.5 text-13px font-medium text-foreground">
      {visual}
      <span className="truncate">{children}</span>
    </div>
  );
}
