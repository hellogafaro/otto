import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * One key/value table for three kinds of owner; see ./index.ts.
 * `entity` is 'install' | 'workspace:<id>' | 'user:<id>', `key` comes from the catalogue (./catalogue.ts), `value` is JSON.
 */
export const settings = sqliteTable(
  'settings',
  {
    entity: text('entity').notNull(),
    key: text('key').notNull(),
    value: text('value').notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.entity, table.key] })],
)
