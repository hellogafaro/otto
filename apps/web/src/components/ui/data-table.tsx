import { RiArrowDownSLine } from "@remixicon/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type * as React from "react";

import { cn } from "~/lib/utils";

/**
 * A column's role sets its geometry and type, as in Capy's thread list:
 * `icon` a 16px slot with a 14px glyph, `title` the 13px line that takes the
 * remaining width and fades out when it overflows, `meta` 13px secondary
 * text, `chips` a row of pills 6px apart that hides in narrow lists, `time` a
 * 12px stamp. Without a type the cell is laid out by `className`.
 * A table has no header row unless a column names one with `header`; the row's `getRowLabel`
 * names it for assistive tech either way.
 */
export type DataTableColumnType = "icon" | "title" | "meta" | "chips" | "time";

export interface DataTableColumn<T> {
  readonly id: string;
  readonly type?: DataTableColumnType;
  readonly cell: (row: T) => React.ReactNode;
  /** Otto: the column's label in the header band; any column with one turns the band on. */
  readonly header?: React.ReactNode;
  /**
   * Otto: on a `title` column, content that follows the title text at the column gap, such as
   * who it belongs to, instead of a column at the far right; it never fades with the title.
   */
  readonly after?: (row: T) => React.ReactNode;
  readonly className?: string;
}

export interface DataTableGroup {
  readonly id: string;
  readonly label: React.ReactNode;
  readonly icon?: React.ReactNode;
}

const SECONDARY_TEXT = "text-foreground/52";

/** Where a column sits and how wide it is, shared by its cells and its header. */
const COLUMN_LAYOUT: Record<DataTableColumnType, string> = {
  icon: "w-4 justify-center",
  title: "min-w-0 flex-1",
  meta: "whitespace-nowrap",
  chips: "hidden gap-1.5 @lg/list:flex",
  time: "justify-end whitespace-nowrap",
};

const COLUMN_TEXT: Record<DataTableColumnType, string> = {
  icon: cn("translate-y-px [&_svg]:size-3.5", SECONDARY_TEXT),
  title: "text-13px font-normal tracking-title-sm text-foreground/80 dark:text-foreground/68",
  meta: cn("text-13px font-normal tracking-title-sm tabular-nums", SECONDARY_TEXT),
  chips: "",
  time: cn("text-xs font-normal tabular-nums", SECONDARY_TEXT),
};

const ROW_CLASS = "flex w-full items-center gap-6 rounded-md px-4 text-left";

/**
 * Otto: Linear's two root groups. The title and what leads it sit left; the rest sit right as
 * their own groups (chips, time) 12px apart, while items inside a group stay 6-8px apart.
 * Header bands and rows split columns the same way, so a header sits over its cells.
 */
function RowGroups<T>({
  columns,
  render,
}: {
  readonly columns: readonly DataTableColumn<T>[];
  readonly render: (column: DataTableColumn<T>) => React.ReactNode;
}) {
  const titleIndex = columns.findIndex((column) => column.type === "title");
  const right = titleIndex === -1 ? [] : columns.slice(titleIndex + 1);

  return (
    <>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {columns.slice(0, titleIndex === -1 ? columns.length : titleIndex + 1).map(render)}
      </span>
      {right.length > 0 ? (
        <span className="flex shrink-0 items-center gap-3">{right.map(render)}</span>
      ) : null}
    </>
  );
}

/**
 * Otto: The shared data table, copied from Capy's thread list. Rows are 44px
 * with a 2px hit margin, a left and a right group at least 24px apart, 6px radius and a 3.5% foreground wash
 * on hover. Groups get Capy's 36px section band (6px radius, the same wash,
 * chevron, 13px label, count) and collapse on click. Fills span the whole
 * column like content rows, with 16px inside, so text and the band's chevron
 * sit on the content edge and the time ends 16px from the right. The row J and K hold
 * (`highlightedKey`) wears the hover wash.
 */
