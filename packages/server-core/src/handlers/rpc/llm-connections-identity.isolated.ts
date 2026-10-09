import { afterAll, beforeAll, expect, it } from 'bun:test'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@otto/shared/protocol'
import { initDb } from '@otto/shared/db'
import { pushSchema } from '../../../../shared/src/db/push'
import { createConnection, deleteConnection, getConnectionById, getCredential, getDefaultConnection, updateConnection, userScope, workspaceScope } from '@otto/shared/connections'
import { addWorkspace, saveConfig, getLlmConnection } from '@otto/shared/config/storage'
import { createWorkspaceMember, deleteWorkspaceMember, loadWorkspaceConfig, updateWorkspaceMemberRole } from '@otto/shared/workspaces'
import { registerLlmConnectionsHandlers } from './llm-connections'
import { getModelRefreshService, initModelRefreshService } from '../../model-fetchers'
import { createMastraChatModel, nativeProviderBaseUrl, streamMastraChat } from '../../sessions/mastra-chat'
import { fetchNativeModels } from '../../model-fetchers/native-provider'
import type { HandlerFn, RequestContext } from '../../transport'

if (!/\/otto-(provider-identity|test)-/.test(process.env.OTTO_CONFIG_DIR ?? '') || process.env.ENCRYPTION_KEY !== '0'.repeat(64)) throw new Error('A disposable provider fixture environment is required.')

type Call = { origin: string; path: string; auth: string | null; key: string | null; version: string | null; body?: any }
const calls: Call[] = []
let fail = false
let gate: { entered: () => void; wait: Promise<void> } | undefined
let inferenceGate: { entered: () => void; wait: Promise<void> } | undefined
let redirect: string | undefined
const wire = async (request: Request) => {
  const url = new URL(request.url)
  const body = request.method === 'POST' ? await request.json() as any : undefined
  calls.push({ origin: url.origin, path: url.pathname, auth: request.headers.get('authorization'), key: request.headers.get('x-api-key'), version: request.headers.get('anthropic-version'), body })
  if (body && inferenceGate) { const current = inferenceGate; inferenceGate = undefined; current.entered(); await current.wait }
  if (redirect) return Response.redirect(redirect, 307)
  if (fail) return new Response('private-provider-body-controlled-private-key', { status: 401 })
  if (url.pathname.endsWith('/models')) {
    if (gate) { const current = gate; gate = undefined; current.entered(); await current.wait }
    return Response.json({ data: [{ id: url.pathname.startsWith('/anthropic') ? 'vendor/anthropic-fixture' : 'vendor/image-instruct-fixture' }, ...(url.pathname.startsWith('/multi-model') ? [{ id: 'vendor/saved-model' }] : [])] })
  }
  if (url.pathname.endsWith('/messages')) return new Response([
    ['message_start', { type: 'message_start', message: { id: 'msg', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }],
    ['message_stop', { type: 'message_stop' }],
  ].map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
  if (url.pathname.endsWith('/chat/completions')) return new Response([
    { id: 'chat', object: 'chat.completion.chunk', created: 0, model: body.model, choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }] },
    { id: 'chat', object: 'chat.completion.chunk', created: 0, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
  ].map((data) => `data: ${JSON.stringify(data)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
  return new Response([
    { type: 'response.created', response: { id: 'response', created_at: 0, model: body.model } },
    { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg' } },
    { type: 'response.output_text.delta', item_id: 'msg', delta: 'OK' },
    { type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
  ].map((data) => `data: ${JSON.stringify(data)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
}
const first = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: wire })
const second = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: wire })
const baseUrl = first.url.href + 'v1'
const nextUrl = second.url.href + 'v1'
const handlers = new Map<string, HandlerFn>()
const owner = 'fixture-owner', member = 'fixture-member', outsider = 'fixture-outsider'
let workspaceId: string
let ctx: RequestContext
const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(ctx, ...args)
const identity = (row: { id: string; slug: string; updatedAt: number }, scope?: 'user' | 'workspace' | 'install') => ({ slug: row.slug, connectionId: row.id, expectedUpdatedAt: row.updatedAt, scope })
const seed = (slug: string, scope: string, extra: Partial<Parameters<typeof createConnection>[0]> = {}) => createConnection({ slug, scope, title: slug, type: 'openai', authType: 'api_key', baseUrl, defaultModel: 'vendor/image-instruct-fixture', ...extra }, { apiKey: `controlled-${scope}-key` })
const holdCatalog = (inference = false) => {
  let entered!: () => void, release!: () => void
  const started = new Promise<void>((resolve) => { entered = resolve })
  const held = { entered, wait: new Promise<void>((resolve) => { release = resolve }) }
  if (inference) inferenceGate = held
  else gate = held
  return { started, release }
}

