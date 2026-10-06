import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { NotificationStatus, NotificationType } from './types.ts'

/**
 * One inbox item for one user, always a mention of them; see ./index.ts. 'Clear' deletes the row.
 * It reads as a sentence: `createdBy` <type> you on `entity`. `type` is an open verb validated in code, not a
 * CHECK; `entity` is a typed reference ('task:<id>', 'comment:<id>'). One row per (user, entity, type).
 */
export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('userId').notNull(),
    workspaceId: text('workspaceId').notNull(),
    entity: text('entity').notNull(),
    type: text('type').$type<NotificationType>().notNull(),
    createdBy: text('createdBy').notNull(),
    status: text('status').$type<NotificationStatus>().notNull().default('unread'),
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('notifications_user_workspace_status').on(table.userId, table.workspaceId, table.status, table.createdAt),
    uniqueIndex('notifications_user_entity_type').on(table.userId, table.entity, table.type),
  ],
)
