import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** `value` is base64 of nonce + ciphertext + tag; see ./index.ts. */
export const secrets = sqliteTable('secrets', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  value: text('value').notNull(),
})
