import { createComment, deleteComment, getComments, updateComment } from '@otto/shared/comments'
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

/** Comments on tasks and projects. Mentions notify through the comments domain. */
export function registerCommentsHandlers(server: RpcServer, deps: HandlerDeps): void {
  const workspaceOf = (ctx: Parameters<typeof resolveWorkspace>[0]) => resolveWorkspace(ctx, deps).id

  server.handle(RPC_CHANNELS.comments.GET, (ctx, entity: string) => getComments(workspaceOf(ctx), entity))

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
