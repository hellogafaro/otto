import { afterAll, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = process.cwd()
const WebSocket = createRequire(join(root, 'package.json'))('ws')
const fixtureRoot = mkdtempSync(join(tmpdir(), 'otto-test-recipient-auth-'))
const webui = join(fixtureRoot, 'webui')
mkdirSync(webui)
writeFileSync(join(webui, 'index.html'), '<!doctype html><title>Disposable recipient fixture</title>')
const evidence = join(process.env.HOME!, '.capy/work/native-recipient-admission-auth')
mkdirSync(evidence, { recursive: true })
const sockets: InstanceType<typeof WebSocket>[] = []
const diagnostics: string[] = []
let server: ReturnType<typeof Bun.spawn> | undefined
let held: { ready: () => void; wait: Promise<void> } | undefined
const providerCalls: { path: string; agent?: string }[] = []
const endpoint = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  const path = new URL(request.url).pathname
  if (request.headers.get('authorization') !== 'Bearer controlled-recipient-fixture-key') return new Response('Unexpected fixture credential', { status: 401 })
  if (path === '/v1/models') { providerCalls.push({ path }); return Response.json({ object: 'list', data: [{ id: 'fixture', object: 'model', owned_by: 'fixture' }] }) }
  if (path !== '/v1/responses') return new Response('Unsupported fixture path', { status: 404 })
  const body = JSON.stringify(await request.json())
  providerCalls.push({ path, agent: body.includes('REVIEWER_RECIPIENT_SENTINEL') ? 'reviewer' : body.includes('OTHER_RECIPIENT_SENTINEL') ? 'other' : 'primary' })
  const hold = held
  held = undefined
  if (hold) { hold.ready(); await hold.wait }
  const id = crypto.randomUUID()
  const parts = [
    { type: 'response.created', response: { id: crypto.randomUUID(), created_at: 0, model: 'fixture' } },
    { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id } },
    { type: 'response.output_text.delta', item_id: id, delta: 'Fictional recipient response.' },
    { type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
  ]
  return new Response(parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
} })

async function startServer() {
  expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name).toBe('otto')
  const processHandle = Bun.spawn([process.execPath, '--no-env-file', 'run', join(root, 'packages/server/src/index.ts')], {
    cwd: root, env: {
      PATH: process.env.PATH!, HOME: fixtureRoot, TMPDIR: fixtureRoot, NODE_ENV: 'test',
      OTTO_CONFIG_DIR: fixtureRoot, OTTO_STORAGE: 'disk', ENCRYPTION_KEY: '0'.repeat(64),
      BETTER_AUTH_SECRET: 'x'.repeat(40), BETTER_AUTH_URL: 'http://127.0.0.1:9100',
      OTTO_OWNER_EMAIL: 'recipient-owner@example.test', OTTO_SERVER_TOKEN: crypto.randomUUID() + crypto.randomUUID(),
      OTTO_RPC_HOST: '127.0.0.1', OTTO_RPC_PORT: '0', OTTO_HEALTH_PORT: '0',
      OTTO_WEBUI_DIR: webui, OTTO_WEBUI_SECURE_COOKIE: 'false',
    }, stdout: 'pipe', stderr: 'pipe',
  })
  server = processHandle
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Recipient fixture boot timed out')), 15000)
    const pump = async (stream: ReadableStream<Uint8Array>, stdout: boolean) => {
      let text = ''
      for await (const chunk of stream) {
        text += new TextDecoder().decode(chunk)
        const lines = text.split('\n')
        text = lines.pop()!
        for (const line of lines) {
          if (/"stage"|"name"|"code"|"fields"|"frames"/.test(line)) diagnostics.push(line)
          if (stdout && line.startsWith('OTTO_SERVER_URL=')) { clearTimeout(timer); resolve(line.slice('OTTO_SERVER_URL='.length)) }
        }
      }
    }
    void pump(processHandle.stdout as ReadableStream<Uint8Array>, true)
    void pump(processHandle.stderr as ReadableStream<Uint8Array>, false)
    void processHandle.exited.then(() => { clearTimeout(timer); reject(new Error('Recipient fixture exited before startup')) })
  })
}

