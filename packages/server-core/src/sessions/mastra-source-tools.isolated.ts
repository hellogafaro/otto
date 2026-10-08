import { afterAll, expect, it } from 'bun:test'
import { join } from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { addWorkspace, saveConfig } from '@otto/shared/config'
import { CONFIG_DIR } from '@otto/shared/config/paths'
import { createAgent, updateAgent } from '@otto/shared/agents'
import {
  createSource,
  syncLocalSource,
  setSourceCredential,
  saveSourceConfig,
} from '@otto/shared/sources'
import { streamMastraChat } from './mastra-chat'
import { openMastraSourceTools } from './mastra-source-tools'
import type {
  LanguageModelV2,
  LanguageModelV2StreamPart,
} from '@ai-sdk/provider-v5'
import { ensureDefaultPermissions } from '@otto/shared/agent'
import { updateSetting, workspaceEntity } from '@otto/shared/settings'

let hits = 0,
  closed = 0
const authorizedHeaders: string[] = []
const mcp = new Server(
  { name: 'fixture', version: '1.0.0' },
  { capabilities: { tools: {} } },
)
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get_brief',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
    {
      name: 'create_brief',
      inputSchema: {
        type: 'object',
        properties: { title: { type: 'string' } },
      },
    },
  ],
}))
mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
  hits++
  return {
    content: [{ type: 'text', text: 'Brief ' + request.params.arguments?.id }],
  }
})
const transport = new WebStandardStreamableHTTPServerTransport({
  sessionIdGenerator: () => crypto.randomUUID(),
})
await mcp.connect(transport)
const endpoint = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch: (request) => {
    authorizedHeaders.push(request.headers.get('authorization') ?? '')
    return transport.handleRequest(request)
  },
})
afterAll(async () => {
  endpoint.stop()
  await transport.close()
  await mcp.close()
})

it('discovers and invokes authorized remote MCP through native SDK without shell or cross-workspace context', async () => {
  saveConfig({ workspaces: [] })
  ensureDefaultPermissions()
  const workspace = addWorkspace({
    name: 'Sources',
    rootPath: join(CONFIG_DIR, 'sources-fixture'),
  })
  updateSetting(workspaceEntity(workspace.id), 'permissions', {
    allowedMcpPatterns: ['^mcp__fixture-mcp__get_brief$'],
  })
  const source = await createSource(workspace.rootPath, {
    name: 'Fixture MCP',
    type: 'mcp',
    provider: 'custom',
    mcp: { url: endpoint.url.href, transport: 'http', authType: 'bearer' },
  })
  source.isAuthenticated = true
  saveSourceConfig(workspace.rootPath, source)
  await syncLocalSource(workspace.id, source.slug)
  await setSourceCredential(workspace.id, source.slug, 'source_bearer', {
    value: 'controlled-source-credential',
  })
  const agent = createAgent({
    workspaceId: workspace.id,
    title: 'Scout',
    provider: 'openai',
    sources: [source.id],
    createdBy: 'user:anaaaaaaaaaa',
  })
  let access = true
  const assertAccess = () => {
    if (!access) throw new Error('Access removed')
  }
  const opened = await openMastraSourceTools({
    workspaceId: workspace.id,
    agentId: agent.id,
    slugs: [source.slug],
    sessionPath: join(workspace.rootPath, 'sessions', 'fixture'),
    signal: new AbortController().signal,
    assertAccess,
    mode: 'safe',
  })
  expect(Object.keys(opened.tools)).toEqual([`mcp__${source.slug}__get_brief`])
  let calls = 0
  const model: LanguageModelV2 = {
    specificationVersion: 'v2',
    provider: 'fixture',
    modelId: 'fixture',
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error('stream only')
    },
    doStream: async () => {
      const parts: LanguageModelV2StreamPart[] =
        calls++ === 0
          ? [
              {
                type: 'tool-call',
                toolCallId: 'call1',
                toolName: `mcp__${source.slug}__get_brief`,
                input: '{"id":"approved"}',
              },
              {
                type: 'finish',
                finishReason: 'tool-calls',
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              },
            ]
          : [
              { type: 'text-start', id: 'text' },
              {
                type: 'text-delta',
                id: 'text',
                delta: 'Read the scoped brief.',
              },
              { type: 'text-end', id: 'text' },
              {
                type: 'finish',
                finishReason: 'stop',
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              },
            ]
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] })
            for (const part of parts) controller.enqueue(part)
            controller.close()
          },
        }),
      }
    },
  }
  const events = []
  for await (const event of streamMastraChat({
    agentId: agent.id,
    name: agent.title,
    instructions: 'Read only.',
    messages: [{ role: 'user', content: 'Read brief.' }],
    model,
    tools: opened.tools,
    signal: new AbortController().signal,
  }))
    events.push(event)
  expect(hits).toBe(1)
  expect(
    authorizedHeaders.every(
      (value) => value === 'Bearer controlled-source-credential',
    ),
  ).toBe(true)
  expect(JSON.stringify(events)).not.toContain('controlled-source-credential')
  expect(events.find((event) => event.type === 'tool_result')).toMatchObject({
    isError: false,
  })
  updateAgent(workspace.id, agent.id, { sources: ['unavailable'] })
  await expect(
    opened.tools[`mcp__${source.slug}__get_brief`].execute!(
      { id: 'blocked' },
      {} as never,
    ),
  ).rejects.toThrow('Source access was removed')
  expect(hits).toBe(1)
  await opened.close()
  closed++
  const other = addWorkspace({
    name: 'Foreign',
    rootPath: join(CONFIG_DIR, 'foreign-sources'),
  })
  await expect(
    openMastraSourceTools({
      workspaceId: other.id,
      agentId: agent.id,
      slugs: [source.slug],
      sessionPath: '',
      signal: new AbortController().signal,
      assertAccess,
      mode: 'ask',
    }),
  ).rejects.toThrow('scope is unavailable')
  expect(closed).toBe(1)
})
