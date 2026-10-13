import type * as React from "react";

import { cn } from "~/lib/utils";

/**
 * Otto: The shared card gallery. One column on phones, two from `sm`, three
 * from `lg`, with 16px gutters and 24px between rows. It only lays items
 * out; `renderItem` draws each card.
 */
export function DataGrid<T>({
  items,
  getItemKey,
  renderItem,
  className,
}: {
  readonly items: readonly T[];
  readonly getItemKey: (item: T) => string;
  readonly renderItem: (item: T) => React.ReactNode;
  readonly className?: string;
}) {
  return (
    <ul className={cn("grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {items.map((item) => (
        <li key={getItemKey(item)} className="min-w-0 list-none">
          {renderItem(item)}
        </li>
      ))}
    </ul>
  );
}
