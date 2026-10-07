import { RPC_CHANNELS } from '@otto/shared/protocol'
import {
  createAgent,
  deleteAgent,
  getAgent,
  getAgents,
  getDefaultProvider,
  initAgentsSeed,
  updateAgent,
  type Agent,
  type AgentUpdate,
} from '@otto/shared/agents'
import { getAgentApiUrl, getAgentComputer } from '@otto/shared/agent'
import { domainError } from '@otto/shared/utils'
import type { RpcServer } from '@otto/server-core/transport'
import { createScreenUrl } from '../../webui/computer-screen'
import type { HandlerDeps } from '../handler-deps'
import { actorOf, resolveWorkspace } from './library'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.agents.LIST,
  RPC_CHANNELS.agents.GET,
  RPC_CHANNELS.agents.CREATE,
  RPC_CHANNELS.agents.UPDATE,
  RPC_CHANNELS.agents.DELETE,
  RPC_CHANNELS.agents.SCREEN_URL,
] as const

/**
 * The workspace's agents (docs/final-plan.md 2.7): any member lists, gets and creates; updating and deleting is the
 * agent's creator or a workspace owner (`bootstrap/authorize.ts`, `AGENT_WRITE_CHANNELS`). The first list of a
 * workspace that has none seeds its first agent (`initAgentsSeed`), so no member ever sees an empty workspace.
 */
export function registerAgentsHandlers(server: RpcServer, deps: HandlerDeps): void {
  const workspaceOf = (ctx: Parameters<typeof resolveWorkspace>[0]) => resolveWorkspace(ctx).id

  server.handle(RPC_CHANNELS.agents.LIST, (ctx) => {
    const workspaceId = workspaceOf(ctx)
    initAgentsSeed(workspaceId, actorOf(ctx), getDefaultProvider(workspaceId, ctx.userId))
    return getAgents(workspaceId)
  })

  server.handle(RPC_CHANNELS.agents.GET, (ctx, id: string) => getAgent(workspaceOf(ctx), id) ?? null)

  server.handle(
    RPC_CHANNELS.agents.CREATE,
    (ctx, input: Omit<Parameters<typeof createAgent>[0], 'workspaceId' | 'createdBy' | 'provider'> & { provider?: string }): Agent => {
      const workspaceId = workspaceOf(ctx)
      return createAgent({
        workspaceId,
        title: input.title,
        instructions: input.instructions,
        provider: input.provider ?? getDefaultProvider(workspaceId, ctx.userId),
        model: input.model,
        thinkingLevel: input.thinkingLevel,
        skills: input.skills,
        sources: input.sources,
        avatar: input.avatar,
        createdBy: actorOf(ctx),
      })
    },
  )

  server.handle(RPC_CHANNELS.agents.UPDATE, (ctx, id: string, patch: AgentUpdate) =>
    updateAgent(workspaceOf(ctx), id, {
      title: patch.title,
      instructions: patch.instructions,
      provider: patch.provider,
      model: patch.model,
      thinkingLevel: patch.thinkingLevel,
      skills: patch.skills,
      sources: patch.sources,
      avatar: patch.avatar,
      expectedUpdatedAt: patch.expectedUpdatedAt,
    }),
  )

  server.handle(RPC_CHANNELS.agents.DELETE, (ctx, id: string) => {
    deleteAgent(workspaceOf(ctx), id)
  })

  // A one-time link to watch the agent's computer (webui/computer-screen.ts); any member of its workspace may. It
  // starts the computer when it is stopped. `url` is on the server's own address, for a client not served by it.
  server.handle(RPC_CHANNELS.agents.SCREEN_URL, async (ctx, id: string): Promise<{ path: string; url: string | null }> => {
    const workspace = resolveWorkspace(ctx)
    if (!getAgent(workspace.id, id)) throw domainError('not_found', 'No such agent')
    const computer = getAgentComputer(id, workspace.rootPath, workspace.id)
    if (!computer) throw domainError('invalid', 'Agents have no computer of their own on this server (OTTO_COMPUTER is not docker).')
    await computer.ensureRunning()
    const path = createScreenUrl(id, ctx.userId ?? '')
    const base = getAgentApiUrl()
    return { path, url: base ? `${base}${path}` : null }
  })
}
