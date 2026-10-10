import type { ReactNode } from "react";

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
