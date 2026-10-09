import { afterAll, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
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
const evidence = join(process.env.HOME!, '.capy/work/native-resource-auth')
mkdirSync(evidence, { recursive: true })
const finalText = 'Read-only fixture response.'
const requests: { path: string; authorized: boolean }[] = []
let script: { name: string; args: Record<string, unknown> }[] = []
const wireShapes = new Map<string, { strict?: boolean; fields: string[]; required: string[]; parameters: unknown }>()
const matrix: { operation: string; status: 'passed' | 'failed' | 'unverified'; toolStatus?: string; detail?: string }[] = []
const actions: any[] = []
const failures: string[] = []
const accepted = ['prepare_project', 'create_project', 'project_list', 'project_get', 'project_update', 'project_set_status', 'project_delete', 'project_add_member', 'project_remove_member', 'task_list', 'task_get', 'task_create', 'task_update', 'task_set_status', 'task_delete', 'task_assign', 'task_set_due', 'task_set_resources', 'comment_list', 'comment_get', 'comment_create', 'comment_update', 'comment_delete', 'timesheet_list', 'timesheet_create', 'timesheet_delete', 'library_list', 'library_search', 'library_get_item', 'library_read_document', 'library_folder_path', 'library_create_folder', 'library_create_document', 'library_update_item', 'library_delete_item', 'chat_get', 'chat_update', 'chat_members', 'chat_add_members', 'chat_remove_member']
const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  const path = new URL(request.url).pathname
  const authorized = request.headers.get('authorization') === 'Bearer controlled-fixture-key'
  requests.push({ path, authorized })
  if (!authorized) return new Response('Unexpected fixture credential', { status: 401 })
  if (path === '/v1/models') return Response.json({ object: 'list', data: [{ id: 'fixture', object: 'model', owned_by: 'fixture' }] })
  if (path !== '/v1/responses') return new Response('Unsupported fixture route', { status: 404 })
  const body = await request.json() as { input?: unknown; tools?: { name: string; strict?: boolean; parameters?: { required?: string[]; properties?: Record<string, { type?: string | string[]; anyOf?: { type?: string }[] }> } }[] }
  for (const tool of body.tools ?? []) wireShapes.set(tool.name, { strict: tool.strict, fields: Object.keys(tool.parameters?.properties ?? {}), required: tool.parameters?.required ?? [], parameters: tool.parameters })
  const title = JSON.stringify(body.input).includes('Reply with ONLY')
  const call = !title && body.tools?.some((tool) => tool.name === 'search_tools') ? script.shift() : undefined
  
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
  const entry = join(root, 'packages/server/src/index.ts')
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

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const storage = () => {
  const path = join(fixtureRoot, 'otto.db')
  expect(realpathSync(path).startsWith(realpathSync(fixtureRoot) + '/')).toBe(true)
  const database = new Database(path, { readonly: true })
  try {
    return Object.fromEntries(['projects', 'tasks', 'comments', 'timesheets', 'library', 'notifications'].map((table) => [table, database.query(`SELECT * FROM ${table} ORDER BY id`).all()])) as Record<string, any[]>
  } finally { database.close() }
}

afterAll(async () => {
  for (const socket of sockets) socket.terminate()
  try { await stopSourceServer() }
  finally {
    provider.stop(true)
    for (const operation of accepted) if (!matrix.some((row) => row.operation === operation)) matrix.push({ operation, status: 'unverified', detail: 'Fixture ended before reaching this operation.' })
    writeFileSync(join(evidence, 'matrix.json'), JSON.stringify({ matrix, failures, actions, wireShapes: Object.fromEntries(wireShapes), providerRequests: requests }, null, 2))
    writeFileSync(join(evidence, 'server-diagnostics.log'), sourceLogs.filter((line) => /stage:|name:|code:|errno:|statusCode:|fields:|frames:/.test(line)).join('\n'))
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

it('executes the exposed resource matrix only after exact cookie-human approvals and reloads durable outcomes', async () => {
  let url = await startSourceServer()
  let base = url.replace('ws:', 'http:')
  const post = (path: string, body: object, cookie?: string) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:9100', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) })
  const signIn = async (email: string) => {
    const signed = await post('/api/auth/sign-in/email', { email, password: 'a long enough fixture password' })
    expect(signed.status).toBe(200)
    const cookie = signed.headers.getSetCookie().map((line) => line.split(';')[0]).join('; ')
    const session = await (await fetch(base + '/api/auth/get-session', { headers: { cookie } })).json() as { user: { id: string } }
    return { cookie, id: session.user.id }
  }
  expect((await fetch(base + '/api/config')).status).toBe(401)
  expect((await post('/api/auth/sign-up/email', { name: 'Fictional owner', email: 'fictional-owner@example.test', password: 'a long enough fixture password' })).status).toBe(200)
  const owner = await signIn('fictional-owner@example.test')
  await expect(connect(url)).rejects.toThrow('AUTH_FAILED')
  const admin = await connect(url, owner.cookie)
  const workspace = await admin.rpc('workspaces:create', join(fixtureRoot, 'workspaces/resources'), 'Fictional resource matrix')
  let client = await connect(url, owner.cookie, workspace.id)
  const invitation = await client.rpc('workspaces:invite', workspace.id, 'fictional-member@example.test')
  expect(invitation.email).toBe('fictional-member@example.test')
  expect((await post('/api/auth/sign-up/email', { name: 'Fictional member', email: invitation.email, password: 'a long enough fixture password' })).status).toBe(200)
  const member = await signIn(invitation.email)
  expect((await post('/api/auth/organization/accept-invitation', { invitationId: invitation.id }, member.cookie)).status).toBe(200)
  let memberClient = await connect(url, member.cookie, workspace.id)
  expect((await client.rpc('workspaces:getMembers', workspace.id)).some((row: any) => row.userId === member.id && row.role === 'member')).toBe(true)
  expect(await client.rpc('settings:setupLlmConnection', { slug: 'fixture', title: 'Controlled resource endpoint', type: 'openai', scope: 'workspace', credential: 'controlled-fixture-key', baseUrl: provider.url.href + 'v1', defaultModel: 'fixture' })).toEqual({ success: true })
  const connection = (await client.rpc('LLM_Connection:list')).find((row: any) => row.slug === 'fixture')
  const agent = (await client.rpc('agents:list'))[0]
  const agentActor = `agent:${agent.id}`
  await client.rpc('agents:update', agent.id, { provider: 'openai', model: 'fixture', llmConnectionId: connection.id })
  const chat = await client.rpc('sessions:create', workspace.id, { name: 'Resource matrix', agentId: agent.id, llmConnectionId: connection.id, permissionMode: 'ask' })
  const wrongChat = await client.rpc('sessions:create', workspace.id, { name: 'Cross-chat grant boundary', agentId: agent.id, llmConnectionId: connection.id, permissionMode: 'ask' })
  const until = async (condition: () => boolean) => { for (let count = 0; count < 400 && !condition(); count++) await Bun.sleep(25); expect(condition()).toBe(true) }
  const last = async (name: string, id = chat.id) => (await client.rpc('sessions:getMessages', id, { limit: 500 })).messages.findLast((row: any) => row.toolName === name)
  const run = async (name: string, args: Record<string, unknown>, options: { chatId?: string; read?: boolean; reject?: boolean; negative?: string; approve?: boolean; beforeApproval?: (row: any, request: any) => Promise<void>; approver?: typeof client; sender?: typeof client } = {}) => {
    const chatId = options.chatId ?? chat.id
    const before = storage()
    const start = client.events.length
    script = [...(!['prepare_project', 'create_project'].includes(name) ? [{ name: 'search_tools', args: { query: name } }] : []), { name, args }]
    await (options.sender ?? client).rpc('sessions:sendMessage', chatId, `Exercise disposable ${name}, with no unrelated changes.`, undefined, undefined, { recipientAgentId: agent.id })
    let request: any
    let settled = false
    for (let poll = 0; poll < 400; poll++) {
      request = client.events.slice(start).find((event) => event.sessionId === chatId && event.type === 'permission_request')?.request
      if (request) break
      settled = !(await client.rpc('sessions:getMessages', chatId, { limit: 1 })).isProcessing && client.events.slice(start).some((event) => event.sessionId === chatId && ['error', 'complete'].includes(event.type))
      if (settled) break
      await Bun.sleep(25)
    }
    if (!request && !settled) writeFileSync(join(evidence, 'blocked-run.json'), JSON.stringify({ name, args, chatId, options: { read: options.read, reject: options.reject, negative: options.negative }, remaining: script, events: client.events.slice(start), session: await client.rpc('sessions:getMessages', chatId, { limit: 20 }) }, null, 2))
    expect(!!request || settled).toBe(true)
    if (request) {
      expect(request.toolName).toBe(name)
      expect(storage()).toEqual(before)
      const pending = await last(name, chatId)
      expect(pending.nativeAction.status).toBe('pending')
      expect(pending.nativeAction.payloadHash).toMatch(/^[a-f0-9]{64}$/)
      const schema = wireShapes.get(name)!.parameters as { properties: Record<string, { properties?: Record<string, unknown> }> }
      const ordered = Object.fromEntries(Object.keys(schema.properties).filter((key) => key in args).map((key) => [key, key === 'patch' ? Object.fromEntries(Object.keys(schema.properties.patch!.properties!).filter((field) => field in (args.patch as object)).map((field) => [field, (args.patch as Record<string, unknown>)[field]])) : args[key]]))
      expect(pending.nativeAction.payloadHash).toBe(hash(ordered))
      expect(pending.toolInput).toEqual({})
      expect(await client.rpc('sessions:respondToPermission', chatId, crypto.randomUUID(), true, false)).toBe(false)
      expect(await client.rpc('sessions:respondToPermission', wrongChat.id, request.requestId, true, false)).toBe(false)
      if (options.beforeApproval) await options.beforeApproval(pending, request)
      const approved = await (options.approver ?? client).rpc('sessions:respondToPermission', chatId, request.requestId, options.approve !== false, false)
      if (options.reject && approved === false) await client.rpc('sessions:cancel', chatId)
      else expect(approved).toBe(true)
      for (let poll = 0; poll < 400; poll++) {
        settled = !(await client.rpc('sessions:getMessages', chatId, { limit: 1 })).isProcessing
        if (settled) break
        await Bun.sleep(25)
      }
      expect(settled).toBe(true)
      expect(await client.rpc('sessions:respondToPermission', chatId, request.requestId, true, false)).toBe(false)
    }
    const row = await last(name, chatId)
    const rejected = options.reject || options.approve === false
    const expected = rejected ? row?.toolStatus !== 'completed' : row?.toolStatus === 'completed'
    const label = name + (rejected ? ` negative: ${options.negative ?? (options.approve === false ? 'explicit decline' : 'refused input or authority')}` : '')
    if (!expected) failures.push(`${label}: ${row?.toolStatus ?? 'no row'} ${row?.toolResult ?? ''}`)
    if (!options.read && !rejected && !request) failures.push(`${name}: missing ASK approval`)
    if (options.approve === false) expect(request).toBeDefined()
    if (rejected && !options.beforeApproval) expect(storage()).toEqual(before)
    if (options.read) expect(storage()).toEqual(before)
    if (request && !rejected) {
      expect(row.nativeAction).toMatchObject({ status: 'approved', actorId: `user:${options.approver === memberClient ? member.id : owner.id}` })
      expect(Number.isFinite(row.nativeAction.resolvedAt)).toBe(true)
    }
    matrix.push({ operation: label, status: expected ? 'passed' : 'failed', toolStatus: row?.toolStatus, detail: request ? 'cookie RPC → discovery → pending/no resource effect → exact human decision → native result' : options.read ? 'discovery → native read/no resource effect' : 'refused before approval' })
    actions.push({ operation: label, args, payloadHash: row?.nativeAction?.payloadHash, nativeAction: row?.nativeAction, toolStatus: row?.toolStatus, toolResult: row?.toolResult, errors: client.events.slice(start).filter((event) => event.type === 'error'), storageHash: hash(storage()) })
    const shape = wireShapes.get(name)
    if (!shape && !rejected) failures.push(`${name}: no advertised provider schema`)
    if (shape && !rejected) for (const field of Object.keys(args)) expect(shape.fields).toContain(field)
    if (!rejected && !row) throw new Error(JSON.stringify(actions.at(-1)))
    await until(() => script.length === 0 || !!rejected)
    let idle = false
    for (let poll = 0; poll < 400; poll++) {
      idle = !(await client.rpc('sessions:getMessages', chatId, { limit: 1 })).isProcessing
      if (idle) break
      await Bun.sleep(25)
    }
    expect(idle).toBe(true)
    try { return JSON.parse(row?.toolResult ?? 'null') } catch { return null }
  }

  const draft = await run('prepare_project', { title: 'Reviewed disposable foundation', description: '# Purpose\nFictional matrix only.' }, { read: true })
  const project = await run('create_project', { creationId: draft.creationId })
  expect(project.id).toMatch(/^[a-f0-9-]{36}$/)
  expect((await client.rpc('projects:get', project.id)).members).toContain(agentActor)
  await run('project_list', {}, { read: true })
  await run('project_get', { id: project.id }, { read: true })
  const currentProject = () => client.rpc('projects:get', project.id)
  await run('project_update', { id: project.id, title: 'Reviewed resource project', description: 'Updated exact project text', expectedUpdatedAt: (await currentProject()).updatedAt })
  expect((await currentProject()).title).toBe('Reviewed resource project')
  await run('project_add_member', { id: project.id, actor: `user:${member.id}`, expectedUpdatedAt: (await currentProject()).updatedAt })
  expect((await currentProject()).members).toContain(`user:${member.id}`)
  await run('project_remove_member', { id: project.id, actor: `user:${member.id}`, expectedUpdatedAt: (await currentProject()).updatedAt })
  expect((await currentProject()).members).not.toContain(`user:${member.id}`)
  await run('project_set_status', { id: project.id, status: 'archived', expectedUpdatedAt: (await currentProject()).updatedAt })
  expect((await currentProject()).status).toBe('archived')
  await run('project_set_status', { id: project.id, status: 'active', expectedUpdatedAt: (await currentProject()).updatedAt })

  const task = await run('task_create', { title: 'Canonical disposable task', projectId: project.id, description: 'Exact task description' })
  expect(task).toMatchObject({ title: 'Canonical disposable task', createdBy: agentActor, status: 'todo', assignees: [], dueAt: null })
  const currentTask = () => client.rpc('tasks:get', task.id)
  await run('task_list', { projectId: project.id }, { read: true })
  await run('task_get', { id: task.id }, { read: true })
  await run('task_update', { id: task.id, title: 'Canonical revised task', projectId: null, expectedUpdatedAt: (await currentTask()).updatedAt })
  expect((await currentTask()).projectId).toBeNull()
  await run('task_assign', { id: task.id, assignees: [`user:${member.id}`], expectedUpdatedAt: (await currentTask()).updatedAt })
  expect((await currentTask()).assignees).toEqual([`user:${member.id}`])
  expect(storage().notifications!.some((row: any) => row.user_id === member.id && row.entity === `task:${task.id}` && row.created_by === agentActor)).toBe(true)
  await run('task_set_due', { id: task.id, dueAt: 1_900_000_000_000, expectedUpdatedAt: (await currentTask()).updatedAt })
  expect((await currentTask()).dueAt).toBe(1_900_000_000_000)
  await run('task_set_due', { id: task.id, dueAt: null, expectedUpdatedAt: (await currentTask()).updatedAt })
  expect((await currentTask()).dueAt).toBeNull()
  await run('task_set_status', { id: task.id, status: 'doing', expectedUpdatedAt: (await currentTask()).updatedAt })
  expect((await currentTask()).status).toBe('doing')
  await run('task_set_resources', { id: task.id, resources: [{ type: 'url', title: 'Fictional reference only', ref: 'https://example.test/no-fetch' }], expectedUpdatedAt: (await currentTask()).updatedAt })
  expect((await currentTask()).resources).toHaveLength(1)

  const comment = await run('comment_create', { entity: `task:${task.id}`, content: 'Exact reviewed fictional comment.' })
  expect(comment.createdBy).toBe(agentActor)
  await run('comment_list', { entity: `task:${task.id}` }, { read: true })
  await run('comment_get', { id: comment.id }, { read: true })
  const revisedComment = await run('comment_update', { id: comment.id, content: 'Exact revised fictional comment.', expectedUpdatedAt: comment.updatedAt })
  expect(revisedComment.content).toBe('Exact revised fictional comment.')
  const humanComment = await client.rpc('comments:create', `task:${task.id}`, 'Owner-authored fixture comment.')
  await run('comment_update', { id: humanComment.id, content: 'Owner-author preserved.', expectedUpdatedAt: humanComment.updatedAt })
  expect((await client.rpc('comments:get', `task:${task.id}`)).items.find((row: any) => row.id === humanComment.id).createdBy).toBe(`user:${owner.id}`)
  const timesheet = await run('timesheet_create', { taskId: task.id, time: 1234, notes: 'Fictional explicit fixture duration, not a work estimate.' })
  expect(timesheet).toMatchObject({ taskId: task.id, time: 1234, createdBy: agentActor })
  await run('timesheet_list', { taskId: task.id }, { read: true })

  const folder = await run('library_create_folder', { title: 'Canonical fixture folder' })
  const document = await run('library_create_document', { title: 'Canonical fixture document', content: 'Disposable content', parentId: folder.id })
  expect(document).toMatchObject({ parentId: folder.id, createdBy: agentActor, type: 'document' })
  await run('library_list', { parentId: folder.id }, { read: true })
  await run('library_get_item', { id: document.id }, { read: true })
  await run('library_read_document', { id: document.id }, { read: true })
  await run('library_folder_path', { id: folder.id }, { read: true })
  await run('library_search', { query: 'Canonical fixture' }, { read: true })
  const moved = await run('library_update_item', { id: document.id, title: 'Renamed moved document', content: 'Revised content', parentId: null, expectedUpdatedAt: document.updatedAt })
  expect(moved).toMatchObject({ title: 'Renamed moved document', parentId: null })
  const renamedFolder = await run('library_update_item', { id: folder.id, title: 'Renamed folder', expectedUpdatedAt: folder.updatedAt })
  expect(renamedFolder.title).toBe('Renamed folder')
  expect((await client.rpc('library:read', document.id)).content.data).toBe('Revised content')
  const childFolder = await run('library_create_folder', { title: 'Movable child folder' })
  const movedFolder = await run('library_update_item', { id: childFolder.id, parentId: folder.id, expectedUpdatedAt: childFolder.updatedAt })
  expect(movedFolder.parentId).toBe(folder.id)
  expect((await run('library_folder_path', { id: childFolder.id }, { read: true })).folders.map((row: any) => row.id)).toEqual([folder.id, childFolder.id])
  await run('library_delete_item', { id: folder.id, expectedUpdatedAt: renamedFolder.updatedAt }, { reject: true, negative: 'nonempty folder refuses deletion' })
  expect(await client.rpc('library:get', folder.id)).not.toBeNull()
  await run('project_update', { id: project.id, resources: [{ type: 'library', title: 'Reviewed document link', ref: document.id }], expectedUpdatedAt: (await currentProject()).updatedAt })
  expect((await currentProject()).resources[0].ref).toBe(document.id)

  const target = await client.rpc('sessions:create', workspace.id, { name: 'Owned target chat', agentId: agent.id, llmConnectionId: connection.id, permissionMode: 'ask' })
  const targetRead = await run('chat_get', { id: target.id }, { read: true })
  const chatUpdated = await run('chat_update', { id: target.id, patch: { title: 'Reviewed target chat', status: 'done', projectId: project.id }, expectedVersion: targetRead.chat.version }, { beforeApproval: async () => {
    const unchanged = await client.rpc('sessions:getMessages', target.id)
    expect(unchanged.name).toBe('Owned target chat')
    expect(unchanged.sessionStatus ?? 'todo').toBe('todo')
    expect(unchanged.projectId).toBeUndefined()
  } })
  expect(chatUpdated).toMatchObject({ title: 'Reviewed target chat', status: 'done', projectId: project.id })
  const targetMembers = await run('chat_members', { id: target.id })
  const withMember = await run('chat_add_members', { id: target.id, actors: [`user:${member.id}`], expectedVersion: targetMembers.version }, { beforeApproval: async () => {
    expect((await client.rpc('sessions:getMessages', target.id)).members).not.toContain(`user:${member.id}`)
  } })
  expect(withMember.members.some((row: any) => row.actor === `user:${member.id}`)).toBe(true)
  const withoutMember = await run('chat_remove_member', { id: target.id, actor: `user:${member.id}`, expectedVersion: withMember.version }, { beforeApproval: async () => {
    expect((await client.rpc('sessions:getMessages', target.id)).members).toContain(`user:${member.id}`)
  } })
  expect(withoutMember.members.some((row: any) => row.actor === `user:${member.id}`)).toBe(false)

  await run('task_update', { id: task.id, title: 'Must stay rejected', expectedUpdatedAt: (await currentTask()).updatedAt, arbitraryField: 'unknown' }, { reject: true, negative: 'unknown field' })
  expect(wireShapes.get('task_update')!.fields).not.toContain('arbitraryField')
  await run('project_update', { id: project.id, title: 'Unknown project patch', expectedUpdatedAt: (await currentProject()).updatedAt, hiddenField: true }, { reject: true, negative: 'unknown field' })
  await run('project_set_status', { id: project.id, status: 'archived', expectedUpdatedAt: project.updatedAt }, { reject: true, negative: 'stale read version' })
  await run('task_create', { title: 'No implicit assignment', assignees: [`user:${member.id}`] }, { reject: true, negative: 'assignment omitted from canonical create schema' })
  await run('library_update_item', { id: document.id, title: 'Unknown Library patch', expectedUpdatedAt: moved.updatedAt, hiddenField: true }, { reject: true, negative: 'unknown field' })
  await run('comment_create', { entity: `task:${task.id}`, content: 'No spoofed author', createdBy: `user:${owner.id}` }, { reject: true, negative: 'unknown author field' })
  await run('timesheet_create', { taskId: task.id, time: 0 }, { reject: true, negative: 'duration must be positive' })
  await run('timesheet_delete', { id: timesheet.id, taskId: crypto.randomUUID() }, { reject: true, negative: 'entry cannot be deleted from another task' })
  await run('chat_update', { id: target.id, patch: { permissionMode: 'allow-all' }, expectedVersion: withoutMember.version }, { reject: true, negative: 'permission escalation excluded from schema' })
  await run('task_set_due', { id: task.id, dueAt: 2, expectedUpdatedAt: task.updatedAt }, { reject: true, negative: 'stale read version' })
  await run('task_set_due', { id: task.id, dueAt: 3, expectedUpdatedAt: (await currentTask()).updatedAt }, { approve: false })
  const staleVersion = (await currentTask()).updatedAt
  await run('task_set_due', { id: task.id, dueAt: 4, expectedUpdatedAt: staleVersion }, { reject: true, negative: 'target changes while pending', beforeApproval: async () => {
    await client.rpc('tasks:update', task.id, { title: 'Concurrent cookie-human update', expectedUpdatedAt: staleVersion })
  } })
  expect((await currentTask()).dueAt).toBeNull()
  await run('library_update_item', { id: document.id, title: 'Stale library rename', expectedUpdatedAt: document.updatedAt }, { reject: true, negative: 'stale read version' })
  await run('comment_update', { id: comment.id, content: 'Stale comment text', expectedUpdatedAt: comment.updatedAt }, { reject: true, negative: 'stale read version' })
  await run('chat_update', { id: target.id, patch: { title: 'Stale chat title' }, expectedVersion: targetRead.chat.version }, { reject: true, negative: 'stale opaque chat version' })
  await run('task_assign', { id: task.id, assignees: [`user:${crypto.randomUUID()}`], expectedUpdatedAt: (await currentTask()).updatedAt }, { reject: true, negative: 'unknown workspace actor' })
  const foreignWorkspace = await admin.rpc('workspaces:create', join(fixtureRoot, 'workspaces/foreign'), 'Foreign disposable boundary')
  const foreignClient = await connect(url, owner.cookie, foreignWorkspace.id)
  const foreignTask = await foreignClient.rpc('tasks:create', { title: 'Foreign task fixture' })
  await run('task_get', { id: foreignTask.id }, { read: true, reject: true, negative: 'cross-workspace target' })
  await run('task_update', { id: foreignTask.id, title: 'Must not overwrite another workspace', expectedUpdatedAt: foreignTask.updatedAt }, { reject: true, negative: 'cross-workspace target' })
  expect((await foreignClient.rpc('tasks:get', foreignTask.id)).title).toBe('Foreign task fixture')

  const allowChat = await client.rpc('sessions:create', workspace.id, { name: 'Destructive always-ASK fixture', agentId: agent.id, llmConnectionId: connection.id, permissionMode: 'allow-all' })
  await run('task_set_status', { id: task.id, status: 'done', expectedUpdatedAt: (await currentTask()).updatedAt }, { chatId: allowChat.id, approve: false, negative: 'destructive still asks in Allow-all' })
  expect((await currentTask()).status).toBe('doing')

  const safeChat = await client.rpc('sessions:create', workspace.id, { name: 'Read-only capability fixture', agentId: agent.id, llmConnectionId: connection.id, permissionMode: 'safe' })
  await run('task_set_due', { id: task.id, dueAt: 5, expectedUpdatedAt: (await currentTask()).updatedAt }, { chatId: safeChat.id, reject: true, negative: 'safe capability excludes writes' })
  expect(JSON.parse((await last('search_tools', safeChat.id)).toolResult).loaded).not.toContain('task_set_due')

  const shared = await client.rpc('sessions:create', workspace.id, { name: 'Effective human fixture', agentId: agent.id, llmConnectionId: connection.id, permissionMode: 'ask' })
  await client.rpc('sessions:command', shared.id, { type: 'addMembers', actors: [`user:${member.id}`] })
  const memberTarget = await memberClient.rpc('sessions:create', workspace.id, { name: 'Member-owned disposable target', agentId: agent.id, llmConnectionId: connection.id, permissionMode: 'ask' })
  await memberClient.rpc('sessions:command', memberTarget.id, { type: 'addMembers', actors: [`user:${owner.id}`] })
  const memberTargetRead = await run('chat_get', { id: memberTarget.id }, { chatId: shared.id, read: true })
  await run('chat_remove_member', { id: memberTarget.id, actor: `user:${owner.id}`, expectedVersion: memberTargetRead.chat.version }, { chatId: shared.id, reject: true, negative: 'workspace owner cannot approve another chat creator mutation', beforeApproval: async (row, request) => {
    expect(row.nativeAction.eligibleActors).toEqual([`user:${member.id}`])
    expect(await client.rpc('sessions:respondToPermission', shared.id, request.requestId, true, false)).toBe(false)
  } })
  expect((await client.rpc('sessions:getMessages', memberTarget.id)).members).toContain(`user:${owner.id}`)
  const humanVersion = (await client.rpc('comments:get', `task:${task.id}`)).items.find((row: any) => row.id === humanComment.id).updatedAt
  await run('comment_update', { id: humanComment.id, content: 'Approval resolves as the actual author.', expectedUpdatedAt: humanVersion }, { chatId: shared.id, sender: memberClient, beforeApproval: async (row, request) => {
    expect(row.nativeAction.eligibleActors).toContain(`user:${owner.id}`)
    expect(row.nativeAction.eligibleActors).not.toContain(`user:${member.id}`)
    expect(await memberClient.rpc('sessions:respondToPermission', shared.id, request.requestId, true, false)).toBe(false)
  } })
  expect((await client.rpc('comments:get', `task:${task.id}`)).items.find((row: any) => row.id === humanComment.id)).toMatchObject({ content: 'Approval resolves as the actual author.', createdBy: `user:${owner.id}` })
  const effectiveDraft = await run('prepare_project', { title: 'Approving human foundation', description: 'Disposable role proof.' }, { chatId: shared.id, read: true })
  const effectiveProject = await run('create_project', { creationId: effectiveDraft.creationId }, { chatId: shared.id, approver: memberClient })
  expect((await client.rpc('projects:get', effectiveProject.id)).members).toEqual([agentActor])
  await run('task_update', { id: task.id, description: 'Canonical revised description', projectId: project.id, expectedUpdatedAt: (await currentTask()).updatedAt })
  expect((await currentTask()).description).toBe('Canonical revised description')

  await run('task_delete', { id: task.id, expectedUpdatedAt: (await currentTask()).updatedAt })
  expect((await currentTask()).status).toBe('deleted')
  expect((await client.rpc('timesheets:list', task.id)).some((row: any) => row.id === timesheet.id)).toBe(true)
  expect((await client.rpc('comments:get', `task:${task.id}`)).items.some((row: any) => row.id === comment.id)).toBe(true)
  await run('task_set_status', { id: task.id, status: 'todo', expectedUpdatedAt: (await currentTask()).updatedAt })
  await run('project_delete', { id: project.id, expectedUpdatedAt: (await currentProject()).updatedAt })
  expect((await currentProject()).status).toBe('deleted')
  expect((await currentTask()).status).toBe('todo')
  expect((await currentTask()).projectId).toBe(project.id)
  await run('timesheet_delete', { id: timesheet.id, taskId: task.id })
  expect(await client.rpc('timesheets:list', task.id)).toEqual([])
  await run('comment_delete', { id: comment.id, expectedUpdatedAt: revisedComment.updatedAt })
  expect((await client.rpc('comments:get', `task:${task.id}`)).items.some((row: any) => row.id === comment.id)).toBe(false)
  await run('library_delete_item', { id: childFolder.id, expectedUpdatedAt: movedFolder.updatedAt })
  await run('library_delete_item', { id: folder.id, expectedUpdatedAt: renamedFolder.updatedAt })
  expect(await client.rpc('library:get', folder.id)).toBeNull()
  const deletedDocument = await run('library_create_document', { title: 'Deletion-only fixture', content: 'Exact disposable deletion target.' })
  await run('library_delete_item', { id: deletedDocument.id, expectedUpdatedAt: deletedDocument.updatedAt })
  expect(await client.rpc('library:get', deletedDocument.id)).toBeNull()

  const finalStorage = storage()
  const durableActions = new Map<string, any[]>()
  for (const id of [chat.id, shared.id, allowChat.id]) durableActions.set(id, (await client.rpc('sessions:getMessages', id, { limit: 500 })).messages.filter((row: any) => row.nativeAction).map((row: any) => ({ id: row.id, nativeAction: row.nativeAction, toolStatus: row.toolStatus, toolResult: row.toolResult })))
  for (const socket of sockets.splice(0)) socket.terminate()
  await stopSourceServer()
  url = await startSourceServer()
  base = url.replace('ws:', 'http:')
  client = await connect(url, owner.cookie, workspace.id)
  memberClient = await connect(url, member.cookie, workspace.id)
  expect(storage()).toEqual(finalStorage)
  for (const [id, expected] of durableActions) {
    const reloaded = (await client.rpc('sessions:getMessages', id, { limit: 500 })).messages
    expect(reloaded.filter((row: any) => row.nativeAction).map((row: any) => ({ id: row.id, nativeAction: row.nativeAction, toolStatus: row.toolStatus, toolResult: row.toolResult }))).toEqual(expected)
  }
  const oldAction = durableActions.get(chat.id)!.find((row: any) => row.nativeAction.status === 'approved')
  expect(await client.rpc('sessions:respondToPermission', chat.id, oldAction.nativeAction.id, true, false)).toBe(false)
  expect((await currentProject()).status).toBe('deleted')
  expect((await currentTask()).title).toBe('Concurrent cookie-human update')
  expect((await client.rpc('library:read', document.id)).content.data).toBe('Revised content')
  const reloadedTarget = await client.rpc('sessions:getMessages', target.id)
  expect(reloadedTarget).toMatchObject({ name: 'Reviewed target chat', sessionStatus: 'done', projectId: project.id })
  expect(reloadedTarget.members).not.toContain(`user:${member.id}`)
  expect((await run('project_get', { id: project.id }, { read: true })).status).toBe('deleted')
  expect((await run('task_get', { id: task.id }, { read: true })).description).toBe('Canonical revised description')
  expect((await run('library_read_document', { id: document.id }, { read: true })).content).toBe('Revised content')
  expect((await run('chat_get', { id: target.id }, { read: true })).chat.title).toBe('Reviewed target chat')
  expect(requests.every((request) => request.authorized && ['/v1/models', '/v1/responses'].includes(request.path))).toBe(true)
  matrix.push({ operation: 'cookie reload and durable native decisions', status: 'passed', detail: `resource storage ${hash(finalStorage)}, ${[...durableActions.values()].reduce((sum, rows) => sum + rows.length, 0)} native actions survived owned server restart; old grant unusable` })
  expect(failures).toEqual([])
}, 170_000)