export function DataTable<T>({
  rows,
  columns,
  getRowKey,
  getRowLabel,
  onRowClick,
  groupBy,
  paging,
  highlightedKey = null,
  className,
}: {
  readonly rows: readonly T[];
  readonly columns: readonly DataTableColumn<T>[];
  readonly getRowKey: (row: T) => string;
  /** Accessible name of each row. */
  readonly getRowLabel: (row: T) => string;
  readonly onRowClick?: (row: T) => void;
  /** Groups in display order; a group without rows is skipped. */
  readonly groupBy?: {
    readonly groups: readonly DataTableGroup[];
    readonly getGroupId: (row: T) => string;
    /** A group's full size when `rows` holds only the pages loaded so far. */
    readonly getGroupCount?: (groupId: string) => number;
  };
  /** A list read page by page from the server: its rows are virtualized and load as they near view. */
  readonly paging?: DataTablePaging;
  readonly highlightedKey?: string | null;
  readonly className?: string;
}) {
  const hasHeader = columns.some((column) => column.header !== undefined);

  if (paging) {
    return (
      <VirtualDataTable
        rows={rows}
        columns={columns}
        getRowKey={getRowKey}
        getRowLabel={getRowLabel}
        onRowClick={onRowClick}
        groupBy={groupBy}
        paging={paging}
        highlightedKey={highlightedKey}
        className={className}
      />
    );
  }

  // Otto: rows sit 4px under a group band, but straight under a header band, whose own height
  // already spaces them; a header is part of its table, not a section of it.
  const list = (items: readonly T[], spaced: boolean) => (
    <ul className={cn("flex flex-col", spaced && "pt-1")}>
      {items.map((row) => (
        <DataTableRow
          key={getRowKey(row)}
          rowKey={getRowKey(row)}
          row={row}
          columns={columns}
          label={getRowLabel(row)}
          highlighted={getRowKey(row) === highlightedKey}
          onClick={onRowClick}
        />
      ))}
    </ul>
  );

  return (
    <div className={cn("@container/list flex flex-col", !hasHeader && "gap-2", className)}>
      {hasHeader ? (
        <div
          data-slot="data-table-header"
          className={cn(
            ROW_CLASS,
            "h-9 bg-foreground/[0.035] text-xs font-normal tracking-title-sm select-none",
            SECONDARY_TEXT,
          )}
        >
          <RowGroups
            // Otto: header-less columns before the title (icons, avatars) give their room to the
            // title's label, so it starts on the content edge.
            columns={columns.filter(
              (column, index) =>
                index >= columns.findIndex((candidate) => candidate.type === "title") ||
                column.header !== undefined,
            )}
            render={(column) => (
              <span
                key={column.id}
                className={cn(
                  "flex shrink-0 items-center",
                  column.type && COLUMN_LAYOUT[column.type],
                  column.className,
                )}
              >
                {column.header}
              </span>
            )}
          />
        </div>
      ) : null}
      {groupBy
        ? groupBy.groups.map((group) => {
            const items = rows.filter((row) => groupBy.getGroupId(row) === group.id);

            return items.length === 0 ? null : (
              <DataTableSection key={group.id} group={group} count={items.length}>
                {list(items, true)}
              </DataTableSection>
            );
          })
        : list(rows, !hasHeader)}
    </div>
  );
}

export interface DataTablePaging {
  readonly hasMore: boolean;
  readonly loading: boolean;
  readonly onLoadMore: () => void;
}

const ROW_HEIGHT = 44;

const BAND_HEIGHT = 36;

/** Rows sit 4px under their group's band, and groups 8px apart. */
const BAND_GAP_BELOW = 4;

const GROUP_GAP = 8;

/** Start loading the next page while this many rows are still below the view. */
const LOAD_AHEAD_ROWS = 20;

type VirtualItem<T> =
  | { readonly type: "group"; readonly group: DataTableGroup; readonly count: number }
  | { readonly type: "row"; readonly row: T };

function scrollParent(element: HTMLElement | null): HTMLElement | null {
  for (let parent = element?.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent;
  }

  return null;
}

