import { afterAll, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'

const root = process.cwd()
const WebSocket = createRequire(join(root, 'package.json'))('ws')
const fixtureRoot = mkdtempSync(join(tmpdir(), 'otto-test-auth-rpc-'))
const webui = join(fixtureRoot, 'webui')
mkdirSync(webui)
writeFileSync(join(webui, 'index.html'), '<!doctype html><title>Disposable auth fixture</title>')
const sourceLogs: string[] = []
const sockets: InstanceType<typeof WebSocket>[] = []
let processHandle: ReturnType<typeof Bun.spawn> | undefined
const baseline = false
const evidence = join(process.env.HOME!, '.capy/work/native-source-update-auth')
mkdirSync(evidence, { recursive: true })
const taskTitle = 'Fictional AI document'
const finalText = 'Read-only fixture response.'
const requests: { path: string; authorized: boolean }[] = []
const validArgs = { title: taskTitle, content: '# Fictional explanation', parentId: null }
let nextArgs: Record<string, unknown> | undefined
let nextName = 'create_document'
let script: { name: string; args: Record<string, unknown> }[] = []
const wireShapes = new Map<string, { strict?: boolean; fields: string[]; required: string[] }>()
let failProvider = false
let wire: { strict?: boolean; required: string[]; nullable: string[] } | undefined
let sourceNetworkRequests = 0
const sourceEndpoint = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() { sourceNetworkRequests++; return new Response('Unexpected source fixture request', { status: 500 }) } })
const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  const path = new URL(request.url).pathname
  const authorized = request.headers.get('authorization') === 'Bearer controlled-fixture-key'
  requests.push({ path, authorized })
  if (!authorized) return new Response('Unexpected fixture credential', { status: 401 })
  if (path === '/v1/models') return Response.json({ object: 'list', data: [{ id: 'fixture', object: 'model', owned_by: 'fixture' }] })
  if (path !== '/v1/responses') return new Response('Unsupported fixture route', { status: 404 })
  const body = await request.json() as { input?: unknown; tools?: { name: string; strict?: boolean; parameters?: { required?: string[]; properties?: Record<string, { type?: string | string[]; anyOf?: { type?: string }[] }> } }[] }
  if (failProvider) { failProvider = false; return Response.json({ error: { message: 'fixture-private-provider-body', type: 'invalid_request_error' } }, { status: 400 }) }
  const advertised = body.tools?.find((tool) => tool.name === 'create_document')
  if (advertised) wire = { strict: advertised.strict, required: advertised.parameters?.required ?? [], nullable: Object.entries(advertised.parameters?.properties ?? {}).filter(([, field]) => Array.isArray(field.type) && field.type.includes('null') || field.anyOf?.some((choice) => choice.type === 'null')).map(([key]) => key) }
  for (const tool of body.tools ?? []) wireShapes.set(tool.name, { strict: tool.strict, fields: Object.keys(tool.parameters?.properties ?? {}), required: tool.parameters?.required ?? [] })
  const title = JSON.stringify(body.input).includes('Reply with ONLY')
  const call = !title ? script.shift() : undefined
  
  const item = call ? { type: 'function_call', id: 'fc', call_id: crypto.randomUUID(), name: call.name, arguments: JSON.stringify(call.args), status: 'completed' } : { type: 'message', id: 'msg' }
  const parts = [
    { type: 'response.created', response: { id: crypto.randomUUID(), created_at: 0, model: 'fixture' } },
    { type: 'response.output_item.added', output_index: 0, item },
    ...(call ? [
      { type: 'response.function_call_arguments.delta', item_id: 'fc', output_index: 0, delta: item.arguments },
      { type: 'response.function_call_arguments.done', item_id: 'fc', output_index: 0, arguments: item.arguments },
      { type: 'response.output_item.done', output_index: 0, item },
    ] : [{ type: 'response.output_text.delta', item_id: 'msg', delta: title ? 'Future task' : finalText }]),
    { type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
  ]
  return new Response(parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
} })