beforeAll(async () => {
  await pushSchema(initDb())
  saveConfig({ workspaces: [] })
  workspaceId = addWorkspace({ name: 'Provider fixture', rootPath: join(process.env.OTTO_CONFIG_DIR!, 'workspace') }).id
  createWorkspaceMember(workspaceId, owner, 'owner')
  createWorkspaceMember(workspaceId, 'fixture-owner-backup', 'owner')
  createWorkspaceMember(workspaceId, member, 'member')
  ctx = { userId: owner, workspaceId, clientId: 'fixture', webContentsId: null }
  registerLlmConnectionsHandlers({ handle: (channel: string, handler: HandlerFn) => void handlers.set(channel, handler) } as never, {} as never)
  initModelRefreshService(async (slug, scope) => ({ apiKey: getCredential(slug, scope)?.apiKey }))
})
afterAll(() => { first.stop(true); second.stop(true) })

it('lists all authorized shadowed slugs with immutable IDs and no private-user records', async () => {
  const mine = seed('shadowed', userScope(owner)), shared = seed('shadowed', workspaceScope(workspaceId)), install = seed('shadowed', 'install')
  const privateRow = seed('shadowed', userScope(outsider))
  const list = await call(RPC_CHANNELS.llmConnections.LIST_WITH_STATUS)
  expect(list.filter((row: any) => row.slug === 'shadowed').map((row: any) => row.id).sort()).toEqual([mine.id, shared.id, install.id].sort())
  expect(JSON.stringify(list)).not.toContain('controlled-')
  expect(await call(RPC_CHANNELS.llmConnections.GET, identity(privateRow))).toBeNull()
  expect(await call(RPC_CHANNELS.llmConnections.GET, identity(shared, 'workspace'))).toMatchObject({ id: shared.id, scope: shared.scope })
  expect(await call(RPC_CHANNELS.llmConnections.GET, identity(shared, 'user'))).toBeNull()
  expect(await call(RPC_CHANNELS.llmConnections.SET_DEFAULT, identity(shared))).toEqual({ success: true })
  expect(getDefaultConnection(ctx)?.id).toBe(shared.id)
  const status = await call(RPC_CHANNELS.llmConnections.LIST_WITH_STATUS)
  expect(status.filter((row: any) => row.isDefault).map((row: any) => row.id)).toEqual([shared.id])
  expect(await call(RPC_CHANNELS.llmConnections.SET_DEFAULT, 'shadowed')).toEqual({ success: true })
  expect(getDefaultConnection(ctx)?.id).toBe(mine.id)
  ctx = { ...ctx, userId: outsider }
  const outside = await call(RPC_CHANNELS.llmConnections.LIST_WITH_STATUS)
  expect(outside.some((row: any) => row.id === shared.id || row.id === mine.id)).toBe(false)
  ctx = { ...ctx, userId: owner }
  expect((await call(RPC_CHANNELS.llmConnections.TEST, identity(shared))).success).toBe(true)
  expect(calls.at(-1)?.auth).toBe(`Bearer controlled-${shared.scope}-key`)
  expect((await call(RPC_CHANNELS.llmConnections.SAVE, { ...identity(shared), name: 'Exact workspace identity' })).success).toBe(true)
  expect(getConnectionById(mine.id)).toEqual(mine)
  const saved = getConnectionById(shared.id)!
  expect((await call(RPC_CHANNELS.llmConnections.REFRESH_MODELS, identity(saved))).success).toBe(true)
  expect(calls.at(-1)?.auth).toBe(`Bearer controlled-${shared.scope}-key`)
  expect((await call(RPC_CHANNELS.llmConnections.DELETE, identity(shared))).success).toBe(false)
  expect((await call(RPC_CHANNELS.llmConnections.DELETE, identity(getConnectionById(shared.id)!))).success).toBe(true)
  expect(getConnectionById(shared.id)).toBeUndefined()
  expect(getConnectionById(mine.id)).toEqual(mine)
  expect(getConnectionById(install.id)).toEqual(install)
})

