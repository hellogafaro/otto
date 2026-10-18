import { useEffect, useRef } from "react";
import type * as React from "react";

import { cn } from "~/lib/utils";

import { type DataTablePaging, scrollParent } from "./data-table";

/**
 * Otto: The shared card gallery. One column on phones, two from `sm`, three
 * from `lg`, with 16px gutters and 24px between rows. It only lays items
 * out; `renderItem` draws each card. A paged grid asks for its next page
 * once its end comes within one screen of the view.
 */
export function DataGrid<T>({
  items,
  getItemKey,
  renderItem,
  paging,
  className,
}: {
  readonly items: readonly T[];
  readonly getItemKey: (item: T) => string;
  readonly renderItem: (item: T) => React.ReactNode;
  readonly paging?: DataTablePaging;
  readonly className?: string;
}) {
  const end = useRef<HTMLDivElement>(null);
  const hasMore = paging?.hasMore ?? false;
  const loading = paging?.loading ?? false;
  const onLoadMore = paging?.onLoadMore;

  useEffect(() => {
    const element = end.current;

    if (!element || !hasMore || loading || !onLoadMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      { root: scrollParent(element), rootMargin: "0px 0px 100% 0px" },
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, [hasMore, loading, onLoadMore]);

  return (
    <>
      <ul
        className={cn("grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3", className)}
      >
        {items.map((item) => (
          <li key={getItemKey(item)} className="min-w-0 list-none">
            {renderItem(item)}
          </li>
        ))}
      </ul>
      {paging ? <div ref={end} aria-hidden /> : null}
    </>
  );
}
