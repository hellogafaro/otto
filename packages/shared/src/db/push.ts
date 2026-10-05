import { Glob } from 'bun'
import { pushSQLiteSchema } from 'drizzle-kit/api'
import { join } from 'node:path'
import type { Db } from './index.ts'

/**
 * Apply every domain's `schema.ts` (anything under packages/shared/src) to the
 * database. This is the whole "migration" story until the MVP is stable:
 * Drizzle diffs the schemas against the database and runs the difference.
 * Changes that would lose data are refused unless `force` is set.
 */
export async function pushSchema(db: Db, { force = false } = {}): Promise<string[]> {
  const root = join(import.meta.dir, '..')
  const schema: Record<string, unknown> = {}
  for await (const file of new Glob('**/schema.ts').scan({ cwd: root })) {
    Object.assign(schema, await import(join(root, file)))
  }
  const { statementsToExecute, hasDataLoss, warnings, apply } = await pushSQLiteSchema(schema, db as never)
  if (hasDataLoss && !force) {
    throw new Error(`Refusing a push that loses data:\n${warnings.join('\n')}\nRun with --force to accept.`)
  }
  await apply()
  return statementsToExecute
}
