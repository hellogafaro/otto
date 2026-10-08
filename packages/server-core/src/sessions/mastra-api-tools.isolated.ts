import { afterAll, expect, it } from 'bun:test'
import { join } from 'node:path'
import { addWorkspace, saveConfig } from '@otto/shared/config'
import { CONFIG_DIR } from '@otto/shared/config/paths'
import { createAgent, updateAgent } from '@otto/shared/agents'
import { createSource, executeApiRequest, saveSourceConfig, setSourceCredential, syncLocalSource } from '@otto/shared/sources'
import { ensureDefaultPermissions } from '@otto/shared/agent'
import { openMastraSourceTools } from './mastra-source-tools'
import { runMastraSession } from './mastra-session'
import { closeMastraHistory } from './mastra-history'
import type { LanguageModelV2, LanguageModelV2StreamPart } from '@ai-sdk/provider-v5'
import type { Session } from '@mastra/core/agent-controller'
import { SessionManager, createManagedSession } from './session-manager'
import type { PermissionMode } from '@otto/shared/agent'

const requests: { method: string; path: string; authorization: string | null; body: string }[] = []
let redirected = 0
const foreign = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => { redirected++; return Response.json({ foreign: true }) } })
const endpoint = Bun.serve({
  port: 0, hostname: '127.0.0.1',
  fetch: async (request) => {
    const path = new URL(request.url).pathname
    requests.push({ method: request.method, path, authorization: request.headers.get('authorization'), body: await request.text() })
    if (path.endsWith('/redirect')) return Response.redirect(foreign.url.href)
    if (path.endsWith('/error')) return new Response('controlled-api-secret', { status: 403 })
    if (path.endsWith('/echo')) return Response.json({ token: request.headers.get('authorization') })
    if (path.endsWith('/binary')) return new Response('binary', { headers: { 'content-type': 'application/octet-stream' } })
    if (path.endsWith('/large')) return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(40000)); controller.enqueue(new Uint8Array(40000)); controller.close() } }), { headers: { 'content-type': 'text/plain' } })
    if (path.endsWith('/slow')) {
      await Bun.sleep(150)
      return Response.json({ slow: true })
    }
    return Response.json({ brief: 'Scoped API brief' })
  },
})
afterAll(async () => { endpoint.stop(true); foreign.stop(true); await closeMastraHistory() })

