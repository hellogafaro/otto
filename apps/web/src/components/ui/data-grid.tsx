import { useEffect, useRef } from "react";
import type * as React from "react";

import { cn } from "~/lib/utils";
import { type DataTablePaging, scrollParent } from "./data-table";

/**
 * Otto: The shared card gallery. One column on phones, two from `sm`, three
 * from `lg`, with 16px gutters and 24px between rows. It only lays items
 * out; `renderItem` draws each card. A gallery read page by page from the
 * server passes `paging`, and the next page loads while the last card is
 * less than a screen below the view. The card J and K hold (`highlightedKey`) carries
 * `data-row-highlighted`, so a card styles it with `in-data-row-highlighted:` like its hover.
 */
export function DataGrid<T>({
  items,
  getItemKey,
  renderItem,
  paging,
  highlightedKey = null,
  className,
}: {
  readonly items: readonly T[];
  readonly getItemKey: (item: T) => string;
  readonly renderItem: (item: T) => React.ReactNode;
  readonly paging?: DataTablePaging;
  readonly highlightedKey?: string | null;
  readonly className?: string;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const hasMore = paging?.hasMore ?? false;
  const loading = paging?.loading ?? false;
  const onLoadMore = paging?.onLoadMore;

  useEffect(() => {
    const last = listRef.current?.lastElementChild;

    if (!last || !hasMore || loading || !onLoadMore) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) onLoadMore();
      },
      { root: scrollParent(listRef.current), rootMargin: "0px 0px 100% 0px" },
    );

    observer.observe(last);

    return () => observer.disconnect();
  }, [hasMore, loading, onLoadMore, items.length]);

  return (
    <ul
      ref={listRef}
      className={cn("grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3", className)}
    >
      {items.map((item) => (
        <li
          key={getItemKey(item)}
          data-row-key={getItemKey(item)}
          data-row-highlighted={getItemKey(item) === highlightedKey ? "" : undefined}
          className="min-w-0 list-none"
        >
          {renderItem(item)}
        </li>
      ))}
    </ul>
  );
}
