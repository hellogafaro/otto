import { RiArrowDownSLine } from "@remixicon/react";
import { useState } from "react";
import type * as React from "react";

import { cn } from "~/lib/utils";

/**
 * A column's role sets its geometry and type, as in Capy's thread list:
 * `icon` a 16px slot with a 14px glyph, `title` the 13px line that takes the
 * remaining width and fades out when it overflows, `meta` 13px secondary
 * text, `chips` a row of pills that hides in narrow lists, `time` a 56px
 * right-aligned 12px stamp. Without a type the cell is laid out by `className`.
 * There is no header row: the row's `getRowLabel` names it for assistive tech.
 */
export type DataTableColumnType = "icon" | "title" | "meta" | "chips" | "time";

export interface DataTableColumn<T> {
  readonly id: string;
  readonly type?: DataTableColumnType;
  readonly cell: (row: T) => React.ReactNode;
  readonly className?: string;
}

export interface DataTableGroup {
  readonly id: string;
  readonly label: React.ReactNode;
  readonly icon?: React.ReactNode;
}

const SECONDARY_TEXT = "text-foreground/52";

const COLUMN_CLASS: Record<DataTableColumnType, string> = {
  icon: cn("w-4 justify-center translate-y-px [&_svg]:size-3.5", SECONDARY_TEXT),
  title:
    "min-w-0 flex-1 text-13px font-normal tracking-title-sm text-foreground/80 dark:text-foreground/68",
  meta: cn(
    "text-13px font-normal tracking-title-sm whitespace-nowrap tabular-nums",
    SECONDARY_TEXT,
  ),
  chips: "hidden gap-1.5 @lg/list:flex",
  time: cn(
    "w-14 min-w-6 justify-end text-xs font-normal whitespace-nowrap tabular-nums",
    SECONDARY_TEXT,
  ),
};

/**
 * Otto: The shared data table, copied from Capy's thread list. Rows are 44px
 * with a 2px hit margin, 8px inset, 8px column gap, 6px radius and a 3.5%
 * foreground wash on hover. Groups get Capy's 36px section band (8px radius,
 * the same wash, chevron, 13px label, count) and collapse on click.
 */
export function DataTable<T>({
  rows,
  columns,
  getRowKey,
  getRowLabel,
  onRowClick,
  groupBy,
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
  };
  readonly className?: string;
}) {
  const list = (items: readonly T[]) => (
    <ul className="flex flex-col pt-1">
      {items.map((row) => (
        <DataTableRow
          key={getRowKey(row)}
          row={row}
          columns={columns}
          label={getRowLabel(row)}
          onClick={onRowClick}
        />
      ))}
    </ul>
  );

  return (
    <div className={cn("@container/list flex flex-col gap-2 px-2", className)}>
      {groupBy
        ? groupBy.groups.map((group) => {
            const items = rows.filter((row) => groupBy.getGroupId(row) === group.id);

            return items.length === 0 ? null : (
              <DataTableSection key={group.id} group={group} count={items.length}>
                {list(items)}
              </DataTableSection>
            );
          })
        : list(rows)}
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
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-(--radius) bg-foreground/[0.035] px-2 text-left text-13px font-medium tracking-title-sm text-foreground outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&_svg]:shrink-0"
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
      {open ? children : null}
    </section>
  );
}

function DataTableRow<T>({
  row,
  columns,
  label,
  onClick,
}: {
  readonly row: T;
  readonly columns: readonly DataTableColumn<T>[];
  readonly label: string;
  readonly onClick: ((row: T) => void) | undefined;
}) {
  const cells = columns.map((column) => (
    <span
      key={column.id}
      className={cn(
        "flex shrink-0 items-center",
        column.type && COLUMN_CLASS[column.type],
        column.className,
      )}
    >
      {column.type === "title" ? (
        <span className="mask-fade-r min-w-0 overflow-hidden whitespace-nowrap">
          {column.cell(row)}
        </span>
      ) : (
        column.cell(row)
      )}
    </span>
  ));

  const rowClassName =
    "flex h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-foreground outline-none select-none";

  return (
    <li className="-m-0.5 list-none p-0.5">
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