it('install records are read-only even for owners and workspace members cannot mutate shared connections', async () => {
  const install = seed('readonly', 'install'), shared = seed('readonly', workspaceScope(workspaceId))
  const before = calls.length
  for (const channel of [RPC_CHANNELS.llmConnections.DELETE, RPC_CHANNELS.llmConnections.REFRESH_MODELS]) expect((await call(channel, identity(install))).success).toBe(false)
  expect((await call(RPC_CHANNELS.llmConnections.SAVE, { ...identity(install), name: 'Changed' })).success).toBe(false)
  expect((await call(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION, { ...identity(install), credential: 'replacement' })).success).toBe(false)
  expect((await call(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION, { slug: 'new-install', type: 'openai', title: 'No', scope: 'install', credential: 'replacement', baseUrl })).success).toBe(false)
  ctx = { ...ctx, userId: member }
  expect((await call(RPC_CHANNELS.llmConnections.SAVE, { ...identity(shared), name: 'Changed' })).success).toBe(false)
  expect((await call(RPC_CHANNELS.llmConnections.DELETE, identity(shared))).success).toBe(false)
  expect((await call(RPC_CHANNELS.llmConnections.SET_WORKSPACE_DEFAULT, workspaceId, identity(shared))).success).toBe(false)
  for (const row of [install, shared]) expect((await call(RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP, { ...identity(row), type: 'openai', apiKey: '', baseUrl: nextUrl, approvedCredentialOrigin: second.url.origin })).success).toBe(false)
  expect(calls).toHaveLength(before)
  expect((await call(RPC_CHANNELS.llmConnections.TEST, identity(install))).success).toBe(true)
  expect(calls.at(-1)?.auth).toBe('Bearer controlled-install-key')
  ctx = { ...ctx, userId: owner }
  expect(getConnectionById(install.id)).toEqual(install)
  expect(getConnectionById(shared.id)).toEqual(shared)
})

it('requires exact identity and exact new-origin approval before reusing any stored key', async () => {
  const row = seed('consent-test', userScope(owner))
  const input = { type: 'openai', baseUrl: nextUrl, model: row.defaultModel, apiKey: '' }
  const before = calls.length
  for (const patch of [{ slug: row.slug }, identity(row), { ...identity(row), scope: 'workspace' }, { ...identity(row), approvedCredentialOrigin: first.url.origin }, { ...identity(row), approvedCredentialOrigin: second.url.origin + '/' }]) expect((await call(RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP, { ...input, ...patch })).success).toBe(false)
  expect(calls).toHaveLength(before)
  expect((await call(RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP, { ...input, ...identity(row), approvedCredentialOrigin: second.url.origin })).success).toBe(true)
  expect(calls.at(-1)).toMatchObject({ origin: second.url.origin, auth: `Bearer controlled-${row.scope}-key`, key: null })
  expect((await call(RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP, { ...input, ...identity(row), apiKey: 'controlled-new-key' })).success).toBe(true)
  expect(calls.at(-1)?.auth).toBe('Bearer controlled-new-key')
  expect(getConnectionById(row.id)).toEqual(row)
})

it('discovers a changed endpoint or protocol model instead of carrying the saved model, and honors explicit model clearing', async () => {
  const row = seed('model-discovery-switch', userScope(owner), { defaultModel: 'vendor/saved-model' })
  const start = calls.length
  expect((await call(RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP, { ...identity(row), type: 'openai', apiKey: '' })).success).toBe(true)
  expect(calls.slice(start).some((request) => request.path.endsWith('/models'))).toBe(false)
  expect(calls.at(-1)?.body.model).toBe('vendor/saved-model')
  expect((await call(RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP, { ...identity(row), type: 'openai', apiKey: '', model: '' })).success).toBe(true)
  expect(calls.at(-1)?.body.model).toBe('vendor/image-instruct-fixture')
  expect((await call(RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP, { ...identity(row), type: 'openai', apiKey: '', baseUrl: nextUrl, approvedCredentialOrigin: second.url.origin })).success).toBe(true)
  expect(calls.at(-1)?.body.model).toBe('vendor/image-instruct-fixture')
  const protocolStart = calls.length
  expect((await call(RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP, { ...identity(row), type: 'openai', apiKey: '', customEndpoint: { api: 'openai-completions' } })).success).toBe(true)
  expect(calls.slice(protocolStart).some((request) => request.path.endsWith('/models'))).toBe(true)
  expect(calls.at(-1)).toMatchObject({ path: '/v1/chat/completions', body: { model: 'vendor/image-instruct-fixture' } })
  expect(getConnectionById(row.id)).toEqual(row)
  const multiModelUrl = first.url.href + 'multi-model/v1'
  expect((await call(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION, { ...identity(row), updateOnly: true, baseUrl: multiModelUrl, defaultModel: null })).success).toBe(true)
  expect(getConnectionById(row.id)?.defaultModel).toBe('vendor/image-instruct-fixture')
})

