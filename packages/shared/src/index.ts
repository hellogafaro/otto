export class DomainError extends Error {
  constructor(
    public readonly code:
      | "forbidden"
      | "not_found"
      | "conflict"
      | "unavailable"
      | "invalid",
    message: string = code,
  ) {
    super(message);
  }
}
/** Requires a returned record without hiding a failed write or absent record. */
export function required<T>(
  value: T | undefined,
  code: ConstructorParameters<typeof DomainError>[0] = "not_found",
): T {
  if (value === undefined) throw new DomainError(code);
  return value;
}

/** Validate domain inputs without exposing validator details or invalid values. */
export function parseInput<T>(
  schema: {
    safeParse(input: unknown): { success: true; data: T } | { success: false };
  },
  input: unknown,
): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid");
  return parsed.data;
}

export interface PageOptions {
  after?: string;
  limit?: number;
}
/** Validate common discovery bounds; domain-specific IDs remain validated at their input boundary. */
export function parsePageOptions(
  input: PageOptions = {},
  cursor: "uuid" | "text" = "uuid",
) {
  const limit = input.limit ?? 100;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (input.after !== undefined &&
      (!input.after ||
        input.after.length > 128 ||
        (cursor === "uuid" &&
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            input.after,
          ))))
  )
    throw new DomainError("invalid", "Invalid page position or limit");
  return { after: input.after, limit };
}
/** Consume a limit+1 candidate query. Authorization filtering happens after this page is selected. */
export function getPage<T, Cursor extends string | number>(
  rows: readonly T[],
  cursor: (row: T) => Cursor,
  limit = 100,
) {
  parsePageOptions({ limit });
  const items = rows.slice(0, limit);
  const next = rows.length > limit ? cursor(required(items.at(-1))) : null;
  return { items, next };
}

/** Access-filter a scanned page without changing continuation or concealing database/provider failures. */
export async function filterPage<T, U, Cursor extends string | number>(
  page: { items: T[]; next: Cursor | null },
  resolve: (item: T) => Promise<U>,
) {
  const items: U[] = [];
  for (const item of page.items) {
    try {
      items.push(await resolve(item));
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== "forbidden")
        throw error;
    }
  }
  return { items, next: page.next };
}

/** Release an acquired resource on either outcome; retain both failures if cleanup also fails. */
export async function withCleanup<T>(
  work: () => Promise<T>,
  cleanup: () => Promise<void>,
): Promise<T> {
  let value: T;
  try {
    value = await work();
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Operation and cleanup failed",
      );
    }
    throw error;
  }
  await cleanup();
  return value;
}
