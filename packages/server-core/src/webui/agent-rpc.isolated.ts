import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Run in isolation: the config dir and the database are fixed when the modules load.
// The agents' `otto` CLI against a real server on an ephemeral port: real handlers, the real guard, a stub session
// manager that knows who made which chat (chats are real rows, so the workspace binding is checked against them).
const configDir = mkdtempSync(join(tmpdir(), 'otto-agent-rpc-'))
process.env.OTTO_CONFIG_DIR = configDir

const { RPC_CHANNELS, AGENT_COMMANDS } = await import('@otto/shared/protocol')
const { saveConfig, addWorkspace } = await import('@otto/shared/config')
const { initDb } = await import('@otto/shared/db')
const { pushSchema } = await import('../../../shared/src/db/push.ts')
const { users } = await import('../../../shared/src/users/schema.ts')
const { createWorkspaceMember } = await import('@otto/shared/workspaces')
const { createSession } = await import('../../../shared/src/sessions/storage.ts')
const { createRunToken, deleteRunToken, initAgentApiUrl } = await import('@otto/shared/agent')
const { WsRpcServer } = await import('../transport')
const { authorize, CONNECTION_WRITE_CHANNELS, INSTANCE_OWNER_CHANNELS, OWNER_CHANNELS, WORKSPACE_ARG_CHANNELS } = await import('../bootstrap/authorize')
const { registerCoreRpcHandlers } = await import('../handlers/rpc/index')
const { SESSION_ID_CHANNELS } = await import('../handlers/rpc/session-guard')
const { createAgentRpcHandler, AGENT_RPC_RATE } = await import('./agent-rpc')

const CLI = join(import.meta.dir, '../../../../apps/electron/resources/scripts/otto.mjs')
const WRAPPER = join(import.meta.dir, '../../../../apps/electron/resources/bin/otto')

let server: InstanceType<typeof WsRpcServer>
let url = ''
let A = ''
let B = ''
const audit: string[] = []
/** chat id -> who made it, in which workspace */
const chats = new Map<string, { workspaceId: string; createdBy: string }>()
const createdWith: unknown[] = []

/** A chat row of `user` in a workspace (a real row, as the session manager writes them). */
function chatOf(workspaceId: string, user: string): string {
  const session = createSession({ id: workspaceId, rootPath: join(configDir, workspaceId) }, { createdBy: `user:${user}` })
  chats.set(session.id, { workspaceId, createdBy: `user:${user}` })
  return session.id
}

const tokens: string[] = []
function tokenFor(userId: string, workspaceId: string, chatId = 'chat-of-turn'): string {
  const { token } = createRunToken({ chatId, workspaceId, userId, agentId: 'agent0000001' })!
  tokens.push(token)
  return token
}