/**
 * Otto: The paged table renders only the rows near the view, inside the page's own scroll
 * container, so a list of thousands costs what a screenful does. Bands and rows keep the plain
 * table's geometry; the next page loads when fewer than 20 rows remain below the view.
 */
function VirtualDataTable<T>({
  rows,
  columns,
  getRowKey,
  getRowLabel,
  onRowClick,
  groupBy,
  paging,
  highlightedKey,
  className,
}: {
  readonly rows: readonly T[];
  readonly columns: readonly DataTableColumn<T>[];
  readonly getRowKey: (row: T) => string;
  readonly getRowLabel: (row: T) => string;
  readonly onRowClick: ((row: T) => void) | undefined;
  readonly groupBy:
    | {
        readonly groups: readonly DataTableGroup[];
        readonly getGroupId: (row: T) => string;
        readonly getGroupCount?: (groupId: string) => number;
      }
    | undefined;
  readonly paging: DataTablePaging;
  readonly highlightedKey: string | null;
  readonly className: string | undefined;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const items: VirtualItem<T>[] = groupBy
    ? groupBy.groups.flatMap((group) => {
        const inGroup = rows.filter((row) => groupBy.getGroupId(row) === group.id);

        if (inGroup.length === 0) return [];

        const band: VirtualItem<T> = {
          type: "group",
          group,
          count: groupBy.getGroupCount?.(group.id) ?? inGroup.length,
        };

        return collapsed.has(group.id)
          ? [band]
          : [band, ...inGroup.map((row): VirtualItem<T> => ({ type: "row", row }))];
      })
    : rows.map((row) => ({ type: "row", row }));

  useLayoutEffect(() => {
    const element = listRef.current;
    const parent = scrollParent(element);
    setScroller(parent);

    if (!element || !parent) return;

    const measure = () =>
      setScrollMargin(
        element.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.scrollTop,
      );

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const groupSize = (index: number, item: VirtualItem<T>) =>
    (index === 0 ? 0 : GROUP_GAP) +
    BAND_HEIGHT +
    (item.type === "group" && !collapsed.has(item.group.id) ? BAND_GAP_BELOW : 0);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller,
    estimateSize: (index) => {
      const item = items[index]!;

      return item.type === "group" ? groupSize(index, item) : ROW_HEIGHT;
    },
    getItemKey: (index) => {
      const item = items[index]!;

      return item.type === "group" ? `group:${item.group.id}` : getRowKey(item.row);
    },
    overscan: 10,
    scrollMargin,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const lastIndex = virtualItems.at(-1)?.index ?? -1;
  const { hasMore, loading, onLoadMore } = paging;

  useEffect(() => {
    if (hasMore && !loading && lastIndex >= items.length - LOAD_AHEAD_ROWS) onLoadMore();
  }, [hasMore, loading, lastIndex, items.length, onLoadMore]);

  useEffect(() => virtualizer.measure(), [virtualizer, collapsed]);

  return (
    <div className={cn("@container/list flex flex-col", className)}>
      <div
        ref={listRef}
        role="list"
        className="relative h-(--list-height) w-full"
        style={{ "--list-height": `${virtualizer.getTotalSize()}px` }}
      >
        {virtualItems.map((virtualItem) => {
          const item = items[virtualItem.index]!;

          return (
            <div
              key={virtualItem.key}
              role="listitem"
              className="absolute inset-x-0 top-(--item-top) h-(--item-height)"
              style={{
                "--item-top": `${virtualItem.start - scrollMargin}px`,
                "--item-height": `${virtualItem.size}px`,
              }}
            >
              {item.type === "group" ? (
                <div
                  className={cn(
                    "flex flex-col",
                    virtualItem.index > 0 && "pt-2",
                    !collapsed.has(item.group.id) && "pb-1",
                  )}
                >
                  <DataTableGroupBand
                    group={item.group}
                    count={item.count}
                    open={!collapsed.has(item.group.id)}
                    onToggle={() =>
                      setCollapsed((current) => {
                        const next = new Set(current);

                        if (!next.delete(item.group.id)) next.add(item.group.id);

                        return next;
                      })
                    }
                  />
                </div>
              ) : (
                <ul className="flex flex-col">
                  <DataTableRow
                    rowKey={getRowKey(item.row)}
                    row={item.row}
                    columns={columns}
                    label={getRowLabel(item.row)}
                    highlighted={getRowKey(item.row) === highlightedKey}
                    onClick={onRowClick}
                  />
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DataTableSection({
  group,
  count,
  children,
}: {
  readonly group: DataTableGroup;
  readonly count: number;
  readonly children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);

  return (
    <section className="flex flex-col">
      <DataTableGroupBand group={group} count={count} open={open} onToggle={() => setOpen(!open)} />
      {open ? children : null}
    </section>
  );
}

function DataTableGroupBand({
  group,
  count,
  open,
  onToggle,
}: {
  readonly group: DataTableGroup;
  readonly count: number;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-md bg-foreground/[0.035] ps-3.5 pe-4 text-left text-13px font-medium tracking-title-sm text-foreground outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&_svg]:shrink-0"
    >
      <span className="flex w-4 shrink-0 items-center justify-center">
        <RiArrowDownSLine
          aria-hidden
          className={cn(
            "size-3 text-foreground/38 transition-transform duration-100 motion-reduce:transition-none",
            !open && "-rotate-90",
          )}
        />
      </span>
      {group.icon ? (
        <span className="flex w-4 shrink-0 items-center justify-center [&_svg]:size-3.5">
          {group.icon}
        </span>
      ) : null}
      <span className="truncate">{group.label}</span>
      <span className={cn("font-normal tabular-nums", SECONDARY_TEXT)}>{count}</span>
    </button>
  );
}

function DataTableRow<T>({
  rowKey,
  row,
  columns,
  label,
  highlighted,
  onClick,
}: {
  readonly rowKey: string;
  readonly row: T;
  readonly columns: readonly DataTableColumn<T>[];
  readonly label: string;
  readonly highlighted: boolean;
  readonly onClick: ((row: T) => void) | undefined;
}) {
  const cell = (column: DataTableColumn<T>) => (
    <span
      key={column.id}
      className={cn(
        "flex shrink-0 items-center",
        column.type && COLUMN_LAYOUT[column.type],
        column.type && COLUMN_TEXT[column.type],
        column.className,
      )}
    >
      {column.type === "title" ? (
        <span className="flex min-w-0 items-center gap-2">
          <span className="mask-fade-r min-w-0 overflow-hidden whitespace-nowrap">
            {column.cell(row)}
          </span>
          {column.after ? <span className="flex shrink-0">{column.after(row)}</span> : null}
        </span>
      ) : (
        column.cell(row)
      )}
    </span>
  );

  const cells = <RowGroups columns={columns} render={cell} />;

  const rowClassName = cn(
    ROW_CLASS,
    "h-11 text-sm text-foreground outline-none select-none",
    highlighted && "bg-foreground/[0.035]",
  );

  return (
    <li data-row-key={rowKey} className="-m-0.5 list-none p-0.5">
      {onClick ? (
        <button
          type="button"
          aria-label={label}
          onClick={() => onClick(row)}
          className={cn(
            rowClassName,
            "cursor-pointer transition-colors duration-100 hover:bg-foreground/[0.035] focus-visible:bg-foreground/[0.035] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none",
          )}
        >
          {cells}
        </button>
      ) : (
        <div className={rowClassName}>{cells}</div>
      )}
    </li>
  );
}

/** Capy's 24px row pill for a short label such as a project or a date. */
export function DataTableChip({
  tone = "default",
  className,
  ...props
}: React.ComponentProps<"span"> & { readonly tone?: "default" | "error" }) {
  return (
    <span
      className={cn(
        tone === "error" ? "text-error" : "text-foreground",
        "inline-flex h-6 max-w-48 min-w-8 items-center justify-center gap-1 rounded-full border border-control-border bg-control px-2 text-xs font-normal whitespace-nowrap [&_svg]:-ms-0.5 [&_svg]:size-3.5 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}
