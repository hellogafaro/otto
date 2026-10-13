import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "../lib/utils";

export type WorkspacePageWidth = "narrow" | "readable" | "wide" | "expanded";

const WIDTH_CLASS: Record<WorkspacePageWidth, string> = {
  narrow: "max-w-200",
  readable: "max-w-4xl",
  wide: "max-w-5xl",
  expanded: "max-w-6xl",
};

/** Shared content frame for workspace pages. */
export function WorkspacePageContainer({
  width = "readable",
  className,
  ...props
}: ComponentPropsWithoutRef<"div"> & { readonly width?: WorkspacePageWidth }) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col gap-6 px-5 pt-6 pb-12 sm:px-6",
        WIDTH_CLASS[width],
        className,
      )}
      {...props}
    />
  );
}

/** Otto: A page's own 22px title, inset 16px to sit on the content edge. */
export function WorkspacePageTitle({ children }: { readonly children: ReactNode }) {
  return (
    <h1 className="px-4 text-22px leading-title font-medium tracking-title-lg text-foreground">
      {children}
    </h1>
  );
}
