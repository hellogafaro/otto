import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { CONFIG_DIR } from '../config/paths.ts'

/**
 * The one SQLite database (`otto.db` in the config dir). Domains own their
 * tables and create them when they start; there is no shared schema file.
 * Pass `:memory:` for tests.
 */
export function openDb(path: string = join(CONFIG_DIR, 'otto.db')): Database {
  const db = new Database(path, { create: true })
  // busy_timeout first: concurrent first writers contend for the lock that
  // switches the journal to WAL.
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('PRAGMA journal_mode = WAL')
  return db
}

let shared: Database | undefined

/** The process-wide database, opened on first use. */
export function getDb(): Database {
  return (shared ??= openDb())
}
