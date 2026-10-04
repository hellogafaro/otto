import { cn } from "@workspace/ui/lib/utils";
import type { ReactNode } from "react";
import { FloatingChat } from "@/components/floating-chat";

// Scrollable page body: centered column with a title header (no subtitle).
// Spacing follows the 4px-grid golden scale: 4 · 8 · 12 · 20 · 32 · 52.
// "default" (3xl) suits settings and reading; "wide" (5xl) suits lists.
// The column fills the height, so a no-results state centers in what is left.
export function Page({
  title,
  width = "default",
  cover,
  actions,
  floating = <FloatingChat about="this page" />,
  children,
}: {
  title: string;
  /** A block above the title, such as a cover image. */
  cover?: ReactNode;
  width?: "default" | "wide";
  /** The floating chat at the bottom of the view, set up for what is open
   * (by default about "this page"); it rests under short content and stays
   * 16px above the bottom while the page scrolls. */
  floating?: ReactNode;
  /** Page-level ghost icon buttons, shown right of the title. */
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    // Content fades as it scrolls under the top bar (and off the bottom). With
    // a floating bar only the top fades: content scrolls on under the bar's
    // glass, and a bottom fade would dim the bar too.
    <div
      className={cn(
        "relative flex min-h-0 flex-1 flex-col overflow-y-auto",
        floating ? "scroll-fade-t" : "scroll-fade-y",
      )}
    >
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
          // Centered under the content, 16px above the bottom, with nothing
          // behind it: content scrolls on under the bar's translucent glass.
          // Only the bar takes clicks; the space around it passes them on.
          <div className="pointer-events-none sticky bottom-0 z-10 -mx-5 mt-auto px-5 pt-8 pb-4">
            {floating}
          </div>
        )}
      </div>
    </div>
  );
}
