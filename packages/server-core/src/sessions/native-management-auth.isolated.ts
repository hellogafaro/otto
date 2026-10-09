import { afterAll, beforeAll, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const root = process.cwd()
const WebSocket = createRequire(join(root, 'package.json'))('ws')
const fixtureRoot = mkdtempSync(join(tmpdir(), 'otto-test-management-auth-'))
const evidence = join(process.env.HOME!, '.capy/work/native-management-auth')
const webui = join(fixtureRoot, 'webui')
mkdirSync(webui)
mkdirSync(evidence, { recursive: true })
writeFileSync(join(webui, 'index.html'), '<!doctype html><title>Disposable management auth fixture</title>')
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const sourceFiles = ['packages/server-core/src/sessions/session-manager.ts', 'packages/server-core/src/sessions/mastra-management-tools.ts', 'packages/server-core/src/sessions/native-approvals.ts', 'packages/server-core/src/sessions/native-routine-run.ts', 'packages/server-core/src/handlers/rpc/sessions.ts', 'packages/shared/src/sessions/storage.ts', 'packages/shared/src/sessions/chats.ts', 'packages/shared/src/automations/routine-runner.ts', 'packages/shared/src/agents/index.ts', 'packages/shared/src/bundles/store.ts', 'packages/shared/src/statuses/crud.ts', 'packages/shared/src/statuses/storage.ts', 'packages/shared/src/labels/crud.ts', 'packages/server-core/src/sessions/native-management-auth.isolated.ts', 'packages/server-core/src/sessions/native-management-auth.test.ts']
const hashes = () => Object.fromEntries(sourceFiles.map((file) => [file, createHash('sha256').update(readFileSync(join(root, file))).digest('hex')]))
const initialHashes = hashes()
const names = ['normal-cookie-auth', 'agent_create', 'agent_update', 'agent_configure', 'agent_delete', 'protected-default-refusal', 'routine_create', 'routine_update', 'routine_pause', 'routine_activate', 'routine_run', 'routine_delete', 'prompt-only-isolation', 'skill_create', 'skill_update', 'skill_delete', 'skill-preservation', 'status_create', 'status_update', 'status_delete', 'status_reorder', 'status_set_default', 'status-default-future-chat', 'status-default-refusal', 'label_create', 'label_update', 'label_delete', 'label_reorder', 'label_move', 'agent-version-negative', 'routine-version-negative', 'skill-version-negative', 'status-version-negative', 'label-version-negative', 'agent-unknown-input-negative', 'routine-unknown-input-negative', 'skill-unknown-input-negative', 'status-unknown-input-negative', 'label-unknown-input-negative', 'capability-negative', 'role-negative', 'hash-request-negative', 'approval-denial-negative', 'storage-reload']
const matrix: Record<string, { status: 'pass' | 'fail' | 'unverified'; detail?: string }> = Object.fromEntries(names.map((name) => [name, { status: 'unverified' }]))
for (const name of ['agent-role-negative', 'routine-role-negative', 'skill-role-negative', 'status-role-negative', 'label-role-negative']) matrix[name] = { status: 'unverified' }
for (const name of ['status-explicit-override', 'status-default-change-retains-existing-chat']) matrix[name] = { status: 'unverified' }
matrix['cold-process-reload'] = { status: 'unverified', detail: 'No backend restart was authorized. Storage proof covers a fresh normal-cookie RPC connection plus persisted official Mastra rows, not a cold-process reload.' }
matrix['active-preview'] = { status: 'unverified', detail: 'This fixture never interacts with the active preview, its profile, real providers or keychain.' }
const sourceLogs: string[] = []
const receipts: Record<string, unknown>[] = []
const sockets: InstanceType<typeof WebSocket>[] = []
let processHandle: ReturnType<typeof Bun.spawn> | undefined
let script: { name: string; args: Record<string, unknown> }[] = []
const wireShapes = new Map<string, { strict?: boolean; fields: string[]; required: string[] }>()
const requests: { path: string; authorized: boolean; routine: boolean }[] = []
const routinePrompt = 'Fictional confined routine prompt. Return only a deterministic sentence; do not call any tool.'
const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  const path = new URL(request.url).pathname
  const authorized = request.headers.get('authorization') === 'Bearer controlled-fixture-key'
  if (!authorized) return new Response('Unexpected fixture credential', { status: 401 })
  if (path === '/v1/models') { requests.push({ path, authorized, routine: false }); return Response.json({ object: 'list', data: [{ id: 'fixture', object: 'model', owned_by: 'fixture' }] }) }
  if (path !== '/v1/responses') return new Response('Unsupported fixture route', { status: 404 })
  const body = await request.json() as { input?: unknown; tools?: { name: string; strict?: boolean; parameters?: { required?: string[]; properties?: Record<string, unknown> } }[] }
  const title = JSON.stringify(body.input).includes('Reply with ONLY')
  const routine = !title && Array.isArray(body.input) && body.input.some((item) => item.role === 'user' && JSON.stringify(item.content).includes(routinePrompt))
  requests.push({ path, authorized, routine })
  for (const tool of body.tools ?? []) wireShapes.set(tool.name, { strict: tool.strict, fields: Object.keys(tool.parameters?.properties ?? {}), required: tool.parameters?.required ?? [] })
  const call = !title && !routine ? script.shift() : undefined
  const item = call ? { type: 'function_call', id: crypto.randomUUID(), call_id: crypto.randomUUID(), name: call.name, arguments: JSON.stringify(call.args), status: 'completed' } : { type: 'message', id: crypto.randomUUID() }
  const parts = [
    { type: 'response.created', response: { id: crypto.randomUUID(), created_at: 0, model: 'fixture' } },
    { type: 'response.output_item.added', output_index: 0, item },
    ...(call ? [
      { type: 'response.function_call_arguments.delta', item_id: item.id, output_index: 0, delta: item.arguments },
      { type: 'response.function_call_arguments.done', item_id: item.id, output_index: 0, arguments: item.arguments },
      { type: 'response.output_item.done', output_index: 0, item },
    ] : [{ type: 'response.output_text.delta', item_id: item.id, delta: title ? 'Fictional management task' : routine ? 'Deterministic confined routine result.' : 'Deterministic management result.' }]),
    { type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
  ]
  return new Response(parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
} })

