import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { join } from 'node:path'
import { CONFIG_DIR } from '../config/paths.ts'

/** Where the one SQLite database lives (`otto.db` in the config dir). */
export const DB_PATH = join(CONFIG_DIR, 'otto.db')

/**
 * The database handle every domain uses. Each domain keeps its own
 * `schema.ts` (plain Drizzle tables) next to its code; `bun run db:push`
 * applies them all (drizzle.config.ts). SQLite is confined to this file and
 * the schema files, so moving to Postgres later swaps the driver and the
 * `sqlite-core` imports and nothing else. Pass `:memory:` for tests.
 */
export function openDb(path: string = DB_PATH) {
  const sqlite = new Database(path, { create: true })
  // busy_timeout first: concurrent first writers contend for the lock that
  // switches the journal to WAL.
  sqlite.exec('PRAGMA busy_timeout = 5000')
  sqlite.exec('PRAGMA journal_mode = WAL')
  return drizzle(sqlite)
}

export type Db = ReturnType<typeof openDb>

let shared: Db | undefined

/** The process-wide database, opened on first use. */
export function getDb(): Db {
  return (shared ??= openDb())
}
