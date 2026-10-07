import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { CommentType } from './types.ts'

/**
 * What people say on a task or a project, and the activity events of a task; see ./index.ts.
 * `entity` is 'task:<id>' or 'project:<id>'; `createdBy` is an actor; `type` is 'comment' (`content` is
 * markdown) or 'event' (`content` is the ActivityEvent JSON). The default on `type` is the owner's call,
 * so pushSchema adds the column to existing rows.
 */
export const comments = sqliteTable(
  'comments',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    entity: text('entity').notNull(),
    type: text('type').$type<CommentType>().notNull().default('comment'),
    createdBy: text('created_by').notNull(),
    content: text('content').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('comments_workspace_entity').on(table.workspaceId, table.entity, table.createdAt)],
)
