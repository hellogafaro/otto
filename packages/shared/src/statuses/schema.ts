import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * A workspace's chat statuses; see ./storage.ts. `slug` is the status id chats carry (`todo`) and never changes.
 * `icon` is an emoji, an icon name or an image data URL of at most 16 KB; `color` is JSON. `category` is 'open'
 * (inbox) or 'closed' (archive). `isDefault` marks the status new chats get: exactly one per workspace, kept by code.
 */
export const statuses = sqliteTable(
  'statuses',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspaceId').notNull(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    color: text('color'),
    icon: text('icon'),
    category: text('category').$type<'open' | 'closed'>().notNull(),
    isFixed: integer('isFixed', { mode: 'boolean' }).notNull(),
    isDefault: integer('isDefault', { mode: 'boolean' }).notNull(),
    order: integer('order').notNull(),
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [uniqueIndex('statuses_workspace_slug').on(table.workspaceId, table.slug), index('statuses_workspace_order').on(table.workspaceId, table.order)],
)
