import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** `secretId` points into the secrets domain (no foreign key); see ./index.ts. */
export const connections = sqliteTable('connections', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  baseUrl: text('baseUrl'),
  secretId: text('secretId'),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
})
