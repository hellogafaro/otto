import { sql } from 'drizzle-orm'
import { MASTRA_RUNTIME_TABLES } from './mastra-tables.ts'
import { pushSQLiteSchema } from 'drizzle-kit/api'
import * as agents from '../agents/schema.ts'
import * as automations from '../automations/schema.ts'
import * as comments from '../comments/schema.ts'
import * as connections from '../connections/schema.ts'
import * as labels from '../labels/schema.ts'
import * as library from '../library/schema.ts'
import * as notifications from '../notifications/schema.ts'
import * as projects from '../projects/schema.ts'
import * as secrets from '../secrets/schema.ts'
import * as sessions from '../sessions/schema.ts'
import * as settings from '../settings/schema.ts'
import * as skills from '../skills/schema.ts'
import * as sources from '../sources/schema.ts'
import * as statuses from '../statuses/schema.ts'
import * as tasks from '../tasks/schema.ts'
import * as users from '../users/schema.ts'
import * as workspaces from '../workspaces/schema.ts'
import type { Db, Tx } from './index.ts'

/**
 * Every domain's `schema.ts`, imported by name so a bundle (the desktop's server) carries them; a test fails when a
 * `schema.ts` under packages/shared/src is missing here.
 */
export const SCHEMAS = { agents, automations, comments, connections, labels, library, notifications, projects, secrets, sessions, settings, skills, sources, statuses, tasks, users, workspaces }

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
          (row) => !['tableName', 'tableFrom', 'tbl_name', 'name'].some((key) => typeof row[key] === 'string' && (HAND_MADE.test(row[key]) || MASTRA_RUNTIME_TABLES.has(row[key]))),
        )
    },
  })
}

/** drizzle-kit's copy of a table it rebuilds: INSERT INTO `__new_<t>`(<cols>) SELECT <cols> FROM `<t>`. */
const REBUILD_COPY = /^INSERT INTO `__new_([^`]+)`\(([^)]*)\) SELECT .* FROM `([^`]+)`;?\s*$/s

/**
 * When drizzle-kit rebuilds a table (a change ADD COLUMN cannot make) that also gains a column, it copies the new
 * column from the old table too, as `"col"`: SQLite reads a quoted name it cannot find as a string, so every existing
 * row got the column's name as its value instead of its default. Copy only the columns the old table has.
 */
function copyExistingColumns(tx: Tx, statement: string): string {
  const match = REBUILD_COPY.exec(statement)
  if (!match) return statement
  const [, table, into, from] = match
  const existing = new Set((tx.all(sql.raw(`PRAGMA table_info(\`${from}\`)`)) as { name: string }[]).map((column) => column.name))
  const columns = into!.split(',').map((column) => column.trim()).filter((column) => existing.has(column.replace(/^"|"$/g, '')))
  return `INSERT INTO \`__new_${table}\`(${columns.join(', ')}) SELECT ${columns.join(', ')} FROM \`${from}\`;`
}

/**
 * Apply every domain's `schema.ts` (`SCHEMAS`) to the database. This is the whole "migration" story until the MVP is stable:
 * Drizzle diffs the schemas against the database and runs the difference.
 * Changes that would lose data are refused unless `force` is set. Hand-made
 * tables (FTS5, see `HAND_MADE`) are left alone.
 */
export async function pushSchema(db: Db, { force = false } = {}): Promise<string[]> {
  const schema: Record<string, unknown> = Object.assign({}, ...Object.values(SCHEMAS))
  const { statementsToExecute, hasDataLoss, warnings } = await pushSQLiteSchema(schema, hideHandMadeTables(db) as never)
  if (hasDataLoss && !force) {
    throw new Error(`Refusing a push that loses data:\n${warnings.join('\n')}\nRun with --force to accept.`)
  }
  // drizzle-kit plans the `CREATE INDEX` of a table it rebuilds twice (once with the new table, once as an index
  // change), and the second fails on an index that exists. A repeated statement is never meant, so run each once,
  // all in one transaction (its own `apply()` runs them one by one: a failure left a half-changed database).
  const statements = [...new Set(statementsToExecute)]
  db.transaction((tx) => {
    for (const statement of statements) tx.all(sql.raw(copyExistingColumns(tx, statement)))
  })
  return statements
}