async function prove<T>(name: string, check: () => Promise<T>): Promise<T> {
  try { const value = await check(); matrix[name] = { status: 'pass' }; return value }
  catch (error) { matrix[name] = { status: 'fail', detail: error instanceof Error ? error.stack : String(error) }; throw error }
}

async function startSourceServer(): Promise<string> {
  expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name).toBe('otto')
  const proc = Bun.spawn([process.execPath, '--no-env-file', 'run', join(root, 'packages/server/src/index.ts')], {
    cwd: root,
    env: { PATH: process.env.PATH!, HOME: fixtureRoot, TMPDIR: fixtureRoot, NODE_ENV: 'test', OTTO_CONFIG_DIR: fixtureRoot, OTTO_STORAGE: 'disk', ENCRYPTION_KEY: '0'.repeat(64), BETTER_AUTH_SECRET: 'x'.repeat(40), BETTER_AUTH_URL: 'http://127.0.0.1:9100', OTTO_OWNER_EMAIL: 'fictional-owner@example.test', OTTO_SERVER_TOKEN: crypto.randomUUID() + crypto.randomUUID(), OTTO_RPC_HOST: '127.0.0.1', OTTO_RPC_PORT: '0', OTTO_HEALTH_PORT: '0', OTTO_WEBUI_DIR: webui, OTTO_WEBUI_SECURE_COOKIE: 'false' },
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
        for (const line of lines) { sourceLogs.push(line); if (stdout && line.startsWith('OTTO_SERVER_URL=')) { clearTimeout(timer); resolve(line.slice('OTTO_SERVER_URL='.length)) } }
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
      if (waiter) { clearTimeout(waiter.timer); pending.delete(message.id); if (message.error) waiter.reject(Object.assign(new Error(message.error.message), { code: message.error.code })); else waiter.resolve(message.result) }
      else if (message.type === 'error') { clearTimeout(timeout); reject(new Error(message.error?.code ?? 'Handshake error')); socket.close() }
    })
    socket.on('error', (error: Error) => { clearTimeout(timeout); reject(error) })
    socket.on('close', () => { clearTimeout(timeout); for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('Fixture connection closed')) } })
  })
}

