import { Glob } from 'bun'
import { sql } from 'drizzle-orm'
import { pushSQLiteSchema } from 'drizzle-kit/api'
import { join } from 'node:path'
import type { Db } from './index.ts'

/** Tables made by hand with raw SQL, not by a `schema.ts`: FTS5 virtual tables (`*_fts`), their shadow tables and SQLite's own. */
const HAND_MADE = /^sqlite_|_fts(_(data|idx|content|docsize|config))?$/

/**
 * drizzle-kit's API has no tables filter, so it would plan to drop every FTS5
 * table (and refuse for data loss). Hide them from its introspection instead:
 * drop the rows of its `sqlite_master` queries that name such a table. The
 * column names are the aliases its introspection uses (a test covers them).
 */
function hideHandMadeTables(db: Db): Db {
  return new Proxy(db, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target)
      if (typeof value !== 'function') return value
      if (prop !== 'all') return value.bind(target)
      return (query: never) =>
        (value.call(target, query) as Record<string, unknown>[]).filter(
          (row) => !['tableName', 'tableFrom', 'tbl_name', 'name'].some((key) => typeof row[key] === 'string' && HAND_MADE.test(row[key])),
        )
    },
  })
}

/**
 * Apply every domain's `schema.ts` (anything under packages/shared/src) to the
 * database. This is the whole "migration" story until the MVP is stable:
 * Drizzle diffs the schemas against the database and runs the difference.
 * Changes that would lose data are refused unless `force` is set. Hand-made
 * tables (FTS5, see `HAND_MADE`) are left alone.
 */
export async function pushSchema(db: Db, { force = false } = {}): Promise<string[]> {
  const root = join(import.meta.dir, '..')
  const schema: Record<string, unknown> = {}
  for await (const file of new Glob('**/schema.ts').scan({ cwd: root })) {
    Object.assign(schema, await import(join(root, file)))
  }
  const { statementsToExecute, hasDataLoss, warnings } = await pushSQLiteSchema(schema, hideHandMadeTables(db) as never)
  if (hasDataLoss && !force) {
    throw new Error(`Refusing a push that loses data:\n${warnings.join('\n')}\nRun with --force to accept.`)
  }
  // drizzle-kit plans the `CREATE INDEX` of a table it rebuilds twice (once with the new table, once as an index
  // change), and the second fails on an index that exists. A repeated statement is never meant, so run each once,
  // all in one transaction (its own `apply()` runs them one by one: a failure left a half-changed database).
  const statements = [...new Set(statementsToExecute)]
  db.transaction((tx) => {
    for (const statement of statements) tx.all(sql.raw(statement))
  })
  return statements
}
