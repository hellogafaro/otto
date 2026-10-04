import { useRouterState } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@workspace/ui/components/sheet";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import { type ReactNode, useEffect, useState } from "react";

// The left panel: a section's own navigation (Chats), inside the card like
// the right panel and mirroring it: the card's color, divided from the page
// by a hairline, a 40px header level with the page's top bar (its title on
// the right panel's 16px line). The rail stays alone on the frame. Left for
// navigating the section, right for details.
export function SectionSidebar({
  title,
  actions,
  children,
}: {
  title: string;
  /** Ghost icon buttons on the header's right (New …). */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const location = useRouterState({ select: (state) => state.location.href });
  useEffect(() => {
    if (location) setOpen(false);
  }, [location]);
  const navigation = (
    <nav
      aria-label={title}
      className="no-scrollbar flex min-h-0 flex-1 scroll-fade-y flex-col gap-3 overflow-y-auto px-2 pb-2"
    >
      {children}
    </nav>
  );
  if (mobile)
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <header className="flex h-10 shrink-0 items-center justify-between px-2">
          <SheetTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Open ${title} navigation`}
              />
            }
          >
            {title}
          </SheetTrigger>
          {actions}
        </header>
        <SheetContent side="left">
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>
          {navigation}
        </SheetContent>
      </Sheet>
    );
  return (
    // The sidebar width (280px) shared with the right panel.
    <aside className="flex w-(--sidebar-width) shrink-0 flex-col border-r">
      <header className="flex h-10 shrink-0 items-center justify-between gap-1 px-2">
        {/* pl-2 puts the title on the rows' icon line. */}
        <h2 className="truncate pl-2 text-sm font-medium">{title}</h2>
        {actions && <div className="flex items-center gap-1">{actions}</div>}
      </header>
      {navigation}
    </aside>
  );
}