type Client = Awaited<ReturnType<typeof connect>>
let url: string, cookie: string, client: Client, workspace: any, connection: any, defaultAgent: any, chat: any, ownerId: string
const cookies = new Map<string, string>()
const sql = (query: string, ...args: any[]) => {
  const db = new Database(join(fixtureRoot, 'otto.db'), { readonly: true })
  try { return db.query(query).all(...args) as any[] } finally { db.close() }
}
const routineVersion = (row: any) => digest({ title: row.title, config: row.config, agentId: row.agentId, pausedAt: row.pausedAt, createdBy: row.createdBy })
const statuses = () => client.rpc('statuses:list', workspace.id)
const labels = () => client.rpc('labels:list', workspace.id)
const statusVersion = async () => digest(await statuses())
const labelVersion = async () => digest(await labels())
const post = (path: string, body: object, authCookie?: string) => fetch(url.replace('ws:', 'http:') + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:9100', ...(authCookie ? { cookie: authCookie } : {}) }, body: JSON.stringify(body) })

beforeAll(async () => {
  await prove('normal-cookie-auth', async () => {
    url = await startSourceServer()
    expect((await fetch(url.replace('ws:', 'http:') + '/api/config')).status).toBe(401)
    expect((await post('/api/auth/sign-up/email', { name: 'Fictional owner', email: 'fictional-owner@example.test', password: 'a long enough fixture password' })).status).toBe(200)
    const signed = await post('/api/auth/sign-in/email', { email: 'fictional-owner@example.test', password: 'a long enough fixture password' })
    expect(signed.status).toBe(200)
    cookie = signed.headers.getSetCookie().map((line) => line.split(';')[0]).join('; ')
    await expect(connect(url)).rejects.toThrow('AUTH_FAILED')
    const admin = await connect(url, cookie)
    workspace = await admin.rpc('workspaces:create', join(fixtureRoot, 'workspaces/management'), 'Fictional management boundary')
    expect(realpathSync(workspace.rootPath).startsWith(realpathSync(fixtureRoot) + '/')).toBe(true)
    client = await connect(url, cookie, workspace.id)
    expect(await client.rpc('settings:setupLlmConnection', { slug: 'fixture', title: 'Controlled management endpoint', type: 'openai', scope: 'workspace', credential: 'controlled-fixture-key', baseUrl: provider.url.href + 'v1', defaultModel: 'fixture' })).toEqual({ success: true })
    connection = (await client.rpc('LLM_Connection:list')).find((row: any) => row.slug === 'fixture')
    defaultAgent = (await client.rpc('agents:list')).find((row: any) => row.isDefault)
    await client.rpc('agents:update', defaultAgent.id, { provider: 'openai', model: 'fixture', llmConnectionId: connection.id })
    ownerId = (await client.rpc('workspaces:getMembers', workspace.id)).find((row: any) => row.me).userId
    cookies.set(ownerId, cookie)
    chat = await client.rpc('sessions:create', workspace.id, { name: 'Fictional management fixture', agentId: defaultAgent.id, llmConnectionId: connection.id, permissionMode: 'ask' })
  })
}, 30000)

async function run(name: string, args: Record<string, unknown>, options: { approval?: 'allow' | 'deny' | 'none'; pending?: (request: any, row: any) => Promise<void>; session?: any; refusal?: boolean } = {}) {
  if (!options.session) chat = await client.rpc('sessions:create', workspace.id, { name: `Fictional ${name} fixture`, agentId: defaultAgent.id, llmConnectionId: connection.id, permissionMode: 'ask' })
  const target = options.session ?? chat
  script = [{ name: 'search_tools', args: { query: name } }, { name, args }]
  const start = client.events.length
  await client.rpc('sessions:sendMessage', target.id, 'Exercise only the fictional management contract.')
  const relevant = () => client.events.slice(start).filter((event) => event.sessionId === target.id)
  for (let index = 0; index < 500 && !relevant().some((event) => ['permission_request', 'error', 'complete'].includes(event.type)); index++) await Bun.sleep(20)
  const request = relevant().find((event) => event.type === 'permission_request')
  let pending: any
  if (request) {
    expect(request.request.toolName).toBe(name)
    pending = (await client.rpc('sessions:getMessages', target.id)).messages.find((message: any) => message.toolUseId === request.request.requestId)
    expect(pending.nativeAction.status).toBe('pending')
    expect(pending.toolInput).toEqual({})
    expect(pending.nativeAction.payloadHash).toMatch(/^[a-f0-9]{64}$/)
    expect(pending.nativeAction.eligibleActors).toContain(`user:${ownerId}`)
    await options.pending?.(request, pending)
    if (options.approval === 'none') await client.rpc('sessions:cancel', target.id)
    else {
      const accepted = await client.rpc('sessions:respondToPermission', target.id, request.request.requestId, options.approval !== 'deny', false)
      if (!options.refusal) expect(accepted).toBe(true)
    }
  }
  for (let index = 0; index < 500 && !relevant().some((event) => ['error', 'complete'].includes(event.type)); index++) await Bun.sleep(20)
  expect(relevant().some((event) => ['error', 'complete'].includes(event.type))).toBe(true)
  const messages = (await client.rpc('sessions:getMessages', target.id)).messages
  const row = messages.findLast((message: any) => message.toolName === name)
  expect(row).toBeTruthy()
  expect(messages.some((message: any) => message.toolName === 'search_tools' && message.toolStatus === 'completed')).toBe(true)
  expect(wireShapes.has(name)).toBe(true)
  receipts.push({ name, args, sessionId: target.id, approved: !!request, row })
  if (request && options.approval !== 'none') {
    expect(row.nativeAction.payloadHash).toBe(pending.nativeAction.payloadHash)
    if (row.nativeAction.status === 'approved' || row.nativeAction.status === 'denied') expect(row.nativeAction.actorId).toBe(`user:${ownerId}`)
    expect(await client.rpc('sessions:respondToPermission', target.id, request.request.requestId, true, false)).toBe(false)
  }
  return { row, approved: !!request, result: row.toolStatus === 'completed' ? JSON.parse(row.toolResult) : undefined }
}

async function success(name: string, args: Record<string, unknown>, pending?: (request: any, row: any) => Promise<void>) {
  const tables = ['agents', 'routines', 'routines_history', 'skills', 'statuses', 'labels']
  const before = tables.map((table) => sql(`SELECT * FROM ${table} WHERE workspace_id=? ORDER BY id`, workspace.id))
  const value = await run(name, args, { pending: async (request, row) => {
    expect(tables.map((table) => sql(`SELECT * FROM ${table} WHERE workspace_id=? ORDER BY id`, workspace.id))).toEqual(before)
    await pending?.(request, row)
  } })
  expect(value.approved).toBe(true)
  expect(value.row.toolStatus).toBe('completed')
  expect(value.row.nativeAction.status).toBe('approved')
  return value.result
}

async function refused(name: string, args: Record<string, unknown>) {
  const value = await run(name, args, { refusal: true })
  expect(value.row.toolStatus).toBe('error')
  return value
}

it('creates edits configures and deletes agents while protecting the default identity', async () => {
  const created = await prove('agent_create', async () => {
    const row = await success('agent_create', { title: 'Fictional managed agent', provider: 'openai', model: 'fixture', llmConnectionId: connection.id }, async () => { expect((await client.rpc('agents:list')).some((row: any) => row.title === 'Fictional managed agent')).toBe(false) })
    expect(row.createdBy).toBe(`user:${ownerId}`)
    expect(row.llmConnectionId).toBe(connection.id)
    expect(sql('SELECT title,created_by,llm_connection_id FROM agents WHERE id=?', row.id)[0]).toMatchObject({ title: row.title, created_by: `user:${ownerId}`, llm_connection_id: connection.id })
    return row
  })
  const updated = await prove('agent_update', async () => {
    const row = await success('agent_update', { id: created.id, title: 'Fictional renamed agent', instructions: 'Fictional instructions.', expectedUpdatedAt: created.updatedAt })
    expect(row.title).toBe('Fictional renamed agent')
    expect(row.instructions).toBe('Fictional instructions.')
    return row
  })
  await prove('agent-version-negative', async () => { await refused('agent_delete', { id: created.id, expectedUpdatedAt: created.updatedAt }); expect((await client.rpc('agents:list')).find((row: any) => row.id === created.id)).toEqual(updated) })
  await prove('agent-unknown-input-negative', async () => { const value = await refused('agent_update', { id: updated.id, expectedUpdatedAt: updated.updatedAt, title: 'Never saved', avatarPath: '/fictional/forbidden' }); expect(value.approved).toBe(false); expect((await client.rpc('agents:list')).find((row: any) => row.id === created.id)).toEqual(updated) })
  const configured = await prove('agent_configure', async () => {
    const row = await success('agent_configure', { id: updated.id, expectedUpdatedAt: updated.updatedAt, thinkingLevel: 'low', skills: [], sources: [] })
    expect(row.thinkingLevel).toBe('low')
    expect(row.llmConnectionId).toBe(connection.id)
    return row
  })
  await prove('protected-default-refusal', async () => { const current = (await client.rpc('agents:list')).find((row: any) => row.id === defaultAgent.id); await refused('agent_delete', { id: current.id, expectedUpdatedAt: current.updatedAt }); expect((await client.rpc('agents:list')).find((row: any) => row.id === current.id)).toEqual(current) })
  await prove('agent_delete', async () => { expect(await success('agent_delete', { id: configured.id, expectedUpdatedAt: configured.updatedAt })).toEqual({ deleted: true }); expect(sql('SELECT id FROM agents WHERE id=?', configured.id)).toEqual([]) })
}, 45000)

it('manages prompt-only routines with one confined manual run and no cron wait', async () => {
  const config = { type: 'event', event: 'FlagChange', permissionMode: 'safe', actions: [{ type: 'prompt', prompt: routinePrompt }] }
  const created = await prove('routine_create', async () => {
    const row = await success('routine_create', { title: 'Fictional paused routine', agentId: defaultAgent.id, config })
    expect(row.pausedAt).not.toBeNull()
    expect(row.runs).toEqual([])
    expect(row.createdBy).toBe(`user:${ownerId}`)
    expect(row.config).toEqual(config)
    return row
  })
  await prove('routine-unknown-input-negative', async () => {
    const before = await client.rpc('routines:list')
    for (const action of [{ type: 'script', script: 'fictional-never-run.ts' }, { type: 'webhook', url: 'https://fictional.invalid' }, { type: 'prompt', prompt: routinePrompt, model: 'unapproved' }]) { const value = await refused('routine_create', { title: 'Never created', config: { ...config, actions: [action] } }); expect(value.approved).toBe(false) }
    expect(await client.rpc('routines:list')).toEqual(before)
  })
  const updated = await prove('routine_update', async () => {
    const row = await success('routine_update', { id: created.id, title: 'Fictional renamed routine', expectedVersion: created.version })
    expect(row.title).toBe('Fictional renamed routine')
    expect(row.config).toEqual(config)
    expect(row.pausedAt).toBe(created.pausedAt)
    return row
  })
  await prove('routine-version-negative', async () => { await refused('routine_run', { id: created.id, expectedVersion: created.version }); expect((await client.rpc('routines:get', created.id)).runs).toEqual([]) })
  const activated = await prove('routine_activate', async () => { const row = await success('routine_set_paused', { id: created.id, paused: false, expectedVersion: updated.version }); expect(row.pausedAt).toBeNull(); expect(row.runs).toEqual([]); return row })
  const paused = await prove('routine_pause', async () => { const row = await success('routine_set_paused', { id: created.id, paused: true, expectedVersion: activated.version }); expect(row.pausedAt).not.toBeNull(); expect(row.runs).toEqual([]); return row })
  await prove('routine_run', async () => {
    const result = await success('routine_run', { id: created.id, expectedVersion: paused.version }, async () => { expect((await client.rpc('routines:get', created.id)).runs).toEqual([]) })
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/)
    let row: any
    for (let index = 0; index < 500; index++) { row = await client.rpc('routines:get', created.id); if (row.runs[0]?.status !== 'running') break; await Bun.sleep(20) }
    expect(row.runs).toHaveLength(1)
    expect(row.runs[0].status).toBe('ok')
    expect(row.runs[0].id).toBe(result.id)
    const history = sql('SELECT * FROM routines_history WHERE routine_id=?', created.id)
    expect(history).toHaveLength(1)
    expect(history[0].status).toBe('ok')
    expect(sql('SELECT created_by FROM chats WHERE id=?', history[0].chat_id)[0].created_by).toBe(`user:${ownerId}`)
    const transcript = (await client.rpc('sessions:getMessages', history[0].chat_id)).messages
    expect(transcript.some((message: any) => message.role === 'assistant' && message.content.includes('Deterministic confined routine result.'))).toBe(true)
    expect(transcript.filter((message: any) => message.role === 'tool')).toEqual([])
  })
  await prove('prompt-only-isolation', async () => { expect(requests.filter((request) => request.routine)).toHaveLength(1); expect(requests.every((request) => request.authorized)).toBe(true); expect((await client.rpc('routines:get', created.id)).config.actions).toEqual(config.actions); expect(sql('SELECT * FROM routines_history WHERE routine_id=?', created.id)).toHaveLength(1) })
  await prove('routine_delete', async () => { const row = await client.rpc('routines:get', created.id); await success('routine_delete', { id: created.id, expectedVersion: routineVersion(row) }); expect(sql('SELECT * FROM routines WHERE id=?', created.id)).toEqual([]); expect(sql('SELECT * FROM routines_history WHERE routine_id=?', created.id)).toEqual([]) })
}, 45000)