async function stopServer() {
  for (const socket of sockets.splice(0)) socket.terminate()
  const processHandle = server
  server = undefined
  if (!processHandle || processHandle.exitCode !== null) return
  processHandle.kill('SIGTERM')
  const timer = setTimeout(() => processHandle.kill('SIGKILL'), 10000)
  const code = await processHandle.exited
  clearTimeout(timer)
  expect(code).toBe(0)
}

function connect(url: string, cookie: string, workspaceId?: string) {
  return new Promise<{ rpc: (channel: string, ...args: unknown[]) => Promise<any>; events: any[] }>((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { cookie } })
    sockets.push(socket)
    const events: any[] = []
    const pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
    const timer = setTimeout(() => reject(new Error('Recipient fixture handshake timed out')), 10000)
    const rpc = (channel: string, ...args: unknown[]) => new Promise<any>((resolve, reject) => {
      const id = crypto.randomUUID()
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Recipient fixture RPC timed out: ${channel}`)) }, 15000)
      pending.set(id, { resolve, reject, timer })
      socket.send(JSON.stringify({ id, type: 'request', channel, args }))
    })
    socket.on('open', () => socket.send(JSON.stringify({ id: crypto.randomUUID(), type: 'handshake', protocolVersion: '1.0', ...(workspaceId ? { workspaceId } : {}) })))
    socket.on('message', (data: Buffer) => {
      const message = JSON.parse(data.toString())
      if (message.type === 'handshake_ack') { clearTimeout(timer); resolve({ rpc, events }); return }
      if (message.type === 'event') { if (message.channel === 'session:event') events.push(...message.args); return }
      const waiter = pending.get(message.id)
      if (waiter) {
        clearTimeout(waiter.timer)
        pending.delete(message.id)
        if (message.error) waiter.reject(Object.assign(new Error(message.error.message), { code: message.error.code }))
        else waiter.resolve(message.result)
      } else if (message.type === 'error') { clearTimeout(timer); reject(new Error(message.error?.code ?? 'Handshake error')); socket.close() }
    })
    socket.on('error', (error: Error) => { clearTimeout(timer); reject(error) })
    socket.on('close', () => { clearTimeout(timer); for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('Fixture connection closed')) } })
  })
}

async function until(check: () => Promise<boolean> | boolean) {
  for (let count = 0; count < 500; count++) { if (await check()) return; await Bun.sleep(30) }
  throw new Error('Recipient fixture condition timed out')
}

afterAll(async () => {
  try { await stopServer() } finally {
    endpoint.stop(true)
    writeFileSync(join(evidence, 'diagnostics.log'), diagnostics.join('\n'))
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

it('rejects stale explicit recipients before admission while preserving human-only, first-page and queued routing', async () => {
  let url = await startServer()
  const post = (path: string, body: object, cookie?: string) => fetch(url.replace('ws:', 'http:') + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:9100', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) })
  const authenticate = async (name: string, email: string) => {
    expect((await post('/api/auth/sign-up/email', { name, email, password: 'a long enough fictional fixture password' })).status).toBe(200)
    const signed = await post('/api/auth/sign-in/email', { email, password: 'a long enough fictional fixture password' })
    expect(signed.status).toBe(200)
    const cookie = signed.headers.getSetCookie().map((line) => line.split(';')[0]).join('; ')
    const identity = await (await fetch(url.replace('ws:', 'http:') + '/api/auth/get-session', { headers: { cookie } })).json() as any
    return { cookie, id: identity.user.id }
  }
  const owner = await authenticate('Fictional recipient owner', 'recipient-owner@example.test')
  const admin = await connect(url, owner.cookie)
  const workspace = await admin.rpc('workspaces:create', join(fixtureRoot, 'workspaces/recipients'), 'Recipient boundary')
  expect(realpathSync(workspace.rootPath).startsWith(realpathSync(fixtureRoot) + '/')).toBe(true)
  let client = await connect(url, owner.cookie, workspace.id)
  const invitation = await client.rpc('workspaces:invite', workspace.id, 'recipient-member@example.test')
  const member = await authenticate('Fictional recipient member', 'recipient-member@example.test')
  expect((await post('/api/auth/organization/accept-invitation', { invitationId: invitation.id }, member.cookie)).status).toBe(200)
  let memberClient = await connect(url, member.cookie, workspace.id)
  expect(await client.rpc('settings:setupLlmConnection', { slug: 'recipient-fixture', title: 'Controlled recipient endpoint', type: 'openai', scope: 'workspace', credential: 'controlled-recipient-fixture-key', baseUrl: endpoint.url.href + 'v1', defaultModel: 'fixture' })).toEqual({ success: true })
  const connection = (await client.rpc('LLM_Connection:list')).find((value: any) => value.slug === 'recipient-fixture')
  const primary = (await client.rpc('agents:list')).find((value: any) => value.isDefault)
  await client.rpc('agents:update', primary.id, { model: 'fixture', provider: 'openai', llmConnectionId: connection.id, instructions: 'PRIMARY_RECIPIENT_SENTINEL' })
  const reviewer = await memberClient.rpc('agents:create', { title: 'Fictional reviewer', instructions: 'REVIEWER_RECIPIENT_SENTINEL', model: 'fixture', provider: 'openai', llmConnectionId: connection.id })
  const other = await client.rpc('agents:create', { title: 'Fictional other agent', instructions: 'OTHER_RECIPIENT_SENTINEL', model: 'fixture', provider: 'openai', llmConnectionId: connection.id })
  const chat = await client.rpc('sessions:create', workspace.id, { name: 'Started recipient fixture', agentId: primary.id, permissionMode: 'ask' })
  await client.rpc('sessions:command', chat.id, { type: 'addMembers', actors: [`user:${member.id}`, `agent:${reviewer.id}`] })
  const history = (chatId = chat.id) => client.rpc('sessions:getMessages', chatId, { limit: 500 })
  const send = (caller: typeof client, chatId: string, text: string, recipientAgentId?: string | null, hidden?: boolean) => caller.rpc('sessions:sendMessage', chatId, text, undefined, undefined, { ...(recipientAgentId !== undefined ? { recipientAgentId } : {}), ...(hidden ? { hidden } : {}) })
  const physical = (chatId: string) => {
    const database = new Database(join(fixtureRoot, 'otto.db'), { readonly: true })
    try {
      const data = {
        chat: database.query('SELECT * FROM chats WHERE id=?').get(chatId),
        members: database.query('SELECT * FROM chats_members WHERE chat_id=? ORDER BY actor').all(chatId),
        messages: database.query('SELECT id,role,content FROM mastra_messages WHERE thread_id=? ORDER BY id').all(chatId),
        counts: Object.fromEntries(['agents', 'tasks', 'projects', 'library', 'sources'].map((table) => [table, (database.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n])),
      }
      return createHash('sha256').update(JSON.stringify(data)).digest('hex')
    } finally { database.close() }
  }
  const reject = async (caller: typeof client, chatId: string, text: string, recipient: string, hidden?: boolean) => {
    const before = await history(chatId)
    const beforeRows = physical(chatId), beforeCalls = providerCalls.length, start = caller.events.length
    let acknowledged = false
    await expect(send(caller, chatId, text, recipient, hidden).then((result) => { acknowledged = result.accepted; return result })).rejects.toThrow()
    expect(acknowledged).toBe(false)
    expect(physical(chatId)).toBe(beforeRows)
    const after = await history(chatId)
    expect(after.messages).toEqual(before.messages)
    expect(after.members).toEqual(before.members)
    expect(after.currentAgentId).toBe(before.currentAgentId)
    expect(after.currentRunId).toBe(before.currentRunId)
    expect(after.isProcessing).toBe(before.isProcessing)
    expect(providerCalls.length).toBe(beforeCalls)
    expect(caller.events.slice(start).filter((event) => event.sessionId === chatId && ['user_message', 'processing_started', 'session_created', 'complete'].includes(event.type))).toEqual([])
  }
  const humanCalls = providerCalls.length
  expect((await send(client, chat.id, `Human-only message mentions agent:${other.id} without promotion.`, null)).accepted).toBe(true)
  expect(providerCalls.length).toBe(humanCalls)
  expect((await history()).members).not.toContain(`agent:${other.id}`)
  await client.rpc('sessions:command', chat.id, { type: 'removeMember', actor: `agent:${reviewer.id}` })
  await reject(client, chat.id, 'Removed recipient before idle Send.', reviewer.id)
  await reject(client, chat.id, 'Hidden cannot bypass explicit recipient membership.', reviewer.id, true)
  await reject(client, chat.id, `Conflicting explicit recipient agent:${other.id}.`, primary.id)
  await client.rpc('sessions:command', chat.id, { type: 'addMembers', actors: [`agent:${reviewer.id}`] })
  const ready = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  held = { ready: ready.resolve, wait: release.promise }
  expect((await send(client, chat.id, 'Held primary run for recipient admission.', primary.id)).accepted).toBe(true)
  await ready.promise
  const active = await history()
  expect(active.currentAgentId).toBe(primary.id)
  expect(active.isProcessing).toBe(true)
  await client.rpc('sessions:command', chat.id, { type: 'removeMember', actor: `agent:${reviewer.id}` })
  await reject(client, chat.id, 'Removed recipient before queued Send.', reviewer.id)
  await client.rpc('sessions:command', chat.id, { type: 'addMembers', actors: [`agent:${reviewer.id}`] })
  const callsBeforeQueue = providerCalls.length
  expect((await send(memberClient, chat.id, 'Accepted reviewer follow-up in the same chat.', reviewer.id)).accepted).toBe(true)
  const queued = await history()
  expect(queued.currentAgentId).toBe(primary.id)
  expect(queued.currentRunId).toBe(active.currentRunId)
  expect(queued.messages.find((message: any) => message.content === 'Accepted reviewer follow-up in the same chat.').isQueued).toBe(true)
  expect(providerCalls.length).toBe(callsBeforeQueue)
  release.resolve()
  await until(async () => !(await history()).isProcessing)
  expect(providerCalls.at(-1)!.agent).toBe('reviewer')
  expect((await history()).messages.some((message: any) => message.role === 'assistant' && message.author === `agent:${reviewer.id}`)).toBe(true)
  const revokedReady = Promise.withResolvers<void>(), revokedRelease = Promise.withResolvers<void>()
  held = { ready: revokedReady.resolve, wait: revokedRelease.promise }
  expect((await send(client, chat.id, 'Held primary run for admitted-route revocation.', primary.id)).accepted).toBe(true)
  await revokedReady.promise
  expect((await send(memberClient, chat.id, 'Already-admitted reviewer is revoked before replay.', reviewer.id)).accepted).toBe(true)
  await client.rpc('sessions:command', chat.id, { type: 'removeMember', actor: `agent:${reviewer.id}` })
  const callsBeforeRevokedReplay = providerCalls.length
  revokedRelease.resolve()
  await until(async () => !(await history()).isProcessing)
  expect(providerCalls.length).toBe(callsBeforeRevokedReplay)
  expect((await history()).members).not.toContain(`agent:${reviewer.id}`)
  expect((await history()).messages.filter((message: any) => message.content === 'Already-admitted reviewer is revoked before replay.')).toHaveLength(1)
  const deleted = await client.rpc('agents:create', { title: 'Deleted recipient', provider: 'openai', model: 'fixture', llmConnectionId: connection.id })
  await client.rpc('sessions:command', chat.id, { type: 'addMembers', actors: [`agent:${deleted.id}`] })
  await client.rpc('agents:delete', deleted.id)
  await reject(client, chat.id, 'Deleted workspace agent is rejected.', deleted.id)
  const foreignWorkspace = await admin.rpc('workspaces:create', join(fixtureRoot, 'workspaces/foreign'), 'Foreign recipient boundary')
  const foreignClient = await connect(url, owner.cookie, foreignWorkspace.id)
  const foreign = (await foreignClient.rpc('agents:list'))[0]
  await reject(client, chat.id, 'Foreign workspace agent is rejected.', foreign.id)
  const directMessage = await client.rpc('sessions:create', workspace.id, { dmWith: member.id })
  await reject(client, directMessage.id, 'An empty human-only chat cannot acquire a selected agent.', reviewer.id)
  const directCalls = providerCalls.length
  expect((await send(client, directMessage.id, `Human-only agent:${reviewer.id} stays text.`, null)).accepted).toBe(true)
  expect(providerCalls.length).toBe(directCalls)
  expect((await history(directMessage.id)).members.filter((actor: string) => actor.startsWith('agent:'))).toEqual([])
  const unbound = await client.rpc('sessions:create', workspace.id, { name: 'New selected-agent chat', agentId: reviewer.id, permissionMode: 'ask' })
  expect((await send(client, unbound.id, 'First send to the deliberately created chat agent.', reviewer.id)).accepted).toBe(true)
  await until(async () => !(await history(unbound.id)).isProcessing)
  expect((await history(unbound.id)).messages.some((message: any) => message.author === `agent:${reviewer.id}`)).toBe(true)
  await client.rpc('sessions:command', chat.id, { type: 'removeMember', actor: `user:${member.id}` })
  await reject(memberClient, chat.id, 'Removed person cannot send through a stale footer.', primary.id)
  const project = await memberClient.rpc('projects:create', { title: 'First page project', description: 'Fictional recipient discussion only.' })
  const task = await memberClient.rpc('tasks:create', { title: 'First page task', projectId: project.id })
  const document = await memberClient.rpc('library:create', { title: 'First page document', mime: 'text/markdown', content: { encoding: 'utf8', data: '# Fictional recipient discussion' } })
  for (const [kind, item] of [['project', project], ['task', task], ['library', document]] as const) {
    const linked = await memberClient.rpc('sessions:initLinkedPage', workspace.id, `${kind}:${item.id}`)
    expect(linked.agentId).toBe(primary.id)
    expect(linked.members).not.toContain(`agent:${reviewer.id}`)
    const before = providerCalls.length
    expect((await send(memberClient, linked.id, `${kind}:${item.id} First named reviewer discussion.`, reviewer.id)).accepted).toBe(true)
    await until(async () => !(await memberClient.rpc('sessions:getMessages', linked.id)).isProcessing)
    const after = await memberClient.rpc('sessions:getMessages', linked.id)
    expect(after.agentId).toBe(primary.id)
    expect(after.createdBy).toBe(`user:${member.id}`)
    expect(after.members).toContain(`agent:${reviewer.id}`)
    expect(after.messages.some((message: any) => message.role === 'assistant' && message.author === `agent:${reviewer.id}`)).toBe(true)
    expect(providerCalls.slice(before).filter((call) => call.path === '/v1/responses')).toEqual([{ path: '/v1/responses', agent: 'reviewer' }])
  }
  const firstEmpty = await memberClient.rpc('tasks:create', { title: 'Cold first page task' })
  const emptyLinked = await memberClient.rpc('sessions:initLinkedPage', workspace.id, `task:${firstEmpty.id}`)
  const rowsBeforeRestart = physical(chat.id), callsBeforeRestart = providerCalls.length
  await stopServer()
  url = await startServer()
  client = await connect(url, owner.cookie, workspace.id)
  memberClient = await connect(url, member.cookie, workspace.id)
  expect(physical(chat.id)).toBe(rowsBeforeRestart)
  expect(providerCalls.slice(callsBeforeRestart).filter((call) => call.path === '/v1/responses')).toEqual([])
  await reject(client, chat.id, 'Cold loaded started chat must not reopen first-send binding.', reviewer.id)
  expect((await send(memberClient, emptyLinked.id, `task:${firstEmpty.id} Cold first named reviewer discussion.`, reviewer.id)).accepted).toBe(true)
  await until(async () => !(await memberClient.rpc('sessions:getMessages', emptyLinked.id)).isProcessing)
  expect((await memberClient.rpc('sessions:initLinkedPage', workspace.id, `task:${firstEmpty.id}`)).id).toBe(emptyLinked.id)
  expect((await memberClient.rpc('sessions:getMessages', emptyLinked.id)).messages.some((message: any) => message.author === `agent:${reviewer.id}`)).toBe(true)
  const mentionsBefore = providerCalls.length
  expect((await send(client, chat.id, `agent:${reviewer.id} agent:${other.id} Intentional separate mention flow.`)).accepted).toBe(true)
  await until(async () => !(await history()).isProcessing)
  expect((await history()).members).toContain(`agent:${reviewer.id}`)
  expect((await history()).members).toContain(`agent:${other.id}`)
  expect(providerCalls.slice(mentionsBefore).map((call) => call.agent)).toEqual(['reviewer', 'other'])
  await client.rpc('workspaces:removeMember', workspace.id, member.id)
  await reject(memberClient, chat.id, 'Workspace revocation cannot use a stale recipient.', primary.id)
}, 60000)
