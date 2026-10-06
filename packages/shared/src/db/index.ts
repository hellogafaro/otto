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
  // One WAL fsync per commit: a committed chat write survives a power cut (the default on some builds, set anyway)
  sqlite.exec('PRAGMA synchronous = FULL')
  // A long transaction cannot leave a huge WAL file behind
  sqlite.exec('PRAGMA journal_size_limit = 67108864')
  return drizzle(sqlite)
}

export type Db = ReturnType<typeof openDb>

/** What `db.transaction` hands its callback. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

let shared: Db | undefined

/** Open the process-wide database on first call and return it on every call after. */
export function initDb(): Db {
  return (shared ??= openDb())
}
