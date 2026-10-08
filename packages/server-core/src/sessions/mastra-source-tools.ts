import { createTool } from '@mastra/core/tools'
import { toStandardSchema } from '@mastra/core/schema'
import { McpClientPool } from '@otto/shared/mcp'
import { getAgentRunConfig } from '@otto/shared/agents'
import {
  getSourcesBySlugs,
  isSourceUsable,
  type TokenRefreshManager,
} from '@otto/shared/sources'
import { getWorkspaceByNameOrId } from '@otto/shared/config'
import { buildServersFromSources } from '../sources/build-servers'
import { shouldAllowToolInMode, type PermissionMode } from '@otto/shared/agent'

export async function openMastraSourceTools(input: {
  workspaceId: string
  agentId: string
  slugs: readonly string[]
  sessionPath: string
  signal: AbortSignal
  assertAccess: () => void
  mode: PermissionMode
  refresh?: TokenRefreshManager
}) {
  input.assertAccess()
  const workspace = getWorkspaceByNameOrId(input.workspaceId)
  const run = getAgentRunConfig(input.agentId, input.workspaceId)
  if (!workspace || !run || run.agent.id !== input.agentId)
    throw new Error('The source scope is unavailable.')
  const sources = getSourcesBySlugs(workspace.rootPath, [
    ...input.slugs,
  ]).filter(
    (source) =>
      !run.sources.length ||
      run.sources.includes(source.config.id) ||
      run.sources.includes(source.config.slug),
  )
  if (sources.length !== input.slugs.length)
    throw new Error(
      'A selected source is unavailable or not allowed for this agent.',
    )
  if (
    sources.some(
      (source) =>
        source.config.type !== 'mcp' ||
        source.config.mcp?.transport === 'stdio',
    )
  )
    throw new Error(
      'Only remote MCP sources are supported by this native checkpoint. Local and API source execution is not yet migrated.',
    )
  if (input.refresh) {
    const pending = await input.refresh.getSourcesNeedingRefresh(sources)
    if (pending.length) await input.refresh.refreshSources(pending)
  }
  if (sources.some((source) => !isSourceUsable(source)))
    throw new Error(
      'A selected source needs authentication. Reconnect it in Sources before running.',
    )
  const pool = new McpClientPool({
    workspaceRootPath: workspace.rootPath,
    sessionPath: input.sessionPath,
  })
  try {
    const { mcpServers, errors } = await buildServersFromSources(
      sources,
      input.sessionPath,
      input.refresh,
    )
    if (errors.length)
      throw new Error(
        'A selected source could not be authenticated or configured.',
      )
    const failed = await pool.sync(mcpServers)
    if (failed.length)
      throw new Error(
        'A selected source could not connect. Check its connection in Sources.',
      )
    const tools = Object.fromEntries(
      pool
        .getProxyToolDefs()
        .filter(
          (tool) =>
            input.mode !== 'safe' ||
            shouldAllowToolInMode(tool.name, {}, 'safe', {
              permissionsContext: { workspaceRootPath: workspace.rootPath,activeSourceSlugs:sources.map((source)=>source.config.slug) },
            }).allowed,
        )
        .map((tool) => [
          tool.name,
          createTool({
            id: tool.name,
            description: tool.description,
            inputSchema: toStandardSchema(tool.inputSchema),
            execute: async (args) => {
              input.assertAccess()
              const permission = shouldAllowToolInMode(
                tool.name,
                args,
                input.mode,
                {
                  permissionsContext: {
                    workspaceRootPath: workspace.rootPath,
                    activeSourceSlugs: sources.map(
                      (source) => source.config.slug,
                    ),
                  },
                },
              )
              if (!permission.allowed)
                throw new Error(
                  'This source action is not allowed in the current permission mode.',
                )
              const current = getAgentRunConfig(
                input.agentId,
                input.workspaceId,
              )
              const slug = sources.find((source) =>
                pool
                  .getProxyToolDefs([source.config.slug])
                  .some((candidate) => candidate.name === tool.name),
              )?.config.slug
              const selected = slug
                ? getSourcesBySlugs(workspace.rootPath, [slug])[0]
                : undefined
              if (
                !slug ||
                !selected ||
                !isSourceUsable(selected) ||
                !current ||
                current.agent.id !== input.agentId ||
                (current.sources.length &&
                  !current.sources.includes(slug) &&
                  !current.sources.includes(selected.config.id))
              )
                throw new Error('Source access was removed before execution.')
              const result = await pool.callTool(
                tool.name,
                args as Record<string, unknown>,
                { signal: input.signal, timeoutMs: 30000 },
              )
              return result.isError
                ? {
                    error:
                      'The MCP source action failed. Check its connection and arguments.',
                  }
                : { content: result.content }
            },
          }),
        ]),
    )
    return {
      tools,
      slugs: sources.map((source) => source.config.slug),
      close: () => pool.disconnectAll(),
    }
  } catch (error) {
    await pool.disconnectAll()
    throw error
  }
}
