import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * A workspace's chat statuses; see ./storage.ts. `slug` is the status id chats carry (`todo`) and never changes.
 * `icon` is an emoji, an icon name or an image data URL of at most 16 KB; `color` is JSON. `category` is 'open'
 * (inbox), 'closed' (done) or 'archived' (the one fixed `archived` status: archiving a chat moves it there). Fixed statuses are the slugs of `FIXED_STATUS_IDS`. `isDefault` marks the status new chats get: exactly one per workspace, kept by code.
 */
export const statuses = sqliteTable(
  'statuses',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    color: text('color'),
    icon: text('icon'),
    category: text('category').$type<'open' | 'closed' | 'archived'>().notNull(),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull(),
    position: integer('position').notNull(),
  },
  (table) => [uniqueIndex('statuses_workspace_slug').on(table.workspaceId, table.slug)],
)
