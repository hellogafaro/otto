import { afterAll, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const root = process.cwd()
const WebSocket = createRequire(join(root, 'package.json'))('ws')
const fixtureRoot = mkdtempSync(join(tmpdir(), 'otto-test-auth-rpc-'))
const webui = join(fixtureRoot, 'webui')
mkdirSync(webui)
writeFileSync(join(webui, 'index.html'), '<!doctype html><title>Disposable auth fixture</title>')
const sourceLogs: string[] = []
const sockets: InstanceType<typeof WebSocket>[] = []
let processHandle: ReturnType<typeof Bun.spawn> | undefined
const baseline = process.env.DOCUMENT_OLD_VALIDATOR === '1'
const evidence = join(process.env.HOME!, '.capy/work/native-document-continuation')
mkdirSync(evidence, { recursive: true })
const taskTitle = 'Fictional AI document'
const finalText = 'Read-only fixture response.'
const requests: { path: string; authorized: boolean }[] = []
const validArgs = { title: taskTitle, content: '# Fictional explanation', parentId: null }
let nextArgs: Record<string, unknown> | undefined = validArgs
let failProvider = false
let wire: { strict?: boolean; required: string[]; nullable: string[] } | undefined
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
  const title = JSON.stringify(body.input).includes('Reply with ONLY')
  const call = !title && nextArgs ? { name: 'create_document', args: nextArgs } : undefined
  if (call) { nextArgs = undefined; failProvider = true }
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
  finally { provider.stop(true); writeFileSync(join(evidence, baseline ? 'baseline-server.log' : 'success-server.log'), sourceLogs.filter((line) => /stage:|name:|code:|errno:|statusCode:|fields:|frames:|binding baseline/.test(line)).join('\n')); rmSync(fixtureRoot, { recursive: true, force: true }) }
})

