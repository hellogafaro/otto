import { cn } from "@workspace/ui/lib/utils";
import type { ReactNode } from "react";

// Scrollable page body: centered column with a title header (no subtitle).
// Spacing follows the 4px-grid golden scale: 4 · 8 · 12 · 20 · 32 · 52.
// "default" (3xl) suits settings and reading; "wide" (5xl) suits lists.
// The column fills the height, so a no-results state centers in what is left.
export function Page({
  title,
  width = "default",
  actions,
  children,
}: {
  title: string;
  width?: "default" | "wide";
  /** Page-level ghost icon buttons, shown right of the title. */
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div
        className={cn(
          "mx-auto flex w-full flex-1 flex-col gap-5 px-5 pt-5 pb-13 md:pt-13",
          width === "wide" ? "max-w-5xl" : "max-w-3xl",
        )}
      >
        <header className="flex items-center justify-between gap-3">
          <h1 className="min-w-0 text-lg font-medium">{title}</h1>
          {actions && <div className="flex items-center gap-1">{actions}</div>}
        </header>
        {children}
      </div>
    </div>
  );
}