it('edits only requested skill metadata and preserves ancillary bundle bytes', async () => {
  const slug = 'fictional-managed-skill'
  const created = await prove('skill_create', async () => { const row = await success('skill_create', { slug, title: 'Fictional skill', description: 'Fictional purpose.', instructions: '# Fictional instructions\nNever use external systems.' }); expect(row.createdBy).toBe(`user:${ownerId}`); expect(sql('SELECT title FROM skills WHERE slug=? AND workspace_id=?', slug, workspace.id)[0].title).toBe('Fictional skill'); return row })
  const path = join(workspace.rootPath, 'skills', slug)
  const original = readFileSync(join(path, 'SKILL.md'), 'utf8')
  const withMetadata = original.replace('---\n', '---\nfictional-extra:\n  nested: preserved\n  enabled: false\nalwaysAllow:\n  - fictional_read_only\n')
  writeFileSync(join(path, 'SKILL.md'), withMetadata)
  mkdirSync(join(path, 'references'), { recursive: true })
  writeFileSync(join(path, 'references/fictional.txt'), 'Fictional ancillary bytes.\n')
  const ancillary = readFileSync(join(path, 'references/fictional.txt'))
  const current = await client.rpc('skills:get', workspace.id)
  expect(current.some((row: any) => row.slug === slug)).toBe(true)
  const read = await run('skill_get', { slug })
  expect(read.row.toolStatus).toBe('completed')
  const before = read.result
  expect(before.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)
  const updated = await prove('skill_update', async () => { const row = await success('skill_update', { slug, instructions: '# Updated fictional instructions\nStill no external effects.', expectedUpdatedAt: before.updatedAt }); expect(row.updatedAt).toBeGreaterThan(before.updatedAt); return row })
  await prove('skill-preservation', async () => { const content = readFileSync(join(path, 'SKILL.md'), 'utf8'); expect(content).toContain('fictional-extra:'); expect(content).toContain('nested: preserved'); expect(content).toContain('enabled: false'); expect(content).toContain('fictional_read_only'); expect(content).toContain('# Updated fictional instructions'); expect(content).toContain('name: Fictional skill'); expect(content).toContain('description: Fictional purpose.'); expect(readFileSync(join(path, 'references/fictional.txt'))).toEqual(ancillary); const value = await run('skill_get', { slug }); expect(value.result.alwaysAllow).toEqual(['fictional_read_only']); expect(JSON.stringify(value.result)).not.toContain('fictional-extra') })
  await prove('skill-version-negative', async () => { await refused('skill_delete', { slug, expectedUpdatedAt: before.updatedAt }); expect(existsSync(path)).toBe(true) })
  await prove('skill-unknown-input-negative', async () => { const value = await refused('skill_update', { slug, instructions: 'Never saved', expectedUpdatedAt: updated.updatedAt, files: { 'evil.sh': 'Never executed' } }); expect(value.approved).toBe(false); expect(existsSync(join(path, 'evil.sh'))).toBe(false) })
  await prove('skill_delete', async () => { const value = await run('skill_get', { slug }); await success('skill_delete', { slug, expectedUpdatedAt: value.result.updatedAt }); expect(existsSync(path)).toBe(false); expect(sql('SELECT * FROM skills WHERE slug=? AND workspace_id=?', slug, workspace.id)).toEqual([]) })
}, 45000)