it('setup and SAVE enforce origin consent, preserve image hints and never change a legacy custom identity', async () => {
  const row = seed('legacy-custom', userScope(owner), { type: 'custom', config: { customEndpoint: { api: 'openai-completions', supportsImages: true } } })
  const before = calls.length
  expect((await call(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION, { slug: 'new-custom', scope: 'user', type: 'custom', title: 'No', credential: 'new', baseUrl, customEndpoint: { api: 'openai-responses' } })).success).toBe(false)
  expect((await call(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION, { ...identity(row), baseUrl: nextUrl, updateOnly: true })).success).toBe(false)
  expect((await call(RPC_CHANNELS.llmConnections.SAVE, { ...identity(row), baseUrl: nextUrl })).success).toBe(false)
  expect(calls).toHaveLength(before)
  expect(getConnectionById(row.id)).toEqual(row)
  expect((await call(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION, { ...identity(row), type: 'openai', baseUrl: nextUrl, updateOnly: true, approvedCredentialOrigin: second.url.origin, customEndpoint: { api: 'openai-responses' } })).success).toBe(true)
  const changed = getConnectionById(row.id)!
  expect(changed).toMatchObject({ id: row.id, slug: row.slug, scope: row.scope, type: 'custom', baseUrl: nextUrl, config: { customEndpoint: { api: 'openai-responses', supportsImages: true } } })
  expect(getCredential(row.slug, row.scope)).toEqual({ apiKey: `controlled-${row.scope}-key` })
  expect(changed.updatedAt).toBeGreaterThan(row.updatedAt)
  expect((await call(RPC_CHANNELS.llmConnections.SAVE, { ...identity(changed), baseUrl, approvedCredentialOrigin: first.url.origin })).success).toBe(true)
  expect((await call(RPC_CHANNELS.llmConnections.SAVE, { ...identity(changed), name: 'Stale' })).success).toBe(false)
})

it('keeps explicit per-model image overrides through endpoint setup, RPC refresh and background refresh', async () => {
  const row = seed('model-image-override', userScope(owner), {
    type: 'custom', config: { customEndpoint: { api: 'openai-completions', supportsImages: true } },
    models: [{ id: 'vendor/image-instruct-fixture', supportsImages: false } as never],
  })
  expect((await call(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION, { ...identity(row), type: 'openai', baseUrl: nextUrl, updateOnly: true, approvedCredentialOrigin: second.url.origin })).success).toBe(true)
  const edited = getConnectionById(row.id)!
  expect(edited.models?.find((model) => typeof model !== 'string' && model.id === 'vendor/image-instruct-fixture')).toMatchObject({ supportsImages: false })
  expect(edited.config.customEndpoint?.supportsImages).toBe(true)
  expect((await call(RPC_CHANNELS.llmConnections.REFRESH_MODELS, identity(edited))).success).toBe(true)
  const refreshed = getConnectionById(row.id)!
  expect(refreshed.models?.find((model) => typeof model !== 'string' && model.id === 'vendor/image-instruct-fixture')).toMatchObject({ supportsImages: false })
  await getModelRefreshService().refreshNow(row.slug, row.scope)
  const background = getConnectionById(row.id)!
  expect(background.models?.find((model) => typeof model !== 'string' && model.id === 'vendor/image-instruct-fixture')).toMatchObject({ supportsImages: false })
  expect(background.config.customEndpoint?.supportsImages).toBe(true)
  expect(getCredential(row.slug, row.scope)).toEqual({ apiKey: `controlled-${row.scope}-key` })
})

