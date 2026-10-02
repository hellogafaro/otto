import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

/** Opens a bounded pool; credentials are supplied by the process secret wrapper. */
export function openDatabase(config: PoolConfig) {
  const pool = new Pool({
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    statement_timeout: 10000,
    ...config,
  });
  return { db: drizzle(pool), pool };
}
export type Database = ReturnType<typeof openDatabase>["db"];
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
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
