import type { ListOrder } from "@otto/contracts";

export interface ListSortKey {
  readonly sql: string;
  readonly direction: ListOrder;
  /** Kept whichever way the list runs, such as undated tasks last or folders first. */
  readonly fixed?: true;
}

/** A sort's natural order and its keys; the row id comes last so every row has a place. */
export interface ListSortSpec {
  readonly natural: ListOrder;
  readonly keys: ReadonlyArray<ListSortKey>;
}

/**
 * A list's sort run in `order`: the SQL for its key and its ORDER BY, and the keyset condition
 * that keeps only rows strictly after `after`, comparing one sort key at a time.
 */
export function listKeyset(
  sort: ListSortSpec,
  order: ListOrder | undefined,
  after: ReadonlyArray<string | number> | null,
) {
  const reversed = order !== undefined && order !== sort.natural;

  const keys = sort.keys.map((key) => ({
    sql: key.sql,
    direction: reversed && !key.fixed ? (key.direction === "asc" ? "desc" : "asc") : key.direction,
  }));

  return {
    sortKeySql: `json_array(${keys.map((key) => key.sql).join(", ")})`,
    orderBySql: keys.map((key) => `${key.sql} ${key.direction.toUpperCase()}`).join(", "),
    after:
      after !== null && after.length === keys.length
        ? {
            sql: `(${keys
              .map((key, index) =>
                [
                  ...keys.slice(0, index).map((earlier) => `${earlier.sql} = ?`),
                  `${key.sql} ${key.direction === "asc" ? ">" : "<"} ?`,
                ].join(" AND "),
              )
              .join(" OR ")})`,
            params: keys.flatMap((_, index) => after.slice(0, index + 1)),
          }
        : null,
  };
}
