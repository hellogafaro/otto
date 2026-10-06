import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * One row per saved item, files, markdown documents and folders alike; see ./index.ts.
 * The table is `library` (singular) on purpose: the one exception to plural names.
 * `parentId` points at another row of type 'folder' (null is the root; no foreign key).
 * `createdBy` is the actor that made the item: 'user:<id>' or 'agent:<id>'.
 * The bytes are not here: they live in a FileStore keyed by `id`.
 */
export const library = sqliteTable(
  'library',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    parentId: text('parent_id'),
    type: text('type').notNull(),
    title: text('title').notNull(),
    mime: text('mime'),
    size: integer('size'),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('library_workspace_parent').on(table.workspaceId, table.parentId)],
)
