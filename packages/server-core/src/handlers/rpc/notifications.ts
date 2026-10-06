import { userIdOf } from '@otto/shared/actors'
import { getCommentsById } from '@otto/shared/comments'
import { deleteNotifications, getNotifications, getUnreadCount, updateNotificationStatus, type NotificationItem } from '@otto/shared/notifications'
import { RPC_CHANNELS } from '@otto/shared/protocol'
import { domainError } from '@otto/shared/utils'
import type { RpcServer, RequestContext } from '@otto/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { getEntityTitle } from './comments'
import { actorOf, resolveWorkspace } from './library'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.notifications.GET,
  RPC_CHANNELS.notifications.SET_STATUS,
  RPC_CHANNELS.notifications.CLEAR,
  RPC_CHANNELS.notifications.GET_UNREAD_COUNT,
] as const

/** The signed-in user's id (the guard already refused anyone else). */
const userOf = (ctx: RequestContext) => userIdOf(actorOf(ctx))!

function assertIds(ids: unknown): string[] | 'all' {
  if (ids === 'all' || (Array.isArray(ids) && ids.every((id) => typeof id === 'string'))) return ids as string[] | 'all'
  throw domainError('invalid', "ids must be a list of notification ids or 'all'")
}

/** Each user's own notifications: a mention or an assignment, newest first. */
export function registerNotificationsHandlers(server: RpcServer, deps: HandlerDeps): void {
  const workspaceOf = (ctx: RequestContext) => resolveWorkspace(ctx, deps).id

  // A `comment:<id>` entity resolves to its comment (text and own entity) and that entity's title; any other
  // entity to its title (null when gone), read through the comments, tasks and projects domains.
  server.handle(RPC_CHANNELS.notifications.GET, (ctx): NotificationItem[] => {
    const workspaceId = workspaceOf(ctx)
    const rows = getNotifications(userOf(ctx), workspaceId)
    const commentsById = new Map(
      getCommentsById(workspaceId, rows.filter((row) => row.entity.startsWith('comment:')).map((row) => row.entity.slice('comment:'.length))).map((comment) => [comment.id, comment]),
    )
    return rows.map((row) => {
      const found = commentsById.get(row.entity.slice('comment:'.length))
      const comment = row.entity.startsWith('comment:') && found ? { id: found.id, content: found.content, entity: found.entity } : null
      return { ...row, entityTitle: getEntityTitle(workspaceId, comment?.entity ?? row.entity) ?? null, comment }
    })
  })

  server.handle(RPC_CHANNELS.notifications.SET_STATUS, (ctx, ids: string[] | 'all', status: 'read' | 'unread') => {
    updateNotificationStatus(userOf(ctx), workspaceOf(ctx), assertIds(ids), status)
  })

  server.handle(RPC_CHANNELS.notifications.CLEAR, (ctx, ids: string[] | 'all') => {
    deleteNotifications(userOf(ctx), workspaceOf(ctx), assertIds(ids))
  })

  server.handle(RPC_CHANNELS.notifications.GET_UNREAD_COUNT, (ctx) => getUnreadCount(userOf(ctx), workspaceOf(ctx)))
}
