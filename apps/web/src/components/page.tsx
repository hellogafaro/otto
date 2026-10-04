import { cn } from "@workspace/ui/lib/utils";
import type { ReactNode } from "react";

// Scrollable page body: centered column with a title header (no subtitle).
// Spacing follows the 4px-grid golden scale: 4 · 8 · 12 · 20 · 32 · 52.
// "default" (3xl) suits settings and reading; "wide" (5xl) suits lists.
// The column fills the height, so a no-results state centers in what is left.
export function Page({
  title,
  width = "default",
  cover,
  actions,
  floating,
  children,
}: {
  title: string;
  /** A block above the title, such as a cover image. */
  cover?: ReactNode;
  width?: "default" | "wide";
  /** A bar that floats at the bottom of the view (Ask Otto); it rests under
   * short content and stays 16px above the bottom while the page scrolls. */
  floating?: ReactNode;
  /** Page-level ghost icon buttons, shown right of the title. */
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div
        className={cn(
          // A floating bar brings its own bottom space.
          "mx-auto flex w-full flex-1 flex-col gap-5 px-5 pt-5 md:pt-13",
          !floating && "pb-13",
          width === "wide" ? "max-w-5xl" : "max-w-3xl",
        )}
      >
        {cover}
        <header className="flex items-center justify-between gap-3">
          <h1 className="min-w-0 text-lg font-medium">{title}</h1>
          {actions && <div className="flex items-center gap-1">{actions}</div>}
        </header>
        {children}
        {floating && (
          // Centered under the content. It rests 16px above the bottom on a
          // column-wide fade from the page background (bottom) to transparent
          // (32px above), so text scrolling under it fades out.
          <div className="sticky bottom-0 z-10 -mx-5 mt-auto bg-linear-to-t from-background from-60% to-transparent px-5 pt-8 pb-4">
            {floating}
          </div>
        )}
      </div>
    </div>
  );
}
