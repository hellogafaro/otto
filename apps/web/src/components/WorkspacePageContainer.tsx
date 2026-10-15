import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "../lib/utils";

/**
 * Otto: the three page widths. `narrow` (752px of content) for forms and long
 * reading, `content` (848px) for every other page, `full` for catalogs and
 * dense data that use the whole panel.
 */
export type WorkspacePageWidth = "narrow" | "content" | "full";

const WIDTH_CLASS: Record<WorkspacePageWidth, string> = {
  narrow: "max-w-200",
  content: "max-w-4xl",
  full: "max-w-none",
};

/** Shared content frame for workspace pages. */
export function WorkspacePageContainer({
  width = "content",
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

/** Otto: A page's own 22px title on the content edge, where its cards, table bands and grids start. */
export function WorkspacePageTitle({ children }: { readonly children: ReactNode }) {
  return (
    <h1 className="text-22px leading-title font-medium tracking-title-lg text-foreground">
      {children}
    </h1>
  );
}
