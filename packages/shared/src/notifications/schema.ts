import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { NotificationType } from './types.ts'

/**
 * One inbox item for one user, always a mention of them; see ./index.ts. 'Clear' deletes the row.
 * It reads as a sentence: `createdBy` <type> you on `entity`. `type` is an open verb validated in code, not a
 * CHECK; `readAt` is when it was read (null = unread); `entity` is a typed reference ('task:<id>', 'comment:<id>'). One row per (user, entity, type).
 */
export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    entity: text('entity').notNull(),
    type: text('type').$type<NotificationType>().notNull(),
    createdBy: text('created_by').notNull(),
    readAt: integer('read_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('notifications_user_workspace_created').on(table.userId, table.workspaceId, table.createdAt),
    uniqueIndex('notifications_user_entity_type').on(table.userId, table.entity, table.type),
  ],
)