it('new OpenAI and Anthropic families support custom URLs, arbitrary safe model IDs and protocol-specific real wire contracts', async () => {
  for (const [type, api, path] of [['openai', 'openai-responses', '/responses'], ['openai', 'openai-completions', '/chat/completions'], ['anthropic', 'anthropic-messages', '/messages']] as const) {
    const endpoint = first.url.href + (type === 'anthropic' ? 'anthropic/v1' : 'v1')
    const slug = `${type}-${api}`
    expect((await call(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION, { slug, type, title: slug, scope: 'user', credential: `controlled-${api}-key`, baseUrl: endpoint, customEndpoint: { api } })).success).toBe(true)
    const saved = getLlmConnection(slug, ctx)!
    expect((await call(RPC_CHANNELS.llmConnections.TEST, { slug, connectionId: saved.id, expectedUpdatedAt: saved.updatedAt })).success).toBe(true)
    const request = calls.at(-1)!
    expect(request.path).toBe(new URL(endpoint).pathname + path)
    expect(request.body.model).toBe(type === 'anthropic' ? 'vendor/anthropic-fixture' : 'vendor/image-instruct-fixture')
    expect(request).toMatchObject(type === 'anthropic' ? { key: 'controlled-anthropic-messages-key', auth: null, version: '2023-06-01' } : { auth: `Bearer controlled-${api}-key`, key: null, version: null })
  }
  expect(nativeProviderBaseUrl({ provider: 'openai' }).href).toBe('https://api.openai.com/v1')
  expect(nativeProviderBaseUrl({ provider: 'anthropic' }).href).toBe('https://api.anthropic.com/v1')
})

it('stale credential and ABA endpoint versions refuse post-await setup writes and refresh sends', async () => {
  const row = seed('stale-setup', userScope(owner))
  const held = holdCatalog()
  const pending = call(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION, { ...identity(row), updateOnly: true, baseUrl })
  await held.started
  updateConnection(row.id, {}, { apiKey: 'controlled-replacement-key' })
  const changed = getConnectionById(row.id)!
  held.release()
  expect((await pending).success).toBe(false)
  expect(getConnectionById(row.id)).toEqual(changed)
  let release!: (value: { apiKey: string }) => void
  const service = initModelRefreshService(() => new Promise((resolve) => { release = resolve }))
  const before = calls.length
  const refresh = service.refreshNow(row.slug, row.scope)
  updateConnection(row.id, { baseUrl: nextUrl })
  updateConnection(row.id, { baseUrl })
  release({ apiKey: 'controlled-replacement-key' })
  await refresh
  expect(calls).toHaveLength(before)
  service.stopAll()
  const current = getConnectionById(row.id)!
  const heldAgain = holdCatalog()
  const pendingAgain = call(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION, { ...identity(current), updateOnly: true })
  await heldAgain.started
  deleteConnection(row.id)
  const replacement = seed(row.slug, row.scope)
  heldAgain.release()
  expect((await pendingAgain).success).toBe(false)
  expect(getConnectionById(replacement.id)).toEqual(replacement)
})

it('revoked workspace roles during async setup refuse writes and shared defaults cannot select private rows', async () => {
  const row = seed('role-race', workspaceScope(workspaceId))
  const held = holdCatalog()
  const pending = call(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION, { ...identity(row), updateOnly: true })
  await held.started
  updateWorkspaceMemberRole(workspaceId, owner, 'member')
  held.release()
  expect((await pending).success).toBe(false)
  expect(getConnectionById(row.id)).toEqual(row)
  updateWorkspaceMemberRole(workspaceId, owner, 'owner')
  const privateRow = seed('private-default', userScope(owner))
  expect((await call(RPC_CHANNELS.llmConnections.SET_WORKSPACE_DEFAULT, workspaceId, identity(privateRow))).success).toBe(false)
  expect((await call(RPC_CHANNELS.llmConnections.SET_WORKSPACE_DEFAULT, workspaceId, identity(row))).success).toBe(true)
  expect(loadWorkspaceConfig(join(process.env.OTTO_CONFIG_DIR!, 'workspace'))?.defaults).toMatchObject({ defaultLlmConnection: row.slug, defaultLlmConnectionId: row.id })
  const memberRow = seed('revoked-test', workspaceScope(workspaceId))
  ctx = { ...ctx, userId: member }
  const inference = holdCatalog(true)
  const test = call(RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP, { ...identity(memberRow), type: 'openai', apiKey: '' })
  await inference.started
  deleteWorkspaceMember(workspaceId, member)
  inference.release()
  expect((await test).success).toBe(false)
  const before = calls.length
  expect((await call(RPC_CHANNELS.llmConnections.TEST, identity(memberRow))).success).toBe(false)
  expect(calls).toHaveLength(before)
  createWorkspaceMember(workspaceId, member, 'member')
  ctx = { ...ctx, userId: owner }
})