it('manages status CRUD order and default without changing existing chat statuses', async () => {
  const initial = await statuses()
  const created = await prove('status_create', async () => { const row = await success('status_create', { label: 'Fictional reviewed', category: 'open', expectedVersion: digest(initial) }); expect(row.status.label).toBe('Fictional reviewed'); expect(sql('SELECT title FROM statuses WHERE workspace_id=? AND slug=?', workspace.id, row.status.id)[0].title).toBe('Fictional reviewed'); return row })
  await prove('status-version-negative', async () => { await refused('status_create', { label: 'Never created stale', category: 'open', expectedVersion: digest(initial) }); expect((await statuses()).some((row: any) => row.label === 'Never created stale')).toBe(false) })
  await prove('status-unknown-input-negative', async () => { const value = await refused('status_update', { id: created.status.id, expectedVersion: await statusVersion(), label: 'Never changed', isDefault: true }); expect(value.approved).toBe(false); expect((await statuses()).find((row: any) => row.id === created.status.id).label).toBe('Fictional reviewed') })
  await prove('status_update', async () => { const value = await success('status_update', { id: created.status.id, label: 'Fictional complete', category: 'closed', expectedVersion: await statusVersion() }); expect(value.status.label).toBe('Fictional complete'); expect(value.status.category).toBe('closed') })
  await prove('status_reorder', async () => { const ids = (await statuses()).map((row: any) => row.id).reverse(); await success('status_reorder', { ids, expectedVersion: await statusVersion() }); expect((await statuses()).map((row: any) => row.id)).toEqual(ids) })
  await prove('status_set_default', async () => {
    const existingChatId = chat.id
    const old = sql('SELECT status_id FROM chats WHERE id=?', existingChatId)[0]
    await success('status_set_default', { id: created.status.id, expectedVersion: await statusVersion() })
    expect((await statuses()).filter((row: any) => row.isDefault).map((row: any) => row.id)).toEqual([created.status.id])
    expect(sql('SELECT status_id FROM chats WHERE id=?', existingChatId)[0]).toEqual(old)
  })
  await prove('status-default-refusal', async () => { await refused('status_delete', { id: created.status.id, expectedVersion: await statusVersion() }); expect((await statuses()).find((row: any) => row.id === created.status.id).isDefault).toBe(true) })
  let defaultFailure: unknown
  let futureChatId: string | undefined
  try {
    await prove('status-default-future-chat', async () => {
      const future = await client.rpc('sessions:create', workspace.id, { name: 'Fictional future status', agentId: defaultAgent.id, llmConnectionId: connection.id, permissionMode: 'ask' })
      futureChatId = future.id
      const stored = sql('SELECT c.id,c.status_id,s.slug FROM chats c LEFT JOIN statuses s ON c.status_id=s.id WHERE c.id=?', future.id)[0]
      receipts.push({ name: 'status-default-future-chat', expected: created.status.id, future, stored })
      expect(stored.slug).toBe(created.status.id)
    })
  } catch (error) { defaultFailure = error }
  const overrideChatId = await prove('status-explicit-override', async () => {
    const override = await client.rpc('sessions:create', workspace.id, { name: 'Fictional explicit status', agentId: defaultAgent.id, llmConnectionId: connection.id, permissionMode: 'ask', sessionStatus: 'todo' })
    expect(override.sessionStatus).toBe('todo')
    expect(sql('SELECT s.slug FROM chats c JOIN statuses s ON c.status_id=s.id WHERE c.id=?', override.id)[0].slug).toBe('todo')
    expect((await statuses()).find((row: any) => row.isDefault).id).toBe(created.status.id)
    return override.id as string
  })
  await success('status_set_default', { id: 'todo', expectedVersion: await statusVersion() })
  try {
    await prove('status-default-change-retains-existing-chat', async () => {
      expect(sql('SELECT s.slug FROM chats c LEFT JOIN statuses s ON c.status_id=s.id WHERE c.id=?', futureChatId)[0].slug).toBe(created.status.id)
      expect(sql('SELECT s.slug FROM chats c JOIN statuses s ON c.status_id=s.id WHERE c.id=?', overrideChatId)[0].slug).toBe('todo')
      expect((await statuses()).find((row: any) => row.isDefault).id).toBe('todo')
    })
  } catch (error) { defaultFailure ??= error }
  await prove('status_delete', async () => { await success('status_delete', { id: created.status.id, expectedVersion: await statusVersion() }); expect((await statuses()).some((row: any) => row.id === created.status.id)).toBe(false); expect(sql('SELECT * FROM statuses WHERE workspace_id=? AND slug=?', workspace.id, created.status.id)).toEqual([]) })
  if (defaultFailure) throw defaultFailure
}, 45000)

