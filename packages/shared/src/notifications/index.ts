import { and, count, desc, eq, inArray, sql } from 'drizzle-orm'
import { isActor } from '../actors.ts'
import { initDb, type Db, type Tx } from '../db/index.ts'
import { createId } from '../id.ts'
import { isEntity } from '../entities.ts'
import { domainError } from '../utils/errors.ts'
import { notifications } from './schema.ts'
import type { Notification, NotificationStatus, NotificationType } from './types.ts'

/**
 * Notifications: the inbox. One row per recipient, and every row is a mention of that person, a sentence:
 * `createdBy` <type> you on `entity`. `type` is `mention` (`entity` is the comment `comment:<id>`, which
 * holds the text and what it is on) or `assigned` (`entity` is the task); new verbs are one line in
 * `NOTIFICATION_TYPES`.
 *
 *   notifications(id, userId, workspaceId, entity, type, createdBy, status, createdAt)   (schema.ts)
 *
 * The comments and tasks domains call `createNotification`, in their own transaction when they have one.
 * The text is never copied: the inbox reads the comment by its id. `status` is 'unread', 'read'
 * (or 'pending', reserved for email and push); "clear" deletes the row. Every read and write takes the
 * user and the workspace, so one user never touches another's rows. Functions take a `db` or `tx` last.
 */

export type * from './types.ts'

type Row = typeof notifications.$inferSelect

const toNotification = (row: Row): Notification => ({
  id: row.id,
  type: row.type,
  status: row.status,
  createdAt: row.createdAt.getTime(),
  createdBy: row.createdBy,
  entity: row.entity,
})

/** The verbs a notification can have. */
export const NOTIFICATION_TYPES: NotificationType[] = ['mention', 'assigned']

/**
 * Tells `userId` (unread). The same sentence again (same user, entity and type) does not add a row: it makes the
 * existing one unread, new and by this actor.
 */
export function createNotification(
  input: { userId: string; workspaceId: string; entity: string; type: NotificationType; createdBy: string },
  db: Db | Tx = initDb(),
): void {
  if (!isEntity(input.entity)) throw domainError('invalid', `${String(input.entity)} is not an entity`)
  if (!NOTIFICATION_TYPES.includes(input.type)) throw domainError('invalid', `${String(input.type)} is not a notification type`)
  if (!isActor(input.createdBy)) throw domainError('invalid', `${String(input.createdBy)} is not an actor`)
  const now = new Date()
  db.insert(notifications)
    .values({
      id: createId(),
      userId: input.userId,
      workspaceId: input.workspaceId,
      entity: input.entity,
      type: input.type,
      createdBy: input.createdBy,
      status: 'unread',
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [notifications.userId, notifications.entity, notifications.type],
      set: { status: 'unread', createdAt: now, createdBy: input.createdBy },
    })
    .run()
}

/** The user's notifications in the workspace, newest first. */
export function getNotifications(userId: string, workspaceId: string, db: Db | Tx = initDb()): Notification[] {
  return db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.workspaceId, workspaceId)))
    .orderBy(desc(notifications.createdAt), sql`rowid desc`)
    .all()
    .map(toNotification)
}

const mine = (userId: string, workspaceId: string, ids: string[] | 'all') =>
  and(eq(notifications.userId, userId), eq(notifications.workspaceId, workspaceId), ids === 'all' ? undefined : inArray(notifications.id, ids))

/** Marks the user's notifications (some ids, or all of the workspace's) read or unread. Others' ids are ignored. */
export function updateNotificationStatus(
  userId: string,
  workspaceId: string,
  ids: string[] | 'all',
  status: Exclude<NotificationStatus, 'pending'>,
  db: Db | Tx = initDb(),
): void {
  if (status !== 'read' && status !== 'unread') throw domainError('invalid', `${String(status)} is not a status you can set`)
  if (ids !== 'all' && ids.length === 0) return
  db.update(notifications).set({ status }).where(mine(userId, workspaceId, ids)).run()
}

/** Clears (deletes) the user's notifications: some ids, or all of the workspace's. */
export function deleteNotifications(userId: string, workspaceId: string, ids: string[] | 'all', db: Db | Tx = initDb()): void {
  if (ids !== 'all' && ids.length === 0) return
  db.delete(notifications).where(mine(userId, workspaceId, ids)).run()
}

/** Removes every notification about `entity`, for whoever it told: the comments domain calls it with `comment:<id>` when it deletes a comment. */
export function deleteEntityNotifications(entity: string, db: Db | Tx = initDb()): void {
  db.delete(notifications).where(eq(notifications.entity, entity)).run()
}

export function getUnreadCount(userId: string, workspaceId: string, db: Db | Tx = initDb()): number {
  const row = db
    .select({ count: count() })
    .from(notifications)
    .where(and(mine(userId, workspaceId, 'all'), eq(notifications.status, 'unread')))
    .get()
  return row?.count ?? 0
}
