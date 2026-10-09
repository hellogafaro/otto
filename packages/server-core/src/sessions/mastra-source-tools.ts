import { createTool, type Tool } from '@mastra/core/tools'
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
import { createMastraApiTool, testMastraApiSource } from './mastra-api-tools'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { getSourceCredentialManager, getSourceServerBuilder } from '@otto/shared/sources'
import { getSource } from '@otto/shared/sources'

function allowsSource(workspaceId: string, references: readonly string[], source: { config: { id: string; slug: string } }): boolean {
  if (!references.length) return true
  const rowId = getSource(workspaceId, source.config.slug)?.id
  return references.includes(source.config.id) || references.includes(source.config.slug) || !!rowId && references.includes(rowId)
}

export async function openMastraSourceTools(input: {
  workspaceId: string
  agentId: string
  slugs: readonly string[]
  sessionPath: string
  signal: AbortSignal
  assertAccess: () => void
  mode: PermissionMode
  getMode?: () => PermissionMode
  refresh?: TokenRefreshManager
}) {
  input.assertAccess()
  input.signal.throwIfAborted()
  const workspace = getWorkspaceByNameOrId(input.workspaceId)
  const run = getAgentRunConfig(input.agentId, input.workspaceId)
  if (!workspace || !run || run.agent.id !== input.agentId)
    throw new Error('The source scope is unavailable.')
  const sources = getSourcesBySlugs(workspace.rootPath, [
    ...input.slugs,
  ]).filter(
    (source) =>
      allowsSource(input.workspaceId, run.sources, source),
  )
  if (sources.length !== input.slugs.length)
    throw new Error(
      'A selected source is unavailable or not allowed for this agent.',
    )
  if (
    sources.some(
      (source) =>
        !['mcp', 'api'].includes(source.config.type) ||
        source.config.mcp?.transport === 'stdio',
    )
  )
    throw new Error(
      'Local filesystem sources require race-safe configured-root isolation, which is unavailable. Stdio MCP requires an isolated subprocess boundary, which is unavailable. Only remote MCP and API sources can run.',
    )
  if (sources.some((source) => !source.config.enabled))
    throw new Error('A selected source is disabled. Enable it in Sources before running.')
  if (input.refresh) {
    const pending = await input.refresh.getSourcesNeedingRefresh(sources)
    if (pending.length) await input.refresh.refreshSources(pending)
  }
  input.signal.throwIfAborted()
  input.assertAccess()
  const missingAuthSlugs = sources.filter((source) => !isSourceUsable(source)).map((source) => source.config.slug)
  const usableSources = sources.filter((source) => isSourceUsable(source))
  const pool = new McpClientPool({
    workspaceRootPath: workspace.rootPath,
    sessionPath: input.sessionPath,
  })
  try {
    const { mcpServers, errors } = await buildServersFromSources(
      usableSources.filter((source) => source.config.type === 'mcp'),
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
    const tools: Record<string, Tool<any>> = Object.fromEntries(
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
                input.getMode?.() ?? input.mode,
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
                !allowsSource(input.workspaceId, current.sources, selected)
              )
                throw new Error('Source access was removed before execution.')
              const result = await pool.callTool(
                tool.name,
                args as Record<string, unknown>,
                { signal: input.signal, timeoutMs: 30000 },
              )
              input.signal.throwIfAborted()
              input.assertAccess()
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
    for (const source of usableSources.filter((source) => source.config.type === 'api')) {
      const [name, tool] = createMastraApiTool({
        source, agentId: input.agentId, mode: input.mode, getMode: input.getMode, signal: input.signal, refresh: input.refresh,
        activeSourceSlugs: sources.map((source) => source.config.slug),
        assertSource: () => {
          input.assertAccess()
          input.signal.throwIfAborted()
          const current = getAgentRunConfig(input.agentId, input.workspaceId)
          const selected = getSourcesBySlugs(workspace.rootPath, [source.config.slug])[0]
          if (!selected || selected.config.type !== 'api' || !isSourceUsable(selected) || JSON.stringify(selected.config.api) !== JSON.stringify(source.config.api)
            || selected.config.id !== source.config.id || selected.config.provider !== source.config.provider
            || !current || current.agent.id !== input.agentId
            || !allowsSource(input.workspaceId, current.sources, source)) {
            throw new Error('Source access or configuration changed before execution.')
          }
        },
      })
      tools[name] = tool
    }
    return {
      tools,
      slugs: sources.map((source) => source.config.slug),
      missingAuthSlugs,
      close: () => pool.disconnectAll(),
    }
  } catch (error) {
    await pool.disconnectAll()
    throw error
  }
}

export async function testMastraSource(input: {
  workspaceId: string
  agentId: string
  sourceSlug: string
  signal: AbortSignal
  assertAccess: () => void
  mode: PermissionMode
  getMode?: () => PermissionMode
  refresh?: TokenRefreshManager
}) {
  input.signal.throwIfAborted()
  input.assertAccess()
  const workspace = getWorkspaceByNameOrId(input.workspaceId)
  const source = workspace ? getSourcesBySlugs(workspace.rootPath, [input.sourceSlug])[0] : undefined
  if (!workspace || !source) throw new Error('The source scope is unavailable.')
  const assertSource = () => {
    input.signal.throwIfAborted()
    input.assertAccess()
    const current = getAgentRunConfig(input.agentId, input.workspaceId)
    const selected = getSourcesBySlugs(workspace.rootPath, [input.sourceSlug])[0]
    if (!current || current.agent.id !== input.agentId || !selected || selected.config.id !== source.config.id
      || selected.config.type !== source.config.type || selected.config.provider !== source.config.provider
      || JSON.stringify(selected.config.api) !== JSON.stringify(source.config.api)
      || JSON.stringify(selected.config.mcp) !== JSON.stringify(source.config.mcp)
      || !selected.config.enabled
      || !allowsSource(input.workspaceId, current.sources, source))
      throw new Error('Source access or configuration changed before execution.')
  }
  assertSource()
  if (!isSourceUsable(source)) return { success: false, needsAuthentication: true, error: 'Authenticate this source before testing its connection.' }
  if (source.config.type === 'api') return testMastraApiSource({ ...input, source, assertSource })
  if (source.config.type !== 'mcp' || source.config.mcp?.transport === 'stdio') return { success: false, error: 'Local source connection tests require an isolated filesystem or subprocess boundary, which is unavailable.' }
  const client = new Client({ name: 'native-source-test', version: '1.0.0' })
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(30000)])
  let responseBytes = 0
  const assertCurrent = () => {
    signal.throwIfAborted()
    assertSource()
    if ((input.getMode?.() ?? input.mode) !== input.mode) throw new Error('The permission mode changed.')
  }
  try {
    const credentials = getSourceCredentialManager()
    const token = await credentials.getToken(source)
    const credential = await credentials.getApiCredential(source)
    assertCurrent()
    const config = getSourceServerBuilder().buildMcpServer(source, token, credential)
    if (!config || config.type === 'stdio') throw new Error('The source needs authentication.')
    const endpoint = new URL(config.url)
    if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash) throw new Error('Invalid remote endpoint.')
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: config.headers },
      reconnectionOptions: { maxRetries: 0, maxReconnectionDelay: 0, initialReconnectionDelay: 0, reconnectionDelayGrowFactor: 1 },
      fetch: async (url, init) => {
        assertCurrent()
        if (new URL(url).href !== endpoint.href) throw new Error('The discovery endpoint changed.')
        const response = await fetch(url, { ...init, redirect: 'error', signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal })
        if (!response.ok) {
          await response.body?.cancel()
          throw new Error('The source connection test failed.')
        }
        if (Number(response.headers.get('content-length')) > 65536 || response.headers.get('content-type')?.includes('text/event-stream')) {
          await response.body?.cancel()
          throw new Error('Discovery requires bounded JSON responses.')
        }
        if (!response.body) return response
        const reader = response.body.getReader()
        const chunks: Uint8Array[] = []
        let size = 0
        try {
          while (true) {
            assertCurrent()
            const part = await reader.read()
            assertCurrent()
            if (part.done) break
            responseBytes += part.value.byteLength
            size += part.value.byteLength
            if (responseBytes > 65536) throw new Error('Discovery exceeded its response limit.')
            chunks.push(part.value)
          }
        } finally {
          await reader.cancel().catch(() => {})
          reader.releaseLock()
        }
        return new Response(Buffer.concat(chunks, size), { status: response.status, headers: response.headers })
      },
    })
    await client.connect(transport, { signal, timeout: 30000 })
    const result = await client.listTools({}, { signal, timeout: 30000 })
    assertCurrent()
    if (result.nextCursor || result.tools.length > 100) return { success: false, error: 'Remote discovery exceeds the native tool limit.' }
    return { success: true, toolCount: result.tools.length }
  } catch {
    input.signal.throwIfAborted()
    return { success: false, error: 'The remote source connection test could not complete. Native discovery requires bounded JSON responses at the pinned endpoint.' }
  } finally {
    await client.close().catch(() => {})
  }
}
