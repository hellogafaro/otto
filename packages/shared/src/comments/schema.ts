import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * What people say on a task or a project; see ./index.ts.
 * `entity` is 'task:<id>' or 'project:<id>'; `createdBy` is an actor; `content` is markdown.
 */
export const comments = sqliteTable(
  'comments',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    entity: text('entity').notNull(),
    createdBy: text('created_by').notNull(),
    content: text('content').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('comments_workspace_entity').on(table.workspaceId, table.entity, table.createdAt)],
)