it('manages label CRUD hierarchy moves and sibling ordering', async () => {
  const initial = await labelVersion()
  const parent = await prove('label_create', async () => { const value = await success('label_create', { name: 'Fictional parent', expectedVersion: initial }); expect(value.label.name).toBe('Fictional parent'); return value.label })
  const child = (await success('label_create', { name: 'Fictional child', parentId: parent.id, expectedVersion: await labelVersion() })).label
  const sibling = (await success('label_create', { name: 'Fictional sibling', parentId: parent.id, expectedVersion: await labelVersion() })).label
  await prove('label-version-negative', async () => { await refused('label_delete', { id: parent.id, expectedVersion: initial }); expect((await labels()).some((row: any) => row.id === parent.id)).toBe(true) })
  await prove('label-unknown-input-negative', async () => { const value = await refused('label_update', { id: child.id, name: 'Never changed', parentId: null, expectedVersion: await labelVersion() }); expect(value.approved).toBe(false) })
  await prove('label_update', async () => { const value = await success('label_update', { id: child.id, name: 'Fictional renamed child', valueType: 'string', autoRules: [], expectedVersion: await labelVersion() }); expect(value.label.name).toBe('Fictional renamed child'); expect(value.label.valueType).toBe('string') })
  await prove('label_reorder', async () => { await success('label_reorder', { parentId: parent.id, ids: [sibling.id, child.id], expectedVersion: await labelVersion() }); expect((await labels()).find((row: any) => row.id === parent.id).children.map((row: any) => row.id)).toEqual([sibling.id, child.id]) })
  await prove('label_move', async () => { await success('label_move', { id: child.id, parentId: null, expectedVersion: await labelVersion() }); expect((await labels()).some((row: any) => row.id === child.id)).toBe(true); expect(sql('SELECT parent_id FROM labels WHERE workspace_id=? AND slug=?', workspace.id, child.id)[0].parent_id).toBeNull(); await success('label_move', { id: child.id, parentId: parent.id, expectedVersion: await labelVersion() }); expect((await labels()).find((row: any) => row.id === parent.id).children).toHaveLength(2) })
  await prove('label_delete', async () => { await success('label_delete', { id: parent.id, expectedVersion: await labelVersion() }); expect(sql('SELECT * FROM labels WHERE workspace_id=? AND slug IN (?,?,?)', workspace.id, parent.id, child.id, sibling.id)).toEqual([]) })
}, 45000)

