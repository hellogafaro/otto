import type { ListOrder } from "@otto/contracts";

export interface ListSortKey {
  readonly sql: string;
  readonly direction: ListOrder;
  /** Kept whichever way the list runs, such as undated tasks staying last. */
  readonly fixed?: true;
}

/** A sort's natural order and its keys; the row id comes last so every row has a place. */
export interface ListSortSql {
  readonly natural: ListOrder;
  readonly keys: readonly ListSortKey[];
}

/** The `bot:<id>` or `person:<id>` key of a participant stored as JSON. */
export const participantKeySql = (json: string) =>
  `CASE json_extract(${json}, '$.kind') WHEN 'bot' THEN 'bot:' || json_extract(${json}, '$.botId') ELSE 'person:' || json_extract(${json}, '$.personId') END`;

/**
 * How one page of a list is ordered in `order`: its ORDER BY, each row's sort key as a JSON
 * array, and the keyset condition for rows strictly after a cursor's key, comparing one sort key
 * at a time.
 */
export function listPageSql(
  sort: ListSortSql,
  order: ListOrder | undefined,
  after: ReadonlyArray<string | number> | null,
) {
  const reversed = order !== undefined && order !== sort.natural;

  const keys = sort.keys.map((key) => ({
    sql: key.sql,
    direction: reversed && !key.fixed ? (key.direction === "asc" ? "desc" : "asc") : key.direction,
  }));

  const page = {
    orderBy: keys.map((key) => `${key.sql} ${key.direction.toUpperCase()}`).join(", "),
    sortKey: `json_array(${keys.map((key) => key.sql).join(", ")})`,
  };

  if (after === null || after.length !== keys.length) return { ...page, after: null };

  return {
    ...page,
    after: {
      condition: `(${keys
        .map((key, index) =>
          [
            ...keys.slice(0, index).map((earlier) => `${earlier.sql} = ?`),
            `${key.sql} ${key.direction === "asc" ? ">" : "<"} ?`,
          ].join(" AND "),
        )
        .join(" OR ")})`,
      params: keys.flatMap((_, index) => after.slice(0, index + 1)),
    },
  };
}