/** Runs the real CLI with a token; its exit code and parsed stdout. */
async function otto(token: string, args: string[], stdin?: string): Promise<{ code: number; out: any }> {
  const proc = Bun.spawn([process.execPath, CLI, ...args], {
    env: { PATH: process.env.PATH ?? '', OTTO_API_URL: url, OTTO_RUN_TOKEN: token },
    stdin: stdin === undefined ? 'ignore' : new Blob([stdin]),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const text = await new Response(proc.stdout).text()
  const code = await proc.exited
  let out: unknown = text
  try {
    out = JSON.parse(text)
  } catch { /* help prints text */ }
  return { code, out }
}

/** The endpoint without the CLI (status codes, headers, bodies). */
const post = (headers: Record<string, string>, body: unknown) =>
  fetch(`${url}/api/agent/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

beforeAll(async () => {
  const db = initDb()
  await pushSchema(db)
  saveConfig({ workspaces: [] })
  A = addWorkspace({ name: 'Main', rootPath: join(configDir, 'a') }).id
  B = addWorkspace({ name: 'Other', rootPath: join(configDir, 'b') }).id
  const now = new Date()
  for (const id of ['alice0000001', 'bob000000001', 'carol0000001']) db.insert(users).values({ id, name: id, email: `${id}@example.com`, createdAt: now, updatedAt: now }).run()
  createWorkspaceMember(A, 'alice0000001', 'owner')
  createWorkspaceMember(A, 'bob000000001', 'member')
  createWorkspaceMember(B, 'carol0000001', 'owner')
  createWorkspaceMember(B, 'alice0000001', 'member')

  const visible = (userId: string | null) => (chat: { createdBy: string }) => chat.createdBy === `user:${userId}`
  const deps = {
    sessionManager: {
      waitForInit: async () => {},
      canSeeSession: (id: string, userId: string | null) => !!chats.get(id) && visible(userId)(chats.get(id)!),
      getSessions: (workspaceId: string, userId: string | null) =>
        [...chats].filter(([, chat]) => chat.workspaceId === workspaceId && visible(userId)(chat)).map(([id, chat]) => ({ id, ...chat })),
      getSession: async (id: string) => ({ id, messages: [] }),
      createSession: async (workspaceId: string, options: unknown, meta: { createdBy: string }) => {
        createdWith.push(options)
        return { id: chatOf(workspaceId, meta.createdBy.slice('user:'.length)) }
      },
      sendMessage: async (_id: string, _message: string, _a: unknown, _s: unknown, _o: unknown, _x: unknown, _y: unknown, onAck: (id: string) => void) => onAck('message00001'),
      emitLabelConfigChange: () => {},
    },
    platform: { logger: console, imageProcessor: {} },
    oauthFlowStore: {},
  } as never

  server = new WsRpcServer({
    host: '127.0.0.1',
    port: 0,
    requireAuth: true,
    validateToken: async () => null,
    authorize,
    httpHandler: createAgentRpcHandler({ invoke: (ctx, channel, args) => server.invoke(ctx, channel, args), audit: (line) => audit.push(line) }),
  })
  registerCoreRpcHandlers(server, deps)
  await server.listen()
  url = `http://127.0.0.1:${server.port}`
  initAgentApiUrl(url)
})

afterAll(() => {
  initAgentApiUrl(null)
  server.close()
  rmSync(configDir, { recursive: true, force: true })
})

describe('the otto CLI against the server', () => {
  it('prints the command list, through the shipped wrapper too', async () => {
    const help = await otto(tokenFor('alice0000001', A), ['help'])
    expect(help.code).toBe(0)
    expect(help.out).toContain('otto tasks create <task>')
    const proc = Bun.spawn(['sh', WRAPPER, 'help'], { env: { PATH: process.env.PATH ?? '', OTTO_BUN: process.execPath, OTTO_API_URL: url, OTTO_RUN_TOKEN: tokenFor('alice0000001', A) }, stdout: 'pipe' })
    expect(await new Response(proc.stdout).text()).toContain('otto search <query>')
    expect(await proc.exited).toBe(0)
  })

  it('works on projects, tasks, comments and the library as the chat\'s user, in the chat\'s workspace', async () => {
    const token = tokenFor('alice0000001', A)
    const project = (await otto(token, ['projects', 'create', '{"title":"Launch"}'])).out
    expect(project).toMatchObject({ title: 'Launch', members: ['user:alice0000001'] })
    const task = await otto(token, ['tasks', 'create', JSON.stringify({ projectId: project.id, title: 'Write the brief' })])
    expect(task).toMatchObject({ code: 0, out: { title: 'Write the brief', status: 'todo', createdBy: 'user:alice0000001' } })
    expect((await otto(token, ['tasks', 'set-status', task.out.id, 'done'])).out.status).toBe('done')
    expect((await otto(token, ['tasks', 'list', '{"status":"done"}'])).out.map((t: { id: string }) => t.id)).toEqual([task.out.id])
    expect((await otto(token, ['comments', 'create', `task:${task.out.id}`, 'Looks good'])).out.content).toBe('Looks good')
    const activity = (await otto(token, ['comments', 'list', `task:${task.out.id}`])).out
    expect([activity.items.map((row: { event?: { kind: string }; content: string }) => row.event?.kind ?? row.content), activity.more]).toEqual([['created', 'status', 'Looks good'], false])
    expect((await otto(token, ['comments', 'list', `task:${task.out.id}`, '{"limit":1}'])).out).toMatchObject({ items: [{ content: 'Looks good' }], more: true })

    const doc = { title: 'Notes', mime: 'text/markdown', content: { encoding: 'utf8', data: '# Notes\n\nfrom stdin' } }
    const item = await otto(token, ['library', 'create', '-'], JSON.stringify(doc))
    expect(item).toMatchObject({ code: 0, out: { title: 'Notes', type: 'document' } })
    expect((await otto(token, ['library', 'read', item.out.id])).out.content).toEqual({ encoding: 'utf8', data: '# Notes\n\nfrom stdin' })

    // Workspace B is untouched: the run is bound to A
    const inB = await otto(tokenFor('alice0000001', B), ['projects', 'list'])
    expect(inB.out).toEqual([])
  })

  it('edits labels and statuses for an owner and refuses a member, as the app does', async () => {
    const owner = tokenFor('alice0000001', A)
    const member = tokenFor('bob000000001', A)
    expect((await otto(owner, ['labels', 'create', '{"name":"Urgent","color":"destructive"}'])).out).toMatchObject({ id: 'urgent', name: 'Urgent' })
    expect((await otto(owner, ['labels', 'update', 'urgent', '{"name":"Very urgent"}'])).out.name).toBe('Very urgent')
    expect((await otto(member, ['labels', 'list'])).out.map((label: { id: string }) => label.id)).toContain('urgent')
    const refused = await otto(member, ['labels', 'delete', 'urgent'])
    expect(refused).toMatchObject({ code: 1, out: { error: { code: 'forbidden' } } })
    expect((await otto(owner, ['statuses', 'create', '{"label":"Blocked","category":"open"}'])).out).toMatchObject({ id: 'blocked' })
    expect((await otto(member, ['statuses', 'set-default', 'blocked'])).out.error.code).toBe('forbidden')
    expect((await otto(owner, ['labels', 'delete', 'urgent'])).code).toBe(0)
  })

  it('reports usage, unknown commands and bad JSON without running anything', async () => {
    const token = tokenFor('alice0000001', A)
    expect((await otto(token, ['tasks', 'get'])).out.error).toEqual({ code: 'invalid', message: 'Usage: otto tasks get <id>' })
    expect((await otto(token, ['labels', 'list', B])).out.error.code).toBe('invalid') // no workspace argument to name
    expect((await otto(token, ['secrets', 'list'])).out.error.code).toBe('unknown_command')
    expect((await otto(token, ['tasks', 'list', '{"status":'])).out.error.code).toBe('invalid')
  })

  it('exits 2 without a token in its environment', async () => {
    const proc = Bun.spawn([process.execPath, CLI, 'help'], { env: { PATH: process.env.PATH ?? '' }, stdout: 'pipe', stderr: 'pipe' })
    expect(await proc.exited).toBe(2)
  })
})

describe('run token lifecycle at the endpoint', () => {
  it('refuses a missing, malformed, wrong or ended token with 401', async () => {
    const token = tokenFor('alice0000001', A)
    const help = { argv: ['help'] }
    expect((await post({}, help)).status).toBe(401)
    expect((await post({ authorization: token }, help)).status).toBe(401)
    expect((await post({ authorization: `Bearer ${token.split('.')[0]}.wrong` }, help)).status).toBe(401)
    expect((await post({ authorization: `Bearer ${token}` }, help)).status).toBe(200)
    deleteRunToken(token)
    const ended = await post({ authorization: `Bearer ${token}` }, help)
    expect(ended.status).toBe(401)
    expect(await ended.text()).not.toContain(token.split('.')[1]!)
  })

  it('takes POST only and leaves other paths alone', async () => {
    expect((await fetch(`${url}/api/agent/rpc`, { headers: { authorization: `Bearer ${tokenFor('alice0000001', A)}` } })).status).toBe(405)
    expect((await fetch(`${url}/api/other`)).status).toBe(404)
  })

  it('limits each run to its calls a minute', async () => {
    const token = tokenFor('alice0000001', A)
    const statuses: number[] = []
    for (let i = 0; i <= AGENT_RPC_RATE.max; i++) statuses.push((await post({ authorization: `Bearer ${token}` }, { argv: ['help'] })).status)
    expect(statuses.slice(0, AGENT_RPC_RATE.max).every((status) => status === 200)).toBe(true)
    expect(statuses.at(-1)).toBe(429)
    // Another run is not affected
    expect((await post({ authorization: `Bearer ${tokenFor('alice0000001', A)}` }, { argv: ['help'] })).status).toBe(200)
  })
})

describe('guard parity with the app\'s channels', () => {
  /** Arguments that pass the usage check (the guard runs before a handler reads them): a real chat for chat channels. */
  const argsOf = (name: string, chatId: string) => {
    const command = AGENT_COMMANDS[name as keyof typeof AGENT_COMMANDS]
    return command.args.filter((arg) => arg.startsWith('<')).map((_, i) => (i === 0 && SESSION_ID_CHANNELS.has(command.channel) ? chatId : 'x'))
  }

  it('refuses every agent command to a user who is not a member of the run\'s workspace', async () => {
    // carol belongs to B only; a token bound to A (a member removed mid-turn) gets nothing there
    const token = tokenFor('carol0000001', A)
    const chat = chatOf(A, 'carol0000001')
    const answers: Record<string, string> = {}
    for (const name of Object.keys(AGENT_COMMANDS)) {
      const { out } = await otto(token, [...name.split(' '), ...argsOf(name, chat)])
      answers[name] = out?.error?.code ?? 'ok'
    }
    expect(Object.entries(answers).filter(([, code]) => code !== 'forbidden')).toEqual([])
  })

  it('refuses a member the owner-only agent commands', async () => {
    const token = tokenFor('bob000000001', A)
    const ownerOnly = Object.keys(AGENT_COMMANDS).filter((name) => OWNER_CHANNELS.has(AGENT_COMMANDS[name as keyof typeof AGENT_COMMANDS].channel))
    expect(ownerOnly.length).toBeGreaterThan(5)
    for (const name of ownerOnly) {
      expect({ name, code: (await otto(token, [...name.split(' '), ...argsOf(name, 'x')])).out?.error?.code }).toEqual({ name, code: 'forbidden' })
    }
  })

  it('exposes no connection, secret, settings, member or server channel', () => {
    const channels = Object.values(AGENT_COMMANDS).map((command) => command.channel)
    const C = RPC_CHANNELS
    const banned = new Set<string>([...CONNECTION_WRITE_CHANNELS.keys(), ...INSTANCE_OWNER_CHANNELS, C.settings.GET_SETTING, C.settings.UPDATE_SETTING, C.sources.SAVE_CREDENTIALS])
    expect(channels.filter((channel) => banned.has(channel) || /^(LLM_Connection|llmConnections|settings|onboarding|oauth|chatgpt|copilot|claudeCode|credentials|sources|skills|workspaces?|server|window|file|fs|transfer|messaging|decisions):/.test(channel))).toEqual([])
  })

  it('gives the run\'s workspace to every channel that takes one first', () => {
    for (const { channel } of Object.values(AGENT_COMMANDS)) {
      const index = WORKSPACE_ARG_CHANNELS.get(channel)
      if (index !== undefined) expect({ channel, index }).toEqual({ channel, index: 0 })
    }
  })
})

describe('isolation', () => {
  it('never shows a user another user\'s private chats', async () => {
    const mine = chatOf(A, 'alice0000001')
    const bobs = chatOf(A, 'bob000000001')
    const alice = tokenFor('alice0000001', A)
    const listed = (await otto(alice, ['chats', 'list'])).out.map((chat: { id: string }) => chat.id)
    expect(listed).toContain(mine)
    expect(listed).not.toContain(bobs)
    expect((await otto(alice, ['chats', 'get', bobs])).out.error.code).toBe('not_found')
    expect((await otto(alice, ['chats', 'send', bobs, 'hello'])).out.error.code).toBe('not_found')
    expect((await otto(tokenFor('bob000000001', A), ['chats', 'get', mine])).out.error.code).toBe('not_found')
    expect((await otto(alice, ['chats', 'get', mine])).out).toMatchObject({ id: mine })
  })

  it('keeps a run to its workspace, even for the user\'s own chats elsewhere', async () => {
    const aliceInB = chatOf(B, 'alice0000001')
    expect((await otto(tokenFor('alice0000001', A), ['chats', 'get', aliceInB])).out.error.code).toBe('not_found')
    expect((await otto(tokenFor('alice0000001', B), ['chats', 'get', aliceInB])).out).toMatchObject({ id: aliceInB })
  })

  it('does not let an agent message its own chat', async () => {
    const own = chatOf(A, 'alice0000001')
    expect((await otto(tokenFor('alice0000001', A, own), ['chats', 'send', own, 'loop'])).out.error.code).toBe('invalid')
    expect((await otto(tokenFor('alice0000001', A), ['chats', 'send', own, 'hi'])).out).toEqual({ accepted: true, messageId: 'message00001' })
  })

  it('creates chats with only the options an agent may set', async () => {
    createdWith.length = 0
    const created = await otto(tokenFor('alice0000001', A), ['chats', 'create', '{"name":"Research","permissionMode":"allow-all","workingDirectory":"/","branchFromSessionId":"x"}'])
    expect(created.code).toBe(0)
    expect(createdWith).toEqual([{ name: 'Research' }])
  })
})

describe('audit', () => {
  it('writes channel, run, chat, agent and user, never the token or an argument', async () => {
    audit.length = 0
    const token = tokenFor('alice0000001', A, 'chat-audited')
    await otto(token, ['comments', 'list', 'task:secret-argument-value'])
    expect(audit).toHaveLength(1)
    const line = audit[0]!
    expect(line).toContain('channel=comments:get')
    expect(line).toContain('user=alice0000001')
    expect(line).toContain('chat=chat-audited')
    expect(line).toContain('agent=agent0000001')
    expect(line).toContain(`run=${token.split('.')[0]}`)
    expect(line).not.toContain(token.split('.')[1]!)
    expect(line).not.toContain('secret-argument-value')
  })
})
