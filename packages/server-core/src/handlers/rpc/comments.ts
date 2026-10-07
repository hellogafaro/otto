import { createComment, deleteComment, getComments, updateComment, type CommentPage } from '@otto/shared/comments'
import { RPC_CHANNELS } from '@otto/shared/protocol'
import { getProject } from '@otto/shared/projects'
import { getTask } from '@otto/shared/tasks'
import { domainError } from '@otto/shared/utils'
import type { RpcServer } from '@otto/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { actorOf, resolveWorkspace } from './library'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.comments.GET,
  RPC_CHANNELS.comments.CREATE,
  RPC_CHANNELS.comments.UPDATE,
  RPC_CHANNELS.comments.DELETE,
] as const

/** The title of what an entity (`task:<id>` or `project:<id>`) is about; undefined when it is not in the workspace. */
export function getEntityTitle(workspaceId: string, entity: string): string | undefined {
  const [type, id = ''] = String(entity).split(':')
  if (type === 'task') return getTask(workspaceId, id)?.title
  if (type === 'project') return getProject(workspaceId, id)?.title
}

/**
 * Comments on tasks and projects, and a task's activity events (read with its comments). Mentions notify
 * through the comments domain. The task's 'created' event is not stored: the last (oldest) page gets it first.
 */
export function registerCommentsHandlers(server: RpcServer, deps: HandlerDeps): void {
  const workspaceOf = (ctx: Parameters<typeof resolveWorkspace>[0]) => resolveWorkspace(ctx).id

  server.handle(RPC_CHANNELS.comments.GET, (ctx, entity: string, page?: { before?: string; limit?: number }): CommentPage => {
    const workspaceId = workspaceOf(ctx)
    const result = getComments(workspaceId, entity, page)
    const [type, id = ''] = String(entity).split(':')
    // The oldest page gets it; an empty page `before` a row (unknown, or the oldest, whose page had it) does not.
    const oldest = !result.more && (page?.before === undefined || result.items.length > 0)
    const task = oldest && type === 'task' ? getTask(workspaceId, id) : undefined
    if (!task) return result
    const created = { id: `created-${task.id}`, entity, type: 'event', createdBy: task.createdBy, content: '', event: { kind: 'created' }, createdAt: task.createdAt, updatedAt: task.createdAt } as const
    return { items: [created, ...result.items], more: false }
  })

  server.handle(RPC_CHANNELS.comments.CREATE, (ctx, entity: string, content: string) => {
    const workspaceId = workspaceOf(ctx)
    if (getEntityTitle(workspaceId, entity) === undefined) throw domainError('not_found', `${String(entity)} does not exist`)
    return createComment({ workspaceId, entity, createdBy: actorOf(ctx), content })
  })

  server.handle(RPC_CHANNELS.comments.UPDATE, (ctx, id: string, content: string, expectedUpdatedAt?: number) =>
    updateComment(workspaceOf(ctx), id, actorOf(ctx), content, expectedUpdatedAt),
  )

  server.handle(RPC_CHANNELS.comments.DELETE, (ctx, id: string) => {
    deleteComment(workspaceOf(ctx), id, actorOf(ctx))
  })
}
