import type { ReactNode } from "react";

// Optional bar above a page: breadcrumb on the left, icon actions on the right.
// 32px controls 4px apart, 4px from every edge, so it is 40px tall and its
// 8px button corners nest in the card's 12px corner (8 + 4).
export function Topbar({
  children,
  actions,
}: {
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-3 p-1">
      <div className="min-w-0">{children}</div>
      {actions && <div className="flex items-center gap-1">{actions}</div>}
    </header>
  );
}
