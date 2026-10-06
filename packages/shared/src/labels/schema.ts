import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * A workspace's labels, as one tree through `parentId`; see ./storage.ts. `slug` is the label's id as chats, routines
 * and agents write it (`bug`, `priority::3`) and never changes; `id` is the row's own `createId()`. `color` and
 * `autoRules` are JSON, `valueType` is 'string' | 'number' | 'date' | 'link', `position` is the order among siblings.
 */
export const labels = sqliteTable(
  'labels',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    parentId: text('parent_id'),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    color: text('color'),
    valueType: text('value_type'),
    autoRules: text('auto_rules'),
    position: integer('position').notNull(),
  },
  (table) => [uniqueIndex('labels_workspace_slug').on(table.workspaceId, table.slug)],
)

/**
 * Which labels an entity carries, for every kind that has labels. `entity` is '<type>:<id>' (`chat:`, `library:`,
 * `task:`, `project:`), `value` the part after `::` of a valued label. The primary key serves "everything with label X",
 * the index "the labels of this entity".
 */
export const labelsEntities = sqliteTable(
  'labels_entities',
  {
    workspaceId: text('workspace_id').notNull(),
    labelId: text('label_id').notNull(),
    entity: text('entity').notNull(),
    value: text('value'),
  },
  (table) => [primaryKey({ columns: [table.labelId, table.entity] }), index('labels_entities_workspace_entity').on(table.workspaceId, table.entity)],
)
