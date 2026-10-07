import { RPC_CHANNELS } from '@otto/shared/protocol'
import { searchWorkspace } from '@otto/shared/search/workspace'
import type { RpcServer } from '@otto/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { actorOf, resolveWorkspace } from './library'

export const HANDLED_CHANNELS = [RPC_CHANNELS.search.RUN] as const

/** One search over the connection's workspace, as the caller: chats are the caller's own, the rest is the workspace's (a member's). */
export function registerSearchHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.search.RUN, (ctx, query: string) => {
    const workspaceId = resolveWorkspace(ctx, deps).id
    return typeof query === 'string' ? searchWorkspace(workspaceId, actorOf(ctx), query) : []
  })
}
