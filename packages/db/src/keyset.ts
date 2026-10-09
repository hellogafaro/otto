import {
  DomainError,
  filterPage,
  getPage,
  parsePageOptions,
} from "@otto/shared";
import { type AnyColumn, asc, desc, gt, type SQL, sql } from "drizzle-orm";
import {
  type CursorCodec,
  cursorContext,
  type Order,
  parseSortInput,
} from "./cursor";

type SortType = "text" | "timestamp" | "integer";
/** One sortable field: its ordering expression and its position as text, which keeps timestamp microseconds. */
export interface SortKey {
  type: SortType;
  value: SQL;
  position: SQL<string | null>;
}
/** Full value, case-insensitive; the id tie-break keeps equal titles in a total order. */
export const textKey = (column: AnyColumn | SQL): SortKey => {
  const value = sql`lower(${column})`;
  return { type: "text", value, position: sql<string | null>`${value}` };
};
export const timeKey = (column: AnyColumn): SortKey => ({
  type: "timestamp",
  value: sql`${column}`,
  position: sql<
    string | null
  >`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
});
export const intKey = (column: AnyColumn): SortKey => ({
  type: "integer",
  value: sql`${column}`,
  position: sql<string | null>`${column}::text`,
});
export const sortNames = <K extends Record<string, SortKey>>(keys: K) =>
  Object.keys(keys) as [keyof K & string, ...(keyof K & string)[]];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSITION: Record<SortType, (value: string) => boolean> = {
  text: () => true,
  timestamp: (value) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value),
  integer: (value) =>
    /^-?\d{1,10}$/.test(value) && Math.abs(Number(value)) <= 2147483647,
};
const cast = (type: SortType, value: string) =>
  type === "timestamp"
    ? sql`${value}::timestamptz`
    : type === "integer"
      ? sql`${value}::integer`
      : sql`${value}`;

/**
 * Keyset paging for one list. Without `sort` it is the existing id-ascending order with a plain id cursor.
 * With `sort` the order is `value, id` (NULLs last, the id in the same direction) applied before the limit,
 * and the cursor is the sealed typed position of the last scanned row, never a row to look up, so a deleted
 * row still continues. The filter fields are bound into the sealed cursor.
 */
export function sortPlan<K extends Record<string, SortKey>>(options: {
  operation: string;
  scope: {
    workspaceId: string;
    actor: { userId: string; agentId?: string };
    cursors?: CursorCodec;
  };
  /** The whole request: paging and sort fields plus every filter, with defaults already applied. */
  filter: {
    sort?: string;
    order?: string;
    after?: string;
    limit?: number;
  } & object;
  keys: K;
  id: AnyColumn;
  idKind?: "uuid" | "text";
}) {
  const { limit } = parsePageOptions({ limit: options.filter.limit });
  const selected = parseSortInput(options.filter, sortNames(options.keys));
  if (!selected) {
    const { after } = parsePageOptions(
      { after: options.filter.after },
      options.idKind,
    );
    return {
      limit,
      where: after ? gt(options.id, after) : undefined,
      orderBy: [asc(options.id)],
      position: sql<string | null>`null`,
      sorted: false,
      cursor: (id: string, _position: string | null) => id,
    };
  }
  const { cursors } = options.scope;
  if (!cursors) throw new DomainError("unavailable", "Sorting not configured");
  const key = options.keys[selected.sort] as SortKey;
  const context = cursorContext(
    options.operation,
    options.scope,
    selected,
    options.filter,
  );
  let where: SQL | undefined;
  if (options.filter.after !== undefined) {
    const [sort, order, id, position, ...rest] = cursors.open(
      options.filter.after,
      context,
    );
    if (
      sort !== selected.sort ||
      order !== selected.order ||
      rest.length ||
      typeof id !== "string" ||
      (options.idKind === "text" ? !id || id.length > 128 : !UUID.test(id)) ||
      (position !== null &&
        (typeof position !== "string" || !POSITION[key.type](position)))
    )
      throw new DomainError("invalid", "Invalid page position or limit");
    const after = order === "asc" ? sql`>` : sql`<`;
    const value = position === null ? null : cast(key.type, position);
    where =
      value === null
        ? sql`(${key.value} is null and ${options.id} ${after} ${id})`
        : sql`(${key.value} ${after} ${value} or (${key.value} = ${value} and ${options.id} ${after} ${id}) or ${key.value} is null)`;
  }
  const direction: Order = selected.order;
  return {
    limit,
    where,
    orderBy: [
      sql`${key.value} ${sql.raw(direction)} nulls last`,
      direction === "asc" ? asc(options.id) : desc(options.id),
    ],
    position: key.position,
    sorted: true,
    cursor: (id: string, position: string | null) =>
      cursors.seal([selected.sort, selected.order, id, position], context),
  };
}

/** Basic word search over one text expression; the same match every existing `query` uses. */
export const matchesText = (text: SQL | AnyColumn, query: string) =>
  sql`to_tsvector('simple', ${text}) @@ plainto_tsquery('simple', ${query})`;

/** One page of a plan's rows: the continuation comes from the last scanned row; the position never reaches the caller. */
export function pageOf<T extends { position: string | null }>(
  rows: readonly T[],
  plan: {
    limit: number;
    cursor: (id: string, position: string | null) => string;
  },
  id: (row: T) => string,
) {
  const page = getPage(
    rows,
    (row) => plan.cursor(id(row), row.position),
    plan.limit,
  );
  return {
    items: page.items.map(({ position: _position, ...row }) => row),
    next: page.next,
  };
}

/**
 * Authority check of one scanned page. Id order skips a denied row. A sorted page must never scan a row the
 * caller cannot read (the SQL already narrowed to readable rows), so a denial there means the narrowing and the
 * domain check disagree: fail closed with no cursor rather than emit a position that names a hidden row.
 * Reads hold the workspace lock `FOR SHARE` and every authority write holds it `FOR UPDATE`, so a denial
 * is never a concurrent change.
 */
export async function authorizedPage<T, U, Cursor extends string | number>(
  page: { items: T[]; next: Cursor | null },
  resolve: (item: T) => Promise<U>,
  plan: { sorted: boolean },
) {
  if (!plan.sorted) return filterPage(page, resolve);
  const items: U[] = [];
  for (const item of page.items) {
    try {
      items.push(await resolve(item));
    } catch (error) {
      if (error instanceof DomainError && error.code === "forbidden")
        throw new DomainError(
          "unavailable",
          "Sorted page disagreed with current authority",
        );
      throw error;
    }
  }
  return { items, next: page.next };
}
