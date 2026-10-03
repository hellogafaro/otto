import type { ReactNode } from "react";

// Optional bar above a page: breadcrumb on the left, icon actions on the right.
// Same padding rule as the rail (p-2, gap-1) around 32px controls, so it is
// 48px tall and every visible edge sits 9px in.
export function Topbar({
  children,
  actions,
}: {
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-3 p-2">
      <div className="min-w-0">{children}</div>
      {actions && <div className="flex items-center gap-1">{actions}</div>}
    </header>
  );
}