async function startSourceServer(): Promise<string> {
  expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name).toBe('otto')
  const entry = baseline ? join(root, 'packages/server-core/src/sessions/native-document-old-validator-fixture.ts') : join(root, 'packages/server/src/index.ts')
  const proc = Bun.spawn([process.execPath, '--no-env-file', 'run', entry], {
    cwd: root,
    env: {
      PATH: process.env.PATH!, HOME: fixtureRoot, TMPDIR: fixtureRoot,
      NODE_ENV: 'test', OTTO_CONFIG_DIR: fixtureRoot, OTTO_STORAGE: 'disk',
      ENCRYPTION_KEY: '0'.repeat(64), BETTER_AUTH_SECRET: 'x'.repeat(40),
      BETTER_AUTH_URL: 'http://127.0.0.1:9100',
      OTTO_OWNER_EMAIL: 'fictional-owner@example.test',
      OTTO_SERVER_TOKEN: crypto.randomUUID() + crypto.randomUUID(),
      OTTO_RPC_HOST: '127.0.0.1', OTTO_RPC_PORT: '0', OTTO_HEALTH_PORT: '0',
      OTTO_WEBUI_DIR: webui, OTTO_WEBUI_SECURE_COOKIE: 'false',
    },
    stdout: 'pipe', stderr: 'pipe',
  })
  processHandle = proc
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Source fixture did not boot within 15s')), 15000)
    const pump = async (stream: ReadableStream<Uint8Array>, stdout: boolean) => {
      let text = ''
      for await (const chunk of stream) {
        text += new TextDecoder().decode(chunk)
        const lines = text.split('\n')
        text = lines.pop()!
        for (const line of lines) {
          sourceLogs.push(line)
          if (stdout && line.startsWith('OTTO_SERVER_URL=')) { clearTimeout(timer); resolve(line.slice('OTTO_SERVER_URL='.length)) }
        }
      }
    }
    void pump(proc.stdout as ReadableStream<Uint8Array>, true)
    void pump(proc.stderr as ReadableStream<Uint8Array>, false)
    void proc.exited.then(() => { clearTimeout(timer); reject(new Error('Source fixture exited before startup')) })
  })
}

async function stopSourceServer() {
  const proc = processHandle
  processHandle = undefined
  if (!proc || proc.exitCode !== null) return
  proc.kill('SIGTERM')
  const deadline = setTimeout(() => proc.kill('SIGKILL'), 10000)
  const code = await proc.exited
  clearTimeout(deadline)
  expect(code).toBe(0)
}