it('confines API endpoints, resolves fresh scoped credentials, enforces mode, bounds output and cancels requests', async () => {
  saveConfig({ workspaces: [] })
  ensureDefaultPermissions()
  const workspace = addWorkspace({ name: 'API fixture', rootPath: join(CONFIG_DIR, 'api-fixture') })
  const source = await createSource(workspace.rootPath, {
    name: 'Fixture API', provider: 'custom', type: 'api',
    api: { baseUrl: `${endpoint.url.href}v1`, authType: 'bearer' },
  })
  source.isAuthenticated = true
  saveSourceConfig(workspace.rootPath, source)
  await syncLocalSource(workspace.id, source.slug)
  await setSourceCredential(workspace.id, source.slug, 'source_bearer', { value: 'controlled-api-secret' })
  const agent = createAgent({ workspaceId: workspace.id, title: 'Scout', provider: 'openai', sources: [source.id], createdBy: 'user:anaaaaaaaaaa' })
  let access = true
  const signal = new AbortController()
  const input = { workspaceId: workspace.id, agentId: agent.id, slugs: [source.slug], sessionPath: join(workspace.rootPath, 'sessions', 'fixture'), signal: signal.signal, assertAccess: () => { signal.signal.throwIfAborted(); if (!access) throw new Error('Access removed') } }
  const opened = await openMastraSourceTools({ ...input, mode: 'safe' })
  const name = `mcp__${source.slug}__api_${source.slug}`
  expect(Object.keys(opened.tools)).toEqual([name])
  const call = (path: string, method = 'GET', params?: Record<string, unknown>) => opened.tools[name]!.execute!({ path, method, params }, {} as never)
  expect(await call('/brief')).toEqual({ status: 200, content: JSON.stringify({ brief: 'Scoped API brief' }) })
  expect(requests.at(-1)).toMatchObject({ method: 'GET', path: '/v1/brief', authorization: 'Bearer controlled-api-secret' })
  await expect(call('/brief', 'POST')).rejects.toThrow('not allowed')
  const before = requests.length
  for (const path of ['//foreign', '/../foreign', '/%2e%2e/foreign', '/%252e%252e/foreign', '/\\foreign', 'http://foreign', '/brief#x']) {
    expect(await call(path)).toHaveProperty('error')
  }
  expect(requests.length).toBe(before)
  expect(await call('/redirect')).toHaveProperty('error')
  expect(redirected).toBe(0)
  expect(JSON.stringify(await call('/error'))).not.toContain('controlled-api-secret')
  expect(await call('/echo')).toHaveProperty('error')
  expect(await call('/binary')).toHaveProperty('error')
  expect(await call('/large')).toHaveProperty('error')
  await setSourceCredential(workspace.id, source.slug, 'source_bearer', { value: 'controlled-new-secret' })
  await call('/brief')
  expect(requests.at(-1)?.authorization).toBe('Bearer controlled-new-secret')
  const escapedCredential = 'controlled-quote"slash\\secret'
  await setSourceCredential(workspace.id, source.slug, 'source_bearer', { value: escapedCredential })
  expect(await call('/echo')).toEqual({ error: 'The API response contained source authentication material and was withheld.' })
  await setSourceCredential(workspace.id, source.slug, 'source_bearer', { value: 'controlled-new-secret' })
  updateAgent(workspace.id, agent.id, { sources: ['unavailable'] })
  await expect(call('/brief')).rejects.toThrow('Source access')
  updateAgent(workspace.id, agent.id, { sources: [source.id] })
  access = false
  await expect(call('/brief')).rejects.toThrow('Access removed')
  access = true
  source.api!.baseUrl = foreign.url.href
  saveSourceConfig(workspace.rootPath, source)
  await expect(call('/brief')).rejects.toThrow('configuration changed')
  source.api!.baseUrl = `${endpoint.url.href}v1`
  saveSourceConfig(workspace.rootPath, source)
  await opened.close()
  const writable = await openMastraSourceTools({ ...input, mode: 'ask' })
  let native: Session | undefined
  let modelCalls = 0
  const beforeApproval = requests.length
  const model: LanguageModelV2 = {
    specificationVersion: 'v2', provider: 'fixture', modelId: 'fixture', supportedUrls: {},
    doGenerate: async () => { throw new Error('stream only') },
    doStream: async () => {
      const parts: LanguageModelV2StreamPart[] = modelCalls++ === 0 ? [
        { type: 'tool-call', toolCallId: 'api-approved-call', toolName: name, input: '{"path":"/brief","method":"POST","params":{"title":"approved"}}' },
        { type: 'finish', finishReason: 'tool-calls', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
      ] : [
        { type: 'text-start', id: 'done' }, { type: 'text-delta', id: 'done', delta: 'Scoped API call completed.' }, { type: 'text-end', id: 'done' },
        { type: 'finish', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
      ]
      return { stream: new ReadableStream({ start(controller) { controller.enqueue({ type: 'stream-start', warnings: [] }); for (const part of parts) controller.enqueue(part); controller.close() } }) }
    },
  }
  const events: unknown[] = []
  await runMastraSession({
    chatId: crypto.randomUUID(), workspaceId: workspace.id, ownerId: 'fixture-owner', agentId: agent.id, name: agent.title,
    instructions: 'Use only the approved source.', messages: [{ role: 'user', content: 'Create the brief.' }], model, tools: writable.tools,
    signal: signal.signal, assertAccess: input.assertAccess, policy: () => 'ask', onReady: (session) => { native = session },
    onApproval: (id, toolName, args) => {
      expect(requests.length).toBe(beforeApproval)
      expect(toolName).toBe(name)
      expect(args).toMatchObject({ path: '/brief', method: 'POST' })
      void native!.respondToToolApproval({ toolCallId: id, decision: 'approve' })
    },
    emit: async (event) => { events.push(event) },
  })
  expect(requests.length).toBe(beforeApproval + 1)
  expect(JSON.stringify(events)).toContain('Scoped API call completed.')
  expect(JSON.stringify(events)).not.toContain('controlled-new-secret')
  expect(await writable.tools[name]!.execute!({ path: '/brief', method: 'POST', params: { _rawBody: 'approved body', _contentType: 'text/plain' } }, {} as never)).toHaveProperty('content')
  expect(requests.at(-1)).toMatchObject({ method: 'POST', body: 'approved body' })
  const pending = writable.tools[name]!.execute!({ path: '/slow', method: 'GET' }, {} as never)
  await Bun.sleep(30)
  signal.abort()
  await expect(pending).rejects.toThrow()
  await writable.close()
  await expect(executeApiRequest({ name: 'query', baseUrl: `${endpoint.url.href}v1`, auth: { type: 'query', queryParam: 'token' } }, 'controlled-query-secret', { method: 'GET', path: '/brief?token=override' }, { confineToBaseUrl: true })).rejects.toThrow('authentication is managed')
  await expect(executeApiRequest({ name: 'query', baseUrl: `${endpoint.url.href}v1`, auth: { type: 'query', queryParam: 'token' } }, 'controlled-query-secret', { method: 'GET', path: '/brief', params: { token: 'override' } }, { confineToBaseUrl: true })).rejects.toThrow('authentication is managed')
  expect(redirected).toBe(0)
})

it('changing native Execute to Explore or Ask cancels stale grants and prevents the next POST', async () => {
  const workspace = addWorkspace({ name: 'Mode fixture', rootPath: join(CONFIG_DIR, 'mode-fixture') })
  const source = await createSource(workspace.rootPath, { name: 'Mode API', provider: 'custom', type: 'api', api: { baseUrl: endpoint.url.href, authType: 'none' } })
  await syncLocalSource(workspace.id, source.slug)
  const agent = createAgent({ workspaceId: workspace.id, title: 'Scout', provider: 'openai', sources: [source.id], createdBy: 'user:anaaaaaaaaaa' })
  for (const next of ['safe', 'ask'] as const) {
    const managed = createManagedSession({ id: crypto.randomUUID(), permissionMode: 'allow-all' }, workspace)
    managed.isProcessing = true
    const abort = new AbortController()
    managed.mastraAbort = abort
    let stopped = 0
    managed.mastraStop = () => { stopped++ }
    const events: { type: string }[] = []
    const manager = Object.create(SessionManager.prototype) as SessionManager
    Object.assign(manager, { sessions: new Map([[managed.id, managed]]), sendEvent: (event: { type: string }) => events.push(event), persistSession: () => {} })
    const opened = await openMastraSourceTools({ workspaceId: workspace.id, agentId: agent.id, slugs: [source.slug], sessionPath: '', mode: 'allow-all', getMode: () => managed.permissionMode as PermissionMode, signal: abort.signal, assertAccess: () => abort.signal.throwIfAborted() })
    const before = requests.length
    manager.setSessionPermissionMode(managed.id, next)
    managed.isProcessing = false
    expect(abort.signal.aborted).toBe(true)
    expect(stopped).toBe(1)
    expect(managed.permissionMode).toBe(next)
    expect(events.some((event) => event.type === 'permission_mode_changed')).toBe(true)
    await expect(opened.tools[`mcp__${source.slug}__api_${source.slug}`]!.execute!({ path: '/brief', method: 'POST' }, {} as never)).rejects.toThrow()
    expect(requests.length).toBe(before)
    await opened.close()
  }
})
