import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * A workspace's labels, as one tree through `parentId`; see ./storage.ts. `slug` is the label's id as chats, routines
 * and agents write it (`bug`, `priority::3`) and never changes; `id` is the row's own `createId()`. `color` and
 * `autoRules` are JSON, `valueType` is 'string' | 'number' | 'date' | 'link', `order` is the position among siblings.
 */
export const labels = sqliteTable(
  'labels',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspaceId').notNull(),
    parentId: text('parentId'),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    color: text('color'),
    valueType: text('valueType'),
    autoRules: text('autoRules'),
    order: integer('order').notNull(),
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [uniqueIndex('labels_workspace_slug').on(table.workspaceId, table.slug), index('labels_workspace_parent').on(table.workspaceId, table.parentId)],
)

/**
 * Which labels an entity carries, for every kind that has labels. `entity` is '<type>:<id>' (`chat:`, `library:`,
 * `task:`, `project:`), `value` the part after `::` of a valued label. The primary key serves "everything with label X",
 * the index "the labels of this entity".
 */
export const labelsEntities = sqliteTable(
  'labels_entities',
  {
    workspaceId: text('workspaceId').notNull(),
    labelId: text('labelId').notNull(),
    entity: text('entity').notNull(),
    value: text('value'),
  },
  (table) => [primaryKey({ columns: [table.labelId, table.entity] }), index('labels_entities_workspace_entity').on(table.workspaceId, table.entity)],
)