it('binds approvals to the exact human request hash role and capability scope', async () => {
  await prove('hash-request-negative', async () => {
    const args = { title: 'Fictional exact hash agent', provider: 'openai', model: 'fixture', llmConnectionId: connection.id }
    const result = await success('agent_create', args, async (request, row) => {
      expect(row.nativeAction.payloadHash).toBe(digest(args))
      expect(await client.rpc('sessions:respondToPermission', chat.id, row.nativeAction.payloadHash, true, false)).toBe(false)
      expect(await client.rpc('sessions:respondToPermission', chat.id, crypto.randomUUID(), true, false)).toBe(false)
      args.title = 'Fictional forged replacement'
      expect(row.nativeAction.payloadHash).not.toBe(digest(args))
      expect(sql('SELECT id FROM agents WHERE title IN (?,?)', 'Fictional exact hash agent', args.title)).toEqual([])
    })
    expect(result.title).toBe('Fictional exact hash agent')
    expect(sql('SELECT id FROM agents WHERE title=?', args.title)).toEqual([])
  })
  await prove('approval-denial-negative', async () => { const value = await run('agent_create', { title: 'Fictional denied agent', provider: 'openai', model: 'fixture', llmConnectionId: connection.id }, { approval: 'deny' }); expect(value.row.nativeAction.status).toBe('denied'); expect(sql('SELECT id FROM agents WHERE title=?', 'Fictional denied agent')).toEqual([]) })
  await prove('capability-negative', async () => {
    const agent = await client.rpc('agents:create', { title: 'Fictional restricted agent', provider: 'openai', model: 'fixture', llmConnectionId: connection.id, skills: ['fictional-unavailable-capability'] })
    const restricted = await client.rpc('sessions:create', workspace.id, { name: 'Fictional restricted fixture', agentId: agent.id, llmConnectionId: connection.id, permissionMode: 'ask' })
    const value = await run('agent_create', { title: 'Fictional forbidden escalation', provider: 'openai', model: 'fixture', llmConnectionId: connection.id }, { session: restricted })
    expect(value.row.toolStatus).toBe('error')
    expect(sql('SELECT id FROM agents WHERE title=?', 'Fictional forbidden escalation')).toEqual([])
    const skill = await run('skill_create', { slug: 'fictional-forbidden-skill', title: 'Fictional forbidden skill', description: 'Never created.', instructions: 'Never executed.' }, { session: restricted })
    expect(skill.row.toolStatus).toBe('error')
    expect(sql('SELECT id FROM skills WHERE slug=?', 'fictional-forbidden-skill')).toEqual([])
    const current = (await client.rpc('agents:list')).find((row: any) => row.id === agent.id)
    const escalation = await run('agent_configure', { id: agent.id, expectedUpdatedAt: current.updatedAt, skills: [] }, { session: restricted })
    expect(escalation.row.toolStatus).toBe('error')
    expect((await client.rpc('agents:list')).find((row: any) => row.id === agent.id).skills).toEqual(current.skills)
  })
  await prove('role-negative', async () => {
    const invitation = await client.rpc('workspaces:invite', workspace.id, 'fictional-second@example.test')
    expect((await post('/api/auth/sign-up/email', { name: 'Fictional second owner', email: 'fictional-second@example.test', password: 'a second long fixture password' })).status).toBe(200)
    const signed = await post('/api/auth/sign-in/email', { email: 'fictional-second@example.test', password: 'a second long fixture password' })
    expect(signed.status).toBe(200)
    const secondCookie = signed.headers.getSetCookie().map((line) => line.split(';')[0]).join('; ')
    expect((await post('/api/auth/organization/accept-invitation', { invitationId: invitation.id }, secondCookie)).status).toBe(200)
    const second = await connect(url, secondCookie, workspace.id)
    const secondId = (await second.rpc('workspaces:getMembers', workspace.id)).find((row: any) => row.me).userId
    cookies.set(secondId, secondCookie)
    await client.rpc('workspaces:updateMemberRole', workspace.id, secondId, 'owner')
    const firstClient = client, firstId = ownerId
    let otherAgent: any, otherRoutine: any, otherSkill: any
    try {
      client = second
      ownerId = secondId
      otherAgent = await success('agent_create', { title: 'Fictional second-owned agent', provider: 'openai', model: 'fixture', llmConnectionId: connection.id })
      otherRoutine = await success('routine_create', { title: 'Fictional second-owned routine', agentId: defaultAgent.id, config: { type: 'event', event: 'FlagChange', permissionMode: 'safe', actions: [{ type: 'prompt', prompt: routinePrompt }] } })
      otherSkill = await success('skill_create', { slug: 'fictional-second-owned-skill', title: 'Fictional second-owned skill', description: 'Fictional role boundary.', instructions: 'No external effects.' })
    } finally { client = firstClient; ownerId = firstId }
    const cases = [
      { check: 'agent-role-negative', name: 'agent_delete', args: { id: otherAgent.id, expectedUpdatedAt: otherAgent.updatedAt } },
      { check: 'routine-role-negative', name: 'routine_run', args: { id: otherRoutine.id, expectedVersion: otherRoutine.version } },
      { check: 'skill-role-negative', name: 'skill_delete', args: { slug: otherSkill.slug, expectedUpdatedAt: otherSkill.updatedAt } },
      { check: 'status-role-negative', name: 'status_create', args: { label: 'Fictional revoked role status', category: 'open', expectedVersion: await statusVersion() } },
      { check: 'label-role-negative', name: 'label_create', args: { name: 'Fictional revoked role label', expectedVersion: await labelVersion() } },
    ]
    for (const boundary of cases) await prove(boundary.check, async () => {
      const tables = ['agents', 'routines', 'routines_history', 'skills', 'statuses', 'labels']
      const before = tables.map((table) => sql(`SELECT * FROM ${table} WHERE workspace_id=? ORDER BY id`, workspace.id))
      try {
        const result = await run(boundary.name, boundary.args, { approval: 'none', pending: async (request) => {
          await second.rpc('workspaces:updateMemberRole', workspace.id, ownerId, 'member')
          expect(await client.rpc('sessions:respondToPermission', chat.id, request.request.requestId, true, false)).toBe(false)
          expect(tables.map((table) => sql(`SELECT * FROM ${table} WHERE workspace_id=? ORDER BY id`, workspace.id))).toEqual(before)
        } })
        expect(['canceled', 'expired', 'failed']).toContain(result.row.nativeAction.status)
      } finally { await second.rpc('workspaces:updateMemberRole', workspace.id, ownerId, 'owner') }
      expect(tables.map((table) => sql(`SELECT * FROM ${table} WHERE workspace_id=? ORDER BY id`, workspace.id))).toEqual(before)
    })
  })
}, 45000)

