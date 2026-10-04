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
  centered = false,
  floating = <FloatingChat about="this page" />,
  children,
}: {
  title: string;
  /** The title in the middle (Home), same size and spacing; no actions. */
  centered?: boolean;
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
    // The floating chat sits on a layer above the scrolling page, not inside
    // it: the page's fade is a mask, and an element inside a masked one
    // can't reliably blur what is behind it, so the glass would show the
    // page through it instead of frosting it.
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Content fades at both ends as it scrolls, under the top bar and
          off the bottom. The floating chat sits above the page, outside this
          fade, so it never dims; content keeps 88px free at the end (the
          bar's 40px, 16px below it and 32px above) so the last of it clears
          the bar. */}
      <div className="flex min-h-0 flex-1 scroll-fade-y flex-col overflow-y-auto">
        <div
          className={cn(
            "mx-auto flex w-full flex-1 flex-col gap-5 px-5 pt-5 md:pt-13",
            floating ? "pb-22" : "pb-13",
            width === "wide" ? "max-w-5xl" : "max-w-3xl",
          )}
        >
          {cover}
          <header
            className={cn(
              "flex items-center justify-between gap-3",
              centered && "justify-center text-center",
            )}
          >
            <h1 className="min-w-0 text-lg font-medium">{title}</h1>
            {actions && (
              <div className="flex items-center gap-1">{actions}</div>
            )}
          </header>
          {children}
        </div>
      </div>
      {floating && <FloatingLayer>{floating}</FloatingLayer>}
    </div>
  );
}

// The floating chat's layer over a page (or an empty page): centered on the
// reading column, 16px above the bottom. Only the bar takes clicks; the
// space around it passes them on.
export function FloatingLayer({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-5 pb-4">
      <div className="mx-auto w-full max-w-3xl">{children}</div>
    </div>
  );
}
