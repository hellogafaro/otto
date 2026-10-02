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