it('provider failures and redirects are redacted and never forward either header to another origin', async () => {
  const row = seed('redacted', userScope(owner))
  fail = true
  const result = await call(RPC_CHANNELS.llmConnections.TEST, identity(row))
  fail = false
  expect(result.success).toBe(false)
  expect(JSON.stringify(result)).not.toMatch(/controlled-|private-provider-body|127\.0\.0\.1/)
  const before = calls.length
  redirect = nextUrl + '/responses'
  expect((await call(RPC_CHANNELS.llmConnections.TEST, identity(row))).success).toBe(false)
  redirect = undefined
  expect(calls.slice(before).every((request) => request.origin === first.url.origin)).toBe(true)
  const start = calls.length
  for (const input of [{ provider: 'openai', api: 'anthropic-messages', baseUrl }, { provider: 'anthropic', api: 'openai-completions', baseUrl }, { provider: 'openai', baseUrl: first.url.href + 'v1?key=controlled-private-key' }]) expect((await fetchNativeModels({ ...input, apiKey: 'controlled-private-key' }).catch(() => false))).toBe(false)
  expect(calls).toHaveLength(start)
  const model = createMastraChatModel({ provider: 'openai', model: row.defaultModel!, apiKey: 'controlled-path-key', baseUrl })
  const events = []
  for await (const event of streamMastraChat({ agentId: 'fixture-path', name: 'Fixture', instructions: 'Reply OK.', messages: [{ role: 'user', content: 'OK' }], model, signal: AbortSignal.timeout(5000) })) events.push(event)
  expect(events.at(-1)?.type).toBe('complete')
  expect(calls.at(-1)?.path).toBe('/v1/responses')
})

it('official endpoints reject arbitrary models, compatible catalogs allow only safe IDs and inference fetch is origin/path confined', async () => {
  const previousFetch = globalThis.fetch
  const urls: string[] = []
  globalThis.fetch = Object.assign(async (url: Parameters<typeof fetch>[0]) => {
    urls.push(String(url))
    return Response.json({ data: [{ id: 'vendor/custom' }, { id: 'gpt-fixture' }, { id: 'claude-fixture' }, { id: 'unsafe\nmodel' }, { id: '/unsafe' }, { id: 'gpt-audio-fixture' }] })
  }, { preconnect: previousFetch.preconnect }) as typeof fetch
  try {
    expect((await fetchNativeModels({ provider: 'openai', apiKey: 'controlled-key' })).models.map((model) => model.id)).toEqual(['gpt-fixture'])
    expect((await fetchNativeModels({ provider: 'anthropic', apiKey: 'controlled-key' })).models.map((model) => model.id)).toEqual(['claude-fixture'])
    expect(urls).toEqual(['https://api.openai.com/v1/models', 'https://api.anthropic.com/v1/models?limit=100'])
    expect((await fetchNativeModels({ provider: 'openai', apiKey: 'controlled-key', baseUrl })).models.map((model) => model.id)).toEqual(['claude-fixture', 'gpt-audio-fixture', 'gpt-fixture', 'vendor/custom'])
    expect(() => createMastraChatModel({ provider: 'openai', apiKey: 'controlled-key', model: 'vendor/custom' })).toThrow('model ID')
    expect(() => createMastraChatModel({ provider: 'anthropic', apiKey: 'controlled-key', model: 'vendor/custom' })).toThrow('model ID')
    expect(() => createMastraChatModel({ provider: 'openai', apiKey: 'controlled-key', model: 'unsafe\nmodel', baseUrl })).toThrow('model ID')
    expect(() => createMastraChatModel({ provider: 'openai', apiKey: '', model: 'gpt-fixture', baseUrl })).toThrow('API key')
    const model = createMastraChatModel({ provider: 'openai', apiKey: 'controlled-key', model: 'vendor/custom', baseUrl }) as unknown as { config: { fetch: typeof fetch } }
    const before = urls.length
    for (const target of [nextUrl + '/responses', first.url.href + 'v1-other/responses', first.url.href + 'v1/../private', first.url.href + 'v1/%2e%2e/private']) await expect(model.config.fetch(target)).rejects.toThrow('leave its configured endpoint')
    expect(urls).toHaveLength(before)
  } finally { globalThis.fetch = previousFetch }
})