it('reloads cookie-visible native receipts and verifies vendor transcript storage without replay', async () => {
  await prove('storage-reload', async () => {
    const snapshot = { agents: sql('SELECT * FROM agents WHERE workspace_id=?', workspace.id), routines: sql('SELECT * FROM routines WHERE workspace_id=?', workspace.id), skills: sql('SELECT * FROM skills WHERE workspace_id=?', workspace.id), statuses: await statuses(), labels: await labels() }
    const reloaded = await connect(url, cookie, workspace.id)
    const readers = new Map<string, Client>([[ownerId, reloaded]])
    for (const receipt of receipts.filter((value: any) => value.row?.nativeAction?.status === 'approved')) {
      const row = (receipt as any).row
      const actor = row.nativeAction.actorId.slice('user:'.length)
      if (!readers.has(actor)) readers.set(actor, await connect(url, cookies.get(actor), workspace.id))
      if (actor !== ownerId) await expect(reloaded.rpc('sessions:getMessages', receipt.sessionId)).rejects.toThrow('Session not found')
      const messages = (await readers.get(actor)!.rpc('sessions:getMessages', receipt.sessionId)).messages
      const saved = messages.find((message: any) => message.toolUseId === row.toolUseId)
      expect(saved).toBeTruthy()
      expect(saved.nativeAction).toEqual(row.nativeAction)
      expect(saved.toolStatus).toBe(row.toolStatus)
      expect(saved.toolInput).toEqual({})
    }
    const tables = sql("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'mastra%'").map((row) => row.name)
    expect(tables).toContain('mastra_messages')
    const vendorRows = sql('SELECT * FROM mastra_messages')
    expect(vendorRows.length).toBeGreaterThan(0)
    const vendor = JSON.stringify(vendorRows)
    expect(vendor).toContain('agent_create')
    expect(vendor).toContain('Deterministic confined routine result.')
    for (const receipt of receipts.filter((value: any) => value.row?.nativeAction?.status === 'approved')) expect(vendor).toContain((receipt as any).row.nativeAction.payloadHash)
    expect(await reloaded.rpc('statuses:list', workspace.id)).toEqual(snapshot.statuses)
    expect(await reloaded.rpc('labels:list', workspace.id)).toEqual(snapshot.labels)
    expect(sql('SELECT * FROM agents WHERE workspace_id=?', workspace.id)).toEqual(snapshot.agents)
    expect(sql('SELECT * FROM routines WHERE workspace_id=?', workspace.id)).toEqual(snapshot.routines)
    expect(sql('SELECT * FROM skills WHERE workspace_id=?', workspace.id)).toEqual(snapshot.skills)
  })
}, 30000)

afterAll(async () => {
  for (const socket of sockets) socket.terminate()
  try { await stopSourceServer() }
  finally {
    provider.stop(true)
    writeFileSync(join(evidence, 'matrix.json'), JSON.stringify({ environment: 'Disposable source-process fixture; not the active preview. No backend restart or preview interaction.', initialHashes, finalHashes: hashes(), matrix, requests, wireShapes: Object.fromEntries(wireShapes), receipts }, null, 2))
    writeFileSync(join(evidence, 'server.log'), sourceLogs.filter((line) => /stage:|name:|code:|errno:|statusCode:|fields:|frames:/.test(line)).join('\n'))
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})
