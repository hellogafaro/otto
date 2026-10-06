import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * What people say on a task or a project; see ./index.ts.
 * `entity` is 'task:<id>' or 'project:<id>'; `createdBy` is an actor; `content` is markdown.
 */
export const comments = sqliteTable(
  'comments',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspaceId').notNull(),
    entity: text('entity').notNull(),
    createdBy: text('createdBy').notNull(),
    content: text('content').notNull(),
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('comments_workspace_entity').on(table.workspaceId, table.entity, table.createdAt)],
)
