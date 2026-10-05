import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * `secretId` points into the secrets domain (no foreign key); see ./index.ts.
 * `slug` is the stable handle sessions and settings already use for a connection.
 */
export const connections = sqliteTable('connections', {
  id: text('id').primaryKey(),
  slug: text('slug').unique(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  baseUrl: text('baseUrl'),
  secretId: text('secretId'),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
})
