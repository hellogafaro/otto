import { userIdOf } from '@otto/shared/actors'
import { getMentions, type Comment } from '@otto/shared/comments'
import { getWorkspaceByNameOrId } from '@otto/shared/config'
import { RPC_CHANNELS as C, type DomainChange } from '@otto/shared/protocol'
import type { Task } from '@otto/shared/tasks'
import { getWorkspaceInvitation } from '@otto/shared/workspaces'
import type { RpcServer, RequestContext } from '@otto/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { resolveWorkspace } from './library'

type Domain = DomainChange['domain']

/**
 * Every channel that writes data a client shows, and the domains it makes stale. After the handler
 * succeeds, `broadcastDomainChanges` pushes one `domain:changed` per domain to the members connected to
 * the workspace; the data hooks reload (`use-workspace-list`, `use-comments`, `use-notifications`).
 * `notifications` reaches only the people the write notifies (`NOTIFIED`), and the whole workspace
 * where no rule says who. A task write and logged time stale `comments` too: they write activity events
 * (open activity feeds reload). `domain-changes.test.ts` fails when a handler of these domains is neither
 * here nor a read.
 */
export const WRITE_CHANNELS: Record<string, Domain[]> = {
  [C.library.CREATE]: ['library'],
  [C.library.CREATE_FOLDER]: ['library'],
  [C.library.UPDATE]: ['library'],
  [C.library.DELETE]: ['library'],
  [C.projects.CREATE]: ['projects'],
  [C.projects.UPDATE]: ['projects'],
  [C.projects.SET_STATUS]: ['projects'],
  [C.projects.ADD_MEMBER]: ['projects'],
  [C.projects.REMOVE_MEMBER]: ['projects'],
  [C.tasks.CREATE]: ['tasks', 'notifications'],
  [C.tasks.UPDATE]: ['tasks', 'comments', 'notifications'],
  [C.tasks.SET_STATUS]: ['tasks', 'comments'],
  [C.timesheets.CREATE]: ['timesheets', 'comments'],
  [C.timesheets.DELETE]: ['timesheets'],
  [C.comments.CREATE]: ['comments', 'notifications'],
  [C.comments.UPDATE]: ['comments'],
  [C.comments.DELETE]: ['comments', 'notifications'],
  [C.notifications.SET_STATUS]: ['notifications'],
  [C.notifications.CLEAR]: ['notifications'],
  [C.workspaces.INVITE]: ['members'],
  [C.workspaces.REVOKE_INVITATION]: ['members'],
  [C.workspaces.REMOVE_MEMBER]: ['members'],
  [C.workspaces.UPDATE_MEMBER_ROLE]: ['members'],
  [C.workspaces.LEAVE]: ['members'],
  [C.labels.CREATE]: ['labels'],
  [C.labels.UPDATE]: ['labels'],
  [C.labels.MOVE]: ['labels'],
  [C.labels.REORDER]: ['labels'],
  [C.labels.DELETE]: ['labels'],
  [C.statuses.CREATE]: ['statuses'],
  [C.statuses.UPDATE]: ['statuses'],
  [C.statuses.DELETE]: ['statuses'],
  [C.statuses.REORDER]: ['statuses'],
  [C.statuses.SET_DEFAULT]: ['statuses'],
  [C.skills.DELETE]: ['skills'],
  [C.sources.CREATE]: ['sources'],
  [C.sources.DELETE]: ['sources'],
  [C.sources.SAVE_CREDENTIALS]: ['sources'],
  [C.oauth.REVOKE]: ['sources'],
  [C.agents.CREATE]: ['agents'],
  [C.agents.UPDATE]: ['agents'],
  [C.agents.DELETE]: ['agents'],
  [C.routines.CREATE]: ['routines'],
  [C.routines.UPDATE]: ['routines'],
  [C.routines.DELETE]: ['routines'],
  [C.routines.PAUSE]: ['routines'],
  [C.routines.RESUME]: ['routines'],
  [C.routines.RUN]: ['routines'],
  [C.routines.RESET_WEBHOOK]: ['routines'],
}

/**
 * Who a write's `notifications` change reaches, from what the handler returned: the people now assigned
 * (a superset of the newly assigned), the people a new comment mentions, and for the inbox itself its
 * owner. A channel without a rule tells the whole workspace (a deleted comment: its mentions are gone).
 */
const NOTIFIED: Record<string, (ctx: RequestContext, result: never) => string[] | undefined> = {
  [C.tasks.CREATE]: (_, task: Task) => task.assignees.flatMap((actor) => userIdOf(actor) ?? []),
  [C.tasks.UPDATE]: (_, task: Task) => task.assignees.flatMap((actor) => userIdOf(actor) ?? []),
  [C.comments.CREATE]: (_, comment: Comment) => getMentions(comment.content),
  [C.notifications.SET_STATUS]: (ctx) => (ctx.userId ? [ctx.userId] : undefined),
  [C.notifications.CLEAR]: (ctx) => (ctx.userId ? [ctx.userId] : undefined),
}

/** The workspace id a write is about: the first argument of the members, labels, statuses, skills and sources channels (an id, or a name; an invitation id for a revoke), else the connection's. */
function workspaceIdOf(channel: string, ctx: Parameters<typeof resolveWorkspace>[0], args: unknown[], deps: HandlerDeps): string | undefined {
  if (!/^(workspaces|labels|statuses|skills|sources):/.test(channel)) return resolveWorkspace(ctx).id
  const ref = String(args[0])
  return channel === C.workspaces.REVOKE_INVITATION ? getWorkspaceInvitation(ref)?.workspaceId : getWorkspaceByNameOrId(ref)?.id
}

/** The same server, except that handlers of `WRITE_CHANNELS` push `domain:changed` after they succeed (a failed write pushes nothing). */
export function broadcastDomainChanges(server: RpcServer, deps: HandlerDeps): RpcServer {
  return new Proxy(server, {
    get(target, prop) {
      if (prop === 'handle') {
        return (channel: string, handler: Parameters<RpcServer['handle']>[1]) => {
          const domains = WRITE_CHANNELS[channel]
          target.handle(
            channel,
            !domains
              ? handler
              : async (ctx, ...args) => {
                  const result = await handler(ctx, ...args)
                  const workspaceId = workspaceIdOf(channel, ctx, args, deps)
                  if (workspaceId) {
                    for (const domain of domains) {
                      const userIds = domain === 'notifications' ? NOTIFIED[channel]?.(ctx, result as never) : undefined
                      if (userIds?.length === 0) continue
                      const change: DomainChange = { domain, workspaceId, ...(userIds && { userIds }) }
                      target.push(C.domain.CHANGED, { to: 'workspace', workspaceId, ...(userIds && { userIds }) }, change)
                    }
                  }
                  return result
                },
          )
        }
      }
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
