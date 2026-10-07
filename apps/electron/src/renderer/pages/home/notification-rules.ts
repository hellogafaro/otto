/** The notifications' pure rules (Home's card and its full list): what a notification opens, which sentence it reads as, the filter and the badge. */

import type { NotificationItem } from '../../../shared/types'

/** What a click opens: a mention's comment is on a task or project, so its entity; an assignment its task. */
export const getNotificationTarget = (item: Pick<NotificationItem, 'entity' | 'comment'>): string => item.comment?.entity ?? item.entity

/** The i18n key of the row's sentence ("Maria mentioned you in Fix login", "Maria assigned you Ship v1"). */
export const getNotificationLineKey = (type: NotificationItem['type']): string => (type === 'assigned' ? 'notifications.assigned' : 'notifications.mentioned')

export const isUnread = (item: Pick<NotificationItem, 'readAt'>): boolean => item.readAt === null

/** The list the Notifications page shows: all, or only the unread ones (`?unread=1`). */
export const filterNotifications = <T extends Pick<NotificationItem, 'readAt'>>(items: T[], unreadOnly: boolean): T[] =>
  unreadOnly ? items.filter(isUnread) : items

/** The unread count on the sidebar's Home row: nothing at 0, then the number, capped at "99+". */
export const formatUnreadCount = (count: number): string | null => (count <= 0 ? null : count > 99 ? '99+' : String(count))