it('separates normal-auth document writes, approval failures and provider continuation faults without replay', async () => {
  let url = await startSourceServer()
  const base = url.replace('ws:', 'http:')
  const post = (path: string, body: object) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:9100' }, body: JSON.stringify(body) })
  expect((await fetch(base + '/api/config')).status).toBe(401)
  expect((await post('/api/auth/sign-up/email', { name: 'Fictional owner', email: 'fictional-owner@example.test', password: 'a long enough fixture password' })).status).toBe(200)
  const signin = await post('/api/auth/sign-in/email', { email: 'fictional-owner@example.test', password: 'a long enough fixture password' })
  expect(signin.status).toBe(200)
  const cookie = signin.headers.getSetCookie().map((line) => line.split(';')[0]).join('; ')
  const session = await (await fetch(base + '/api/auth/get-session', { headers: { cookie } })).json() as { user: { id: string } }
  await expect(connect(url)).rejects.toThrow('AUTH_FAILED')
  const admin = await connect(url, cookie)
  const workspace = await admin.rpc('workspaces:create', join(fixtureRoot, 'workspaces/documents'), 'Fictional document boundary')
  let client = await connect(url, cookie, workspace.id)
  expect(await client.rpc('settings:setupLlmConnection', { slug: 'fixture', title: 'Controlled document endpoint', type: 'openai', scope: 'workspace', credential: 'controlled-fixture-key', baseUrl: provider.url.href + 'v1', defaultModel: 'fixture' })).toEqual({ success: true })
  const connection = (await client.rpc('LLM_Connection:list')).find((row: any) => row.slug === 'fixture')
  const agent = (await client.rpc('agents:list'))[0]
  await client.rpc('agents:update', agent.id, { provider: 'openai', model: 'fixture', llmConnectionId: connection.id })
  const chat = await client.rpc('sessions:create', workspace.id, { name: 'Document fixture', agentId: agent.id, llmConnectionId: connection.id, permissionMode: 'ask' })
  const documents = () => {
    const database = new Database(join(fixtureRoot, 'otto.db'), { readonly: true })
    try { return database.query("SELECT id FROM library WHERE workspace_id=? AND type='document' ORDER BY id").all(workspace.id) as { id: string }[] } finally { database.close() }
  }
  const until = async (condition: () => boolean) => { for (let count = 0; count < 300 && !condition(); count++) await Bun.sleep(30); expect(condition()).toBe(true) }
  expect(documents()).toEqual([])
  await client.rpc('sessions:sendMessage', chat.id, 'Create a fictional document explaining how AI works.')
  await until(() => client.events.some((event) => event.type === 'permission_request'))
  const request = client.events.find((event) => event.type === 'permission_request').request
  expect(documents()).toEqual([])
  const pending = await client.rpc('sessions:getMessages', chat.id)
  expect(pending.messages.find((message: any) => message.toolUseId === request.requestId).nativeAction.status).toBe('pending')
  expect(await client.rpc('sessions:respondToPermission', chat.id, request.requestId, true, false)).toBe(true)
  await until(() => client.events.some((event) => event.type === 'error'))
  const failedReply = await client.rpc('sessions:getMessages', chat.id)
  const action = failedReply.messages.find((message: any) => message.toolUseId === request.requestId)
  expect(action.nativeAction.actorId).toBe(`user:${session.user.id}`)
  expect(Number.isFinite(action.nativeAction.resolvedAt)).toBe(true)
  if (baseline) {
    expect(documents()).toEqual([])
    expect(action.toolStatus).toBe('error')
    expect(action.nativeAction.status).toBe('failed')
    const bindingLine = sourceLogs.find((line) => line.includes('document binding baseline'))!
    const binding = JSON.parse(bindingLine.slice(bindingLine.indexOf('{')))
    expect(binding).toMatchObject({ toolCallPresent: true, grantPresent: true, matchingName: true, matchingInput: false, differingFields: ['parentId'] })
    return
  }
  expect(documents()).toHaveLength(1)
  expect(action.toolStatus).toBe('completed')
  expect(action.nativeAction.status).toBe('approved')
  expect(action.nativeAction.artifact.id).toBe(documents()[0]!.id)
  expect(client.events.filter((event) => event.type === 'error')).toHaveLength(1)
  expect(client.events.find((event) => event.type === 'error').error).toContain('follow-up')
  expect(JSON.stringify(failedReply)).not.toContain('fixture-private-provider-body')
  expect(sourceLogs.join('\n')).not.toContain('fixture-private-provider-body')
  const firstDocument = documents()[0]!.id
  for (const socket of sockets.splice(0)) socket.terminate()
  await stopSourceServer()
  url = await startSourceServer()
  client = await connect(url, cookie, workspace.id)
  const reloaded = await client.rpc('sessions:getMessages', chat.id)
  expect(reloaded.messages.find((message: any) => message.toolUseId === request.requestId).nativeAction).toEqual(action.nativeAction)
  expect(await client.rpc('sessions:respondToPermission', chat.id, request.requestId, true, false)).toBe(false)
  await client.rpc('sessions:sendMessage', chat.id, 'Discuss the existing document without creating another one.')
  await until(() => client.events.some((event) => event.type === 'complete'))
  expect(documents()).toEqual([{ id: firstDocument }])
  const before = client.events.length
  nextArgs = { title: 'Unavailable target', content: 'Fictional content', parentId: crypto.randomUUID() }
  await client.rpc('sessions:sendMessage', chat.id, 'Exercise the unavailable parent document boundary.')
  await until(() => client.events.slice(before).some((event) => event.type === 'permission_request'))
  const rejectedRequest = client.events.slice(before).find((event) => event.type === 'permission_request').request
  expect(await client.rpc('sessions:respondToPermission', chat.id, rejectedRequest.requestId, true, false)).toBe(true)
  await until(() => client.events.slice(before).some((event) => event.type === 'error'))
  const approvedDecision = client.events.slice(before).find((event) => event.type === 'message_updated' && event.message.toolUseId === rejectedRequest.requestId && event.message.nativeAction?.status === 'approved').message.nativeAction
  const failed = (await client.rpc('sessions:getMessages', chat.id)).messages.find((message: any) => message.toolUseId === rejectedRequest.requestId)
  expect(failed.toolStatus).toBe('error')
  expect(failed.nativeAction.status).toBe('failed')
  expect(failed.nativeAction.actorId).toBe(approvedDecision.actorId)
  expect(failed.nativeAction.resolvedAt).toBe(approvedDecision.resolvedAt)
  expect(failed.nativeAction.title).not.toMatch(/^Allow /)
  expect(failed.nativeAction.summary).toContain('approved')
  expect(documents()).toEqual([{ id: firstDocument }])
}, 60000)
