import { afterAll, beforeAll, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { RPC_CHANNELS } from '@otto/shared/protocol'
import { createConnection, getConnection, getCredential, getConnections, userScope, workspaceScope } from '@otto/shared/connections'
import { getLlmConnection } from '@otto/shared/config/storage'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'
import { HANDLED_CHANNELS, registerLlmConnectionsHandlers } from './llm-connections'
import { initModelRefreshService } from '../../model-fetchers'
import { NATIVE_PROVIDER_UNSUPPORTED as OPENAI_UNSUPPORTED } from '../../model-fetchers/native-provider'
import { createWorkspaceMember } from '@otto/shared/workspaces'

const calls: { key: string | null; path: string; body?: unknown }[] = []
let fail = false
const server = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(request) {
  const path = new URL(request.url).pathname
  calls.push({ key: request.headers.get('authorization'), path, body: request.method === 'POST' ? await request.json() : undefined })
  if (fail) return new Response('fixture-body-private', { status: 401 })
  if (path.endsWith('/models')) return Response.json({ data: path.startsWith('/anthropic') ? [null, { id: 'claude-fixture' }] : [{ id: 'gpt-fixture' }, { id: 'o3-fixture' }] })
  return new Response([
    { type: 'response.created', response: { id: 'fixture', created_at: 0, model: 'gpt-fixture' } },
    { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg' } },
    { type: 'response.output_text.delta', item_id: 'msg', delta: 'OK' },
    { type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
  ].map((part) => `data: ${JSON.stringify(part)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
} })
afterAll(() => server.stop())
const baseUrl = server.url.href + 'v1'
const handlers = new Map<string, HandlerFn>()
const runtimeRefresh: string[] = []
registerLlmConnectionsHandlers({ handle: (channel: string, handler: HandlerFn) => handlers.set(channel, handler) } as unknown as RpcServer, {
  sessionManager: { refreshConnectionRuntime: async (slug: string) => { runtimeRefresh.push(slug) } },
  platform: { logger: { warn() {} } },
} as unknown as HandlerDeps)
const ctx = { userId: 'native-owner', workspaceId: 'native-workspace', clientId: 'fixture' } as RequestContext
const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(ctx, ...args)
beforeAll(() => createWorkspaceMember(ctx.workspaceId!, ctx.userId!, 'owner'))

it('registers only native Settings and connection handlers, with no executable subscription or Pi discovery routes', () => {
  expect([...handlers.keys()].sort()).toEqual([...HANDLED_CHANNELS].sort())
  for (const channel of ['chatgpt:startOAuth', 'chatgpt:cancelOAuth', 'copilot:startOAuth', 'copilot:cancelOAuth', 'claudeCode:getStatus', 'pi:getApiKeyProviders'])
    expect(handlers.has(channel)).toBe(false)
  const rpc = readFileSync(joinPath('llm-connections.ts'), 'utf8')
  const service = readFileSync(joinPath('../../model-fetchers/index.ts'), 'utf8')
  for (const source of [rpc, service]) {
    expect(source).not.toContain('OTTO_MASTRA_CHAT')
    expect(source).not.toContain('@otto/shared/agent/backend')
    expect(source).not.toContain('@earendil-works/')
    expect(source).not.toContain('PiModelFetcher')
  }
})

const joinPath = (path: string) => new URL(path, import.meta.url)

it('saves custom protocol and Anthropic credentials encrypted in exact personal/workspace scopes', async () => {
  const legacy = createConnection({ slug: 'custom-fixture', type: 'custom', title: 'Custom', scope: userScope(ctx.userId!), authType: 'api_key', baseUrl, config: { customEndpoint: { api: 'openai-responses' } } }, { apiKey: 'controlled-custom-key' })
  expect(await call(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION, { slug: legacy.slug, connectionId: legacy.id, expectedUpdatedAt: legacy.updatedAt, type: 'custom', scope: 'user', baseUrl, defaultModel: 'gpt-fixture' })).toEqual({ success: true })
  expect(getLlmConnection('custom-fixture', ctx)).toMatchObject({ type: 'custom', baseUrl, customEndpoint: { api: 'openai-responses' } })
  expect(getCredential('custom-fixture', userScope(ctx.userId!))).toEqual({ apiKey: 'controlled-custom-key' })
  expect(await call(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION, { slug: 'anthropic-fixture', type: 'anthropic', title: 'Anthropic', scope: 'workspace', credential: 'controlled-anthropic-key', baseUrl: server.url.href + 'anthropic/v1' })).toEqual({ success: true })
  expect(getLlmConnection('anthropic-fixture', { workspaceId: ctx.workspaceId })).toMatchObject({ type: 'anthropic', defaultModel: 'claude-fixture' })
  expect(getCredential('anthropic-fixture', workspaceScope(ctx.workspaceId!))).toEqual({ apiKey: 'controlled-anthropic-key' })
  expect(getCredential('anthropic-fixture', userScope(ctx.userId!))).toBeUndefined()
})

it('uses native catalog/setup/test with the flag absent, and credentials stay in their exact scope', async () => {
  const previous = process.env.OTTO_MASTRA_CHAT
  delete process.env.OTTO_MASTRA_CHAT
  try {
    for (const [scope, key] of [['user', 'user-fixture'], ['workspace', 'workspace-fixture'], ['install', 'install-fixture']] as const) {
      if (scope === 'install') createConnection({ slug: 'native-same', type: 'openai', title: scope, scope, authType: 'api_key', baseUrl, defaultModel: 'o3-fixture' }, { apiKey: key })
      else expect(await call(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION, { slug: 'native-same', type: 'openai', title: scope, scope, credential: key, baseUrl, defaultModel: 'pi/o3-fixture' })).toEqual({ success: true })
      const exact = scope === 'user' ? userScope(ctx.userId!) : scope === 'workspace' ? workspaceScope(ctx.workspaceId!) : 'install'
      expect(getCredential('native-same', exact)).toEqual({ apiKey: key })
    }
    expect(getLlmConnection('native-same', ctx)?.defaultModel).toBe('o3-fixture')
    expect(await call(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION, { slug: 'native-same', scope: 'workspace', updateOnly: true, credential: 'workspace-new', baseUrl })).toEqual({ success: true })
    expect(getCredential('native-same', workspaceScope(ctx.workspaceId!))).toEqual({ apiKey: 'workspace-new' })
    expect(getCredential('native-same', userScope(ctx.userId!))).toEqual({ apiKey: 'user-fixture' })
  } finally {
    if (previous === undefined) delete process.env.OTTO_MASTRA_CHAT
    else process.env.OTTO_MASTRA_CHAT = previous
  }
})

it('preserves unsupported encrypted account rows, rejects execution/default/setup and hides other users', async () => {
  const legacy = createConnection({ slug: 'native-legacy', scope: userScope(ctx.userId!), type: 'openai-codex', authType: 'oauth', title: 'Saved subscription' }, { accessToken: 'oauth-fixture', refreshToken: 'refresh-fixture' })
  createConnection({ slug: 'native-private', scope: userScope('somebody-else'), type: 'openai', authType: 'api_key', title: 'Private' }, { apiKey: 'private-fixture' })
  const before = calls.length
  expect(await call(RPC_CHANNELS.llmConnections.GET, 'native-private')).toBeNull()
  for (const channel of [RPC_CHANNELS.llmConnections.TEST, RPC_CHANNELS.llmConnections.REFRESH_MODELS, RPC_CHANNELS.llmConnections.SET_DEFAULT])
    expect(await call(channel, legacy.slug)).toEqual({ success: false, error: OPENAI_UNSUPPORTED })
  expect(await call(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION, { slug: legacy.slug, type: 'openai', credential: 'replacement' })).toEqual({ success: false, error: OPENAI_UNSUPPORTED })
  expect(await call(RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP, { type: 'github-copilot', apiKey: '' })).toEqual({ success: false, error: OPENAI_UNSUPPORTED })
  expect(calls).toHaveLength(before)
  expect(getConnection(legacy.slug, ctx)).toEqual(legacy)
  expect(getCredential(legacy.slug, legacy.scope)).toEqual({ accessToken: 'oauth-fixture', refreshToken: 'refresh-fixture' })
  const status = await call(RPC_CHANNELS.llmConnections.LIST_WITH_STATUS) as { slug: string; runtimeSupported: boolean; authError?: string }[]
  expect(status.find((row) => row.slug === legacy.slug)).toMatchObject({ runtimeSupported: false, authError: OPENAI_UNSUPPORTED })
  expect(JSON.stringify(status)).not.toContain('oauth-fixture')
  expect(status.some((row) => row.slug === 'native-private')).toBe(false)
})

it('refreshes and validates native keys, preserves saved catalogs on failure, and SAVE cannot change scope/provider/secret', async () => {
  expect(await call(RPC_CHANNELS.llmConnections.REFRESH_MODELS, 'native-same')).toEqual({ success: true })
  expect(calls.at(-1)?.key).toBe('Bearer user-fixture')
  expect(await call(RPC_CHANNELS.llmConnections.TEST, 'native-same')).toEqual({ success: true })
  expect(calls.at(-1)?.body).toMatchObject({ model: 'o3-fixture', stream: true, store: false })
  const before = getLlmConnection('native-same', ctx)
  fail = true
  expect(await call(RPC_CHANNELS.llmConnections.REFRESH_MODELS, 'native-same')).toEqual({ success: false, error: 'Provider model refresh failed. The existing catalog was not changed.' })
  expect(getLlmConnection('native-same', ctx)).toEqual(before)
  fail = false
  expect((await call(RPC_CHANNELS.llmConnections.SAVE, { slug: 'native-same', name: 'Renamed', scope: 'install', type: 'github-copilot', authType: 'oauth', credential: 'injected', createdAt: 99 })).success).toBe(false)
  expect(await call(RPC_CHANNELS.llmConnections.SAVE, { slug: 'native-same', name: 'Renamed', type: 'github-copilot', authType: 'oauth', credential: 'injected', createdAt: 99 })).toEqual({ success: true })
  expect(getLlmConnection('native-same', ctx)).toMatchObject({ name: 'Renamed', type: 'openai', authType: 'api_key', scope: userScope(ctx.userId!) })
  expect(getCredential('native-same', userScope(ctx.userId!))).toEqual({ apiKey: 'user-fixture' })
  expect(runtimeRefresh).toEqual([])
})

it('deduplicates refreshes per exact scope without falling back to another scope or running unsupported providers', async () => {
  const requested: string[] = []
  const service = initModelRefreshService(async (slug, scope) => {
    requested.push(scope)
    return { apiKey: getCredential(slug, scope)?.apiKey }
  })
  const before = calls.length
  await Promise.all([service.refreshNow('native-same', userScope(ctx.userId!)), service.refreshNow('native-same', userScope(ctx.userId!)), service.refreshNow('native-same', 'install')])
  expect(calls.length - before).toBe(2)
  expect(requested).toEqual([userScope(ctx.userId!), 'install'])
  expect(calls.slice(before).map((row) => row.key).sort()).toEqual(['Bearer install-fixture', 'Bearer user-fixture'])
  await service.refreshNow('native-same', userScope('missing-user'))
  await service.refreshNow('native-legacy', userScope(ctx.userId!))
  expect(requested).toHaveLength(2)
  const snapshot = getConnections(ctx)
  fail = true
  await service.refreshNow('native-same', userScope(ctx.userId!))
  fail = false
  expect(getConnections(ctx)).toEqual(snapshot)
  service.stopAll()
})

it('stopping an in-flight refresh leaves its existing catalog unchanged', async () => {
  let release!: (value: { apiKey: string }) => void
  const service = initModelRefreshService(() => new Promise((resolve) => { release = resolve }))
  const before = getLlmConnection('native-same', ctx)
  const start = calls.length
  const refresh = service.refreshNow('native-same', userScope(ctx.userId!))
  service.stopConnection('native-same', userScope(ctx.userId!))
  release({ apiKey: 'user-fixture' })
  await refresh
  expect(calls).toHaveLength(start)
  expect(getLlmConnection('native-same', ctx)).toEqual(before)
})
