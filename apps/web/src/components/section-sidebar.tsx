import type { ReactNode } from "react";

// A section's own navigation (Chats), on the frame beside the rail: the layer
// below the card, so it takes the frame's tone, divided from the rail by a
// hairline. Its 40px header lines up with the card's top bar (8px down, like
// the card; flush under the desktop strip). Rows and the header sit 8px from
// its sides, so the gap to the card matches the card's margins.
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
  return (
    // The sidebar width (280px) shared with the right panel.
    <aside className="flex w-(--sidebar-width) shrink-0 flex-col border-l border-border pt-2 group-data-desktop/sidebar-wrapper:pt-0">
      <header className="flex h-10 shrink-0 items-center justify-between gap-1 px-2">
        {/* pl-2 puts the title on the rows' icon line. */}
        <h2 className="truncate pl-2 text-sm font-medium">{title}</h2>
        {actions && <div className="flex items-center gap-1">{actions}</div>}
      </header>
      <nav
        aria-label={title}
        className="no-scrollbar flex min-h-0 flex-1 scroll-fade-y flex-col gap-3 overflow-y-auto px-2 pb-2"
      >
        {children}
      </nav>
    </aside>
  );
}