function connect(url: string, cookie?: string, workspaceId?: string) {
  return new Promise<{ rpc: (channel: string, ...args: unknown[]) => Promise<any>; events: any[] }>((resolve, reject) => {
    const socket = new WebSocket(url, { headers: cookie ? { cookie } : {} })
    sockets.push(socket)
    const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
    const events: any[] = []
    const timeout = setTimeout(() => reject(new Error('Fixture handshake timed out')), 10000)
    const rpc = (channel: string, ...args: unknown[]) => new Promise<any>((resolve, reject) => {
      const id = crypto.randomUUID()
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Fixture RPC timed out: ${channel}`)) }, 15000)
      pending.set(id, { resolve, reject, timer })
      socket.send(JSON.stringify({ id, type: 'request', channel, args }))
    })
    socket.on('open', () => socket.send(JSON.stringify({ id: crypto.randomUUID(), type: 'handshake', protocolVersion: '1.0', ...(workspaceId ? { workspaceId } : {}) })))
    socket.on('message', (data: Buffer) => {
      const message = JSON.parse(data.toString())
      if (message.type === 'handshake_ack') { clearTimeout(timeout); resolve({ rpc, events }); return }
      if (message.type === 'event') { if (message.channel === 'session:event') events.push(...message.args); return }
      const waiter = pending.get(message.id)
      if (waiter) {
        clearTimeout(waiter.timer)
        pending.delete(message.id)
        if (message.error) waiter.reject(Object.assign(new Error(message.error.message), { code: message.error.code }))
        else waiter.resolve(message.result)
      } else if (message.type === 'error') { clearTimeout(timeout); reject(new Error(message.error?.code ?? 'Handshake error')); socket.close() }
    })
    socket.on('error', (error: Error) => { clearTimeout(timeout); reject(error) })
    socket.on('close', () => { clearTimeout(timeout); for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('Fixture connection closed')) } })
  })
}

afterAll(async () => {
  for (const socket of sockets) socket.terminate()
  try { await stopSourceServer() }
  finally { provider.stop(true); sourceEndpoint.stop(true); writeFileSync(join(evidence, baseline ? 'baseline-server.log' : 'success-server.log'), sourceLogs.filter((line) => /"stage"|"name"|"code"|"errno"|"statusCode"|"fields"|"frames"/.test(line)).join('\n')); rmSync(fixtureRoot, { recursive: true, force: true }) }
})

it('updates a fictional source through normal cookie Ask approval and reload with safe target metadata', async () => {
  let url = await startSourceServer()
  let base = url.replace('ws:', 'http:')
  const post = (path: string, body: object) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:9100' }, body: JSON.stringify(body) })
  expect((await post('/api/auth/sign-up/email', { name: 'Fictional owner', email: 'fictional-owner@example.test', password: 'a long enough fixture password' })).status).toBe(200)
  const signed = await post('/api/auth/sign-in/email', { email: 'fictional-owner@example.test', password: 'a long enough fixture password' })
  expect(signed.status).toBe(200)
  const cookie = signed.headers.getSetCookie().map((line) => line.split(';')[0]).join('; ')
  await expect(connect(url)).rejects.toThrow('AUTH_FAILED')
  const admin = await connect(url, cookie)
  const workspace = await admin.rpc('workspaces:create', join(fixtureRoot, 'workspaces/sources'), 'Fictional source boundary')
  expect(realpathSync(workspace.rootPath).startsWith(realpathSync(fixtureRoot) + '/')).toBe(true)
  let client = await connect(url, cookie, workspace.id)
  expect(await client.rpc('settings:setupLlmConnection', { slug: 'fixture', title: 'Controlled source endpoint', type: 'openai', scope: 'workspace', credential: 'controlled-fixture-key', baseUrl: provider.url.href + 'v1', defaultModel: 'fixture' })).toEqual({ success: true })
  const connection = (await client.rpc('LLM_Connection:list')).find((row: any) => row.slug === 'fixture'), agent = (await client.rpc('agents:list'))[0]
  await client.rpc('agents:update', agent.id, { provider: 'openai', model: 'fixture', llmConnectionId: connection.id })
  const chat = await client.rpc('sessions:create', workspace.id, { name: 'Source fixture', agentId: agent.id, llmConnectionId: connection.id, permissionMode: 'ask' })
  const source = await client.rpc('sources:create', workspace.id, { name: 'Fictional source', type: 'api', provider: 'custom', enabled: false, api: { baseUrl: 'https://example.invalid', authType: 'none' } })
  const row = () => {
    const db = new Database(join(fixtureRoot, 'otto.db'), { readonly: true })
    try { return db.query('SELECT id,title,slug,hash,type,auth_status,secret_id,created_by,created_at,updated_at FROM sources WHERE workspace_id=? AND slug=?').get(workspace.id, source.slug) as { id: string; title: string; slug: string; hash: string; type: string; auth_status: string; secret_id: string | null; created_by: string; created_at: number; updated_at: number } } finally { db.close() }
  }
  const before = row()
  script = [{ name: 'search_tools', args: { query: 'source_update' } }, { name: 'source_update', args: { slug: before.id, expectedUpdatedAt: before.updated_at, title: 'Updated fictional source', guide: 'fixture-private-guide-body', permissions: { allowedApiEndpoints: [] } } }]
  await client.rpc('sessions:sendMessage', chat.id, 'Update only the fictional source metadata and guide.')
  for (let index = 0; index < 300 && !client.events.some((event) => event.type === 'permission_request' || event.type === 'error'); index++) await Bun.sleep(30)
  const request = client.events.find((event) => event.type === 'permission_request')
  expect(request).toBeTruthy()
  expect(row()).toEqual(before)
  const pending = await client.rpc('sessions:getMessages', chat.id)
  const action = pending.messages.find((message: any) => message.toolUseId === request.request.requestId).nativeAction
  const expectedHash = createHash('sha256').update(JSON.stringify({ title: 'Updated fictional source', guide: 'fixture-private-guide-body', permissions: { allowedApiEndpoints: [] }, slug: before.id, expectedUpdatedAt: before.updated_at })).digest('hex')
  expect(action.payloadHash).toBe(expectedHash)
  expect(await client.rpc('sessions:respondToPermission', chat.id, request.request.requestId, true, false)).toBe(true)
  expect(action.details).toContain(before.id)
  expect(action.details).toContain(before.title)
  expect(action.details).toContain('guide')
  expect(action.details).toContain('allowedApiEndpoints: 0')
  expect(JSON.stringify(action)).not.toContain('fixture-private-guide-body')
  expect(JSON.stringify(action)).not.toContain('https://example.invalid')
  for (let index = 0; index < 300 && !client.events.some((event) => event.type === 'complete' || event.type === 'error'); index++) await Bun.sleep(30)
  const after = row()
  expect(after.id).toBe(before.id)
  expect(after.title).toBe('Updated fictional source')
  expect(after.updated_at).toBeGreaterThan(before.updated_at)
  expect(after.hash).not.toBe(before.hash)
  expect({ type: after.type, authStatus: after.auth_status, secretId: after.secret_id, createdBy: after.created_by, createdAt: after.created_at }).toEqual({ type: before.type, authStatus: before.auth_status, secretId: before.secret_id, createdBy: before.created_by, createdAt: before.created_at })
  const terminal = (await client.rpc('sessions:getMessages', chat.id)).messages.find((message: any) => message.toolUseId === request.request.requestId)
  expect(terminal.toolStatus).toBe('completed')
  expect(terminal.nativeAction.status).toBe('approved')
  expect(terminal.toolInput).toEqual({})
  expect(await client.rpc('sessions:respondToPermission', chat.id, request.request.requestId, true, false)).toBe(false)
  const snapshot = row()
  expect((await client.rpc('sessions:getMessages', chat.id)).messages.find((message: any) => message.toolUseId === request.request.requestId).nativeAction.payloadHash).toBe(action.payloadHash)
  expect(row()).toEqual(snapshot)
  for (const socket of sockets.splice(0)) socket.terminate()
  await stopSourceServer()
  url = await startSourceServer()
  base = url.replace('ws:', 'http:')
  client = await connect(url, cookie, workspace.id)
  expect(row()).toEqual(snapshot)
  const reloadedAction = (await client.rpc('sessions:getMessages', chat.id)).messages.find((message: any) => message.toolUseId === request.request.requestId).nativeAction
  expect(reloadedAction).toEqual(terminal.nativeAction)
  expect(await client.rpc('sessions:respondToPermission', chat.id, request.request.requestId, true, false)).toBe(false)
  const run = async (caller: typeof client, chatId: string, name: string, args: Record<string, unknown>) => {
    script = [{ name: 'search_tools', args: { query: name } }, { name, args }]
    const start = caller.events.length
    await caller.rpc('sessions:sendMessage', chatId, 'Exercise the fictional source binding boundary.')
    for (let count = 0; count < 300 && !caller.events.slice(start).some((event) => event.sessionId === chatId && ['permission_request', 'error', 'complete'].includes(event.type)); count++) await Bun.sleep(30)
    return { start, request: caller.events.slice(start).find((event) => event.sessionId === chatId && event.type === 'permission_request')?.request }
  }
  const stale = await run(client, chat.id, 'source_update', { slug: source.slug, expectedUpdatedAt: before.updated_at, title: 'Stale update' })
  expect(stale.request).toBeTruthy()
  expect(await client.rpc('sessions:respondToPermission', chat.id, stale.request.requestId, true, false)).toBe(false)
  expect(row()).toEqual(snapshot)
  const invalid = await run(client, chat.id, 'source_update', { slug: before.id, expectedUpdatedAt: snapshot.updated_at, title: 'Invalid update', url: 'https://example.invalid/forbidden' })
  expect(invalid.request).toBeUndefined()
  expect(row()).toEqual(snapshot)
  const otherSource = await client.rpc('sources:create', workspace.id, { name: 'Other capability', type: 'api', provider: 'custom', enabled: false, api: { baseUrl: 'https://example.invalid', authType: 'none' } })
  await client.rpc('agents:update', agent.id, { sources: [otherSource.slug] })
  const narrowed = await run(client, chat.id, 'source_update', { slug: before.id, expectedUpdatedAt: snapshot.updated_at, title: 'Restricted update' })
  if (narrowed.request) {
    const restricted = await client.rpc('sessions:getMessages', chat.id)
    expect(restricted.messages.find((message: any) => message.toolUseId === narrowed.request.requestId).nativeAction.eligibleActors).toEqual([])
    expect(await client.rpc('sessions:respondToPermission', chat.id, narrowed.request.requestId, true, false)).toBe(false)
  } else expect(client.events.slice(narrowed.start).some((event) => event.type === 'error' || event.type === 'complete')).toBe(true)
  expect(row()).toEqual(snapshot)
  await client.rpc('sessions:cancel', chat.id)
  await client.rpc('agents:update', agent.id, { sources: [] })
  const invitation = await client.rpc('workspaces:invite', workspace.id, 'fictional-peer@example.test')
  const peerSignup = await post('/api/auth/sign-up/email', { name: 'Fictional peer', email: 'fictional-peer@example.test', password: 'a long enough peer fixture password' })
  expect(peerSignup.status).toBe(200)
  const peerCookie = peerSignup.headers.getSetCookie().map((line) => line.split(';')[0]).join('; ')
  expect((await fetch(base + '/api/auth/organization/accept-invitation', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:9100', cookie: peerCookie }, body: JSON.stringify({ invitationId: invitation.id }) })).status).toBe(200)
  const peer = await connect(url, peerCookie, workspace.id)
  const peerChat = await peer.rpc('sessions:create', workspace.id, { name: 'Peer source fixture', agentId: agent.id, llmConnectionId: connection.id, permissionMode: 'ask' })
  const unowned = await run(peer, peerChat.id, 'source_update', { slug: before.id, expectedUpdatedAt: snapshot.updated_at, title: 'Unowned update' })
  expect(unowned.request).toBeTruthy()
  expect(await peer.rpc('sessions:respondToPermission', peerChat.id, unowned.request.requestId, true, false)).toBe(false)
  expect(row()).toEqual(snapshot)
  await peer.rpc('sessions:cancel', peerChat.id)
  const owned = await peer.rpc('sources:create', workspace.id, { name: 'Peer owned source', type: 'api', provider: 'custom', enabled: false, api: { baseUrl: 'https://example.invalid', authType: 'none' } })
  const db = new Database(join(fixtureRoot, 'otto.db'), { readonly: true })
  const ownRow = db.query('SELECT id,title,hash,updated_at FROM sources WHERE workspace_id=? AND slug=?').get(workspace.id, owned.slug) as { id: string; title: string; hash: string; updated_at: number }
  db.close()
  const permissionEdit = await run(peer, peerChat.id, 'source_update', { slug: ownRow.id, expectedUpdatedAt: ownRow.updated_at, permissions: { allowedApiEndpoints: [] } })
  expect(permissionEdit.request).toBeTruthy()
  const peerPending = await peer.rpc('sessions:getMessages', peerChat.id)
  expect(peerPending.messages.find((message: any) => message.toolUseId === permissionEdit.request.requestId).nativeAction.eligibleActors).toEqual([])
  expect(await peer.rpc('sessions:respondToPermission', peerChat.id, permissionEdit.request.requestId, true, false)).toBe(false)
  const peerAfter = new Database(join(fixtureRoot, 'otto.db'), { readonly: true })
  try { expect(peerAfter.query('SELECT id,title,hash,updated_at FROM sources WHERE workspace_id=? AND slug=?').get(workspace.id, owned.slug)).toEqual(ownRow) } finally { peerAfter.close() }
  await peer.rpc('sessions:cancel', peerChat.id)
  const deletion = await run(client, chat.id, 'source_delete', { slug: before.id, expectedUpdatedAt: snapshot.updated_at })
  expect(deletion.request).toBeTruthy()
  expect(await client.rpc('sessions:respondToPermission', chat.id, deletion.request.requestId, false, false)).toBe(true)
  expect(row()).toEqual(snapshot)
  const ownerId = (await client.rpc('workspaces:getMembers', workspace.id)).find((member: any) => member.me).userId
  const allowChat = await client.rpc('sessions:create', workspace.id, { name: 'Source always-ASK fixture', agentId: agent.id, llmConnectionId: connection.id, permissionMode: 'allow-all', enabledSourceSlugs: [] })
  const sourceRows = () => {
    const database = new Database(join(fixtureRoot, 'otto.db'), { readonly: true })
    try { return database.query('SELECT id,title,slug,hash,type,auth_status,secret_id,created_by,created_at,updated_at FROM sources WHERE workspace_id=? ORDER BY id').all(workspace.id) as ReturnType<typeof row>[] } finally { database.close() }
  }
  const publicRow = (value: ReturnType<typeof row>) => ({ id: value.id, slug: value.slug, title: value.title, type: value.type, authStatus: value.auth_status, createdBy: value.created_by, createdAt: value.created_at, updatedAt: value.updated_at })
  const finish = async (chatId: string, start: number, name: string, request?: any) => {
    for (let count = 0; count < 300 && !client.events.slice(start).some((event) => event.sessionId === chatId && ['error', 'complete'].includes(event.type)); count++) await Bun.sleep(30)
    expect(client.events.slice(start).some((event) => event.sessionId === chatId && event.type === 'complete')).toBe(true)
    expect(client.events.slice(start).some((event) => event.sessionId === chatId && event.type === 'error')).toBe(false)
    const messages = (await client.rpc('sessions:getMessages', chatId)).messages
    const result = request ? messages.find((message: any) => message.toolUseId === request.requestId) : messages.findLast((message: any) => message.toolName === name)
    expect(result.toolStatus).toBe('completed')
    if (request) {
      expect(result.nativeAction.status).toBe('approved')
      expect(result.nativeAction.actorId).toBe(`user:${ownerId}`)
      expect(result.toolInput).toEqual({})
      expect(await client.rpc('sessions:respondToPermission', chatId, request.requestId, true, false)).toBe(false)
    } else expect(client.events.slice(start).some((event) => event.sessionId === chatId && event.type === 'permission_request')).toBe(false)
    const serialized = JSON.stringify(result)
    for (const privateValue of [sourceEndpoint.url.href, 'https://example.invalid', 'fixture-private-guide-body', 'fixture-source-auth-value']) expect(serialized).not.toContain(privateValue)
    return { message: result, value: JSON.parse(result.toolResult) }
  }
  await client.rpc('workspaceSettings:update', workspace.id, 'enabledSourceSlugs', [otherSource.slug])
  const defaultsBefore = await client.rpc('workspaceSettings:get', workspace.id)
  const capabilitiesBefore = (await client.rpc('agents:list')).find((value: any) => value.id === agent.id).sources
  const rowsBeforeCreate = sourceRows()
  const draftArgs = { title: 'Native disabled source draft', type: 'api', url: sourceEndpoint.url.href + 'fictional-api' }
  const creation = await run(client, allowChat.id, 'source_create', draftArgs)
  expect(creation.request).toBeTruthy()
  expect(creation.request.toolName).toBe('source_create')
  expect(sourceRows()).toEqual(rowsBeforeCreate)
  const pendingDraft = (await client.rpc('sessions:getMessages', allowChat.id)).messages.find((message: any) => message.toolUseId === creation.request.requestId)
  expect(pendingDraft.nativeAction.eligibleActors).toEqual([`user:${ownerId}`])
  expect(pendingDraft.nativeAction.payloadHash).toBe(createHash('sha256').update(JSON.stringify(draftArgs)).digest('hex'))
  expect(JSON.stringify(pendingDraft.nativeAction)).not.toContain(sourceEndpoint.url.href)
  expect(sourceNetworkRequests).toBe(0)
  expect(await client.rpc('sessions:respondToPermission', allowChat.id, creation.request.requestId, true, false)).toBe(true)
  const created = await finish(allowChat.id, creation.start, 'source_create', creation.request)
  const draft = sourceRows().find((value) => value.id === created.value.id)!
  expect(created.value).toEqual(publicRow(draft))
  expect(draft.created_by).toBe(`user:${ownerId}`)
  expect(draft.created_at).toBeGreaterThan(0)
  expect(draft.updated_at).toBeGreaterThanOrEqual(draft.created_at)
  expect(draft.secret_id).toBeNull()
  expect(draft.auth_status).toBe('ok')
  expect(sourceRows().length).toBe(rowsBeforeCreate.length + 1)
  expect(sourceRows().filter((value) => value.id !== draft.id)).toEqual(rowsBeforeCreate)
  const draftFolder = join(workspace.rootPath, 'sources', draft.slug)
  const draftConfig = JSON.parse(readFileSync(join(draftFolder, 'config.json'), 'utf8'))
  expect(draftConfig.enabled).toBe(false)
  expect(draftConfig.api).toEqual({ baseUrl: draftArgs.url, authType: 'none' })
  expect(draftConfig.id).not.toBe(draft.id)
  expect(await client.rpc('workspaceSettings:get', workspace.id)).toEqual(defaultsBefore)
  expect((await client.rpc('agents:list')).find((value: any) => value.id === agent.id).sources).toEqual(capabilitiesBefore)
  expect((await client.rpc('sessions:get')).find((value: any) => value.id === allowChat.id).enabledSourceSlugs).toEqual([])
  expect(sourceNetworkRequests).toBe(0)
  const privateSource = await client.rpc('sources:create', workspace.id, { name: 'Private auth metadata fixture', type: 'api', provider: 'custom', enabled: false, api: { baseUrl: sourceEndpoint.url.href + 'private-api', authType: 'bearer' } })
  await client.rpc('sources:saveCredentials', workspace.id, privateSource.slug, 'fixture-source-auth-value')
  for (let count = 0; count < 100 && sourceRows().find((value) => value.slug === privateSource.slug)?.auth_status !== 'ok'; count++) await Bun.sleep(30)
  expect(sourceRows().find((value) => value.slug === privateSource.slug)!.auth_status).toBe('ok')
  expect(sourceRows().find((value) => value.slug === privateSource.slug)!.secret_id).toBeTruthy()
  const rowsBeforeReads = sourceRows()
  for (const ref of [draft.id, draft.slug, draftConfig.id, before.id, privateSource.slug]) {
    const read = await run(client, allowChat.id, 'source_get', { slug: ref })
    expect(read.request).toBeUndefined()
    const result = await finish(allowChat.id, read.start, 'source_get')
    const physical = sourceRows().find((value) => value.id === result.value.id)!
    expect(result.value).toEqual(publicRow(physical))
  }
  const list = await run(client, allowChat.id, 'source_list', {})
  expect(list.request).toBeUndefined()
  const listed = await finish(allowChat.id, list.start, 'source_list')
  expect(listed.value.toSorted((left: any, right: any) => left.id.localeCompare(right.id))).toEqual(rowsBeforeReads.map(publicRow).toSorted((left, right) => left.id.localeCompare(right.id)))
  expect(sourceRows()).toEqual(rowsBeforeReads)
  await client.rpc('agents:update', agent.id, { sources: [before.id] })
  const narrowedList = await run(client, allowChat.id, 'source_list', {})
  expect(narrowedList.request).toBeUndefined()
  expect((await finish(allowChat.id, narrowedList.start, 'source_list')).value).toEqual([publicRow(snapshot)])
  const narrowedRead = await run(client, allowChat.id, 'source_get', { slug: draft.id })
  expect(narrowedRead.request).toBeUndefined()
  for (let count = 0; count < 300 && !client.events.slice(narrowedRead.start).some((event) => event.sessionId === allowChat.id && ['error', 'complete'].includes(event.type)); count++) await Bun.sleep(30)
  const deniedRead = (await client.rpc('sessions:getMessages', allowChat.id)).messages.findLast((message: any) => message.toolName === 'source_get')
  expect(deniedRead.toolStatus).toBe('error')
  expect(sourceRows()).toEqual(rowsBeforeReads)
  await client.rpc('agents:update', agent.id, { sources: capabilitiesBefore })
  await client.rpc('workspaceSettings:update', workspace.id, 'enabledSourceSlugs', [otherSource.slug, draft.id, draftConfig.id, draft.slug])
  const approvedDelete = await run(client, allowChat.id, 'source_delete', { slug: draftConfig.id, expectedUpdatedAt: draft.updated_at })
  expect(approvedDelete.request).toBeTruthy()
  expect(approvedDelete.request.toolName).toBe('source_delete')
  expect(sourceRows()).toEqual(rowsBeforeReads)
  expect(existsSync(draftFolder)).toBe(true)
  expect(await client.rpc('sessions:respondToPermission', allowChat.id, approvedDelete.request.requestId, true, false)).toBe(true)
  const deleted = await finish(allowChat.id, approvedDelete.start, 'source_delete', approvedDelete.request)
  expect(deleted.value).toEqual({ deleted: true })
  expect(sourceRows()).toEqual(rowsBeforeReads.filter((value) => value.id !== draft.id))
  expect(existsSync(draftFolder)).toBe(false)
  expect(await client.rpc('workspaceSettings:get', workspace.id)).toEqual(defaultsBefore)
  expect((await client.rpc('agents:list')).find((value: any) => value.id === agent.id).sources).toEqual(capabilitiesBefore)
  expect(row()).toEqual(snapshot)
  expect(sourceNetworkRequests).toBe(0)
  for (const socket of sockets.splice(0)) socket.terminate()
  await stopSourceServer()
  url = await startSourceServer()
  client = await connect(url, cookie, workspace.id)
  expect(sourceRows()).toEqual(rowsBeforeReads.filter((value) => value.id !== draft.id))
  expect(await client.rpc('workspaceSettings:get', workspace.id)).toEqual(defaultsBefore)
  const reloadedOperations = (await client.rpc('sessions:getMessages', allowChat.id)).messages
  expect(reloadedOperations.find((message: any) => message.toolUseId === creation.request.requestId)).toEqual(created.message)
  expect(reloadedOperations.find((message: any) => message.toolUseId === approvedDelete.request.requestId)).toEqual(deleted.message)
  expect(await client.rpc('sessions:respondToPermission', allowChat.id, approvedDelete.request.requestId, true, false)).toBe(false)
  expect(sourceNetworkRequests).toBe(0)
}, 60000)
