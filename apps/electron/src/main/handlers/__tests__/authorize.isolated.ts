import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import './electron-mock'
import { createMockServerDeps } from './electron-mock'

// Run in isolation: the config dir and the database are fixed when the modules load.
const configDir = mkdtempSync(join(tmpdir(), 'otto-authorize-'))
process.env.OTTO_CONFIG_DIR = configDir
process.env.BETTER_AUTH_SECRET = 'x'.repeat(40)

const { RPC_CHANNELS } = await import('@otto/shared/protocol')
const { PROTOCOL_VERSION } = await import('@otto/shared/protocol')
const { saveConfig, addWorkspace, getWorkspaces } = await import('@otto/shared/config')
const { initDb } = await import('@otto/shared/db')
const { pushSchema } = await import('../../../../../../packages/shared/src/db/push.ts')
const { createWorkspaceMember, deleteWorkspaceMember, getMemberRole } = await import('@otto/shared/workspaces')
const { WsRpcServer, WsRpcClient } = await import('@otto/server-core/transport')
const { users } = await import('../../../../../../packages/shared/src/users/schema.ts')
const { userEntity, workspaceEntity } = await import('@otto/shared/settings')
const { CLAUDE_CODE_OWNER_ONLY, createConnection, deleteConnection, getConnection, userScope, workspaceScope } = await import('@otto/shared/connections')
const { getTranscriptionKey } = await import('@otto/shared/transcription')
const { createAgent } = await import('@otto/shared/agents')
const { createRoutine } = await import('@otto/shared/automations/routines')
const { AGENT_WRITE_CHANNELS, authorize, CONNECTION_WRITE_CHANNELS, INSTANCE_OWNER_CHANNELS, OWNER_CHANNELS, ROUTINE_WRITE_CHANNELS, WORKSPACE_ARG_CHANNELS } = await import('../../../../../../packages/server-core/src/bootstrap/authorize.ts')
const { registerCoreRpcHandlers } = await import('@otto/server-core/handlers/rpc')

type Handler = (...args: never[]) => unknown
const promptedAs: (string | undefined)[] = []
const registered = new Map<string, Handler>()
const deps = {
  ...createMockServerDeps(),
  sessionManager: {
    getWorkspaces: () => getWorkspaces(),
    getWorkspacesInfo: () => getWorkspaces().map((workspace) => ({ id: workspace.id, name: workspace.name })),
    getActiveSessionsInfo: () => [],
    setupConfigWatcher() {},
    // Whose chat a routine's prompt starts
    executePromptAutomation: async (input: { createdBy?: string }) => (promptedAs.push(input.createdBy), { sessionId: 'chat' }),
  },
} as never
registerCoreRpcHandlers(
  { handle: (channel: string, handler: Handler) => void registered.set(channel, handler), push() {}, async invokeClient() {} } as never,
  deps,
  { getConnectedClientCount: () => 0, serverId: 'test', startedAt: 0 },
)
const channels = [...registered.keys()].filter((channel) => channel.includes(':'))

let A = ''
let B = ''
const servers: InstanceType<typeof WsRpcServer>[] = []
const clients: InstanceType<typeof WsRpcClient>[] = []

/** A server whose tokens are user ids; `real` registers the real handlers, else every channel is a spy. */
async function start(real: boolean) {
  const calls: string[] = []
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, validateToken: async (token) => ({ userId: token }), authorize })
  if (real) {
    registerCoreRpcHandlers(server, deps, { getConnectedClientCount: () => 0, serverId: 'test', startedAt: 0 })
  } else {
    for (const channel of channels) server.handle(channel, () => (calls.push(channel), 'ran'))
  }
  await server.listen()
  servers.push(server)
  return { server, calls, url: `ws://127.0.0.1:${server.port}` }
}

async function connect(url: string, user: string, workspaceId?: string) {
  const client = new WsRpcClient(url, { token: user, workspaceId, clientCapabilities: [], autoReconnect: false })
  clients.push(client)
  client.connect()
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('never connected')), 3000)
    client.onConnectionStateChanged((state) => {
      if (state.status === 'connected') (clearTimeout(timer), resolve())
      else if (state.status === 'failed' || state.status === 'disconnected') (clearTimeout(timer), reject(new Error(state.lastError?.message ?? state.status)))
    })
  })
  return client
}

/** What a handshake says: the error message, or 'ok'. */
function handshake(url: string, token: string, workspaceId?: string): Promise<string> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url)
    ws.on('open', () => ws.send(JSON.stringify({ id: 'h', type: 'handshake', protocolVersion: PROTOCOL_VERSION, token, workspaceId })))
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString())
      if (message.type === 'handshake_ack') (ws.close(), resolve('ok'))
      if (message.type === 'error') resolve(message.error.code)
    })
  })
}

const codeOf = async (promise: Promise<unknown>) => promise.then(() => 'ok', (error: { code?: string }) => error.code)

/** Arguments that put `target` where the channel expects a workspace. */
function argsFor(channel: string, target: string): unknown[] {
  const index = WORKSPACE_ARG_CHANNELS.get(channel) ?? 0
  return [...Array(index).fill('x'), target]
}

/** What the channels that address a settings entity need to be a valid call. */
const SETTING_CHANNELS: string[] = [RPC_CHANNELS.settings.GET_SETTING, RPC_CHANNELS.settings.UPDATE_SETTING]
const plainArgs = (channel: string): unknown[] => (SETTING_CHANNELS.includes(channel) ? [userEntity('alice'), 'colorTheme', 'nord'] : [])

beforeAll(async () => {
  await pushSchema(initDb())
  // alice is the first user: the instance owner. zed owns a workspace and is not.
  for (const [index, id] of ['alice', 'bob', 'zed', 'carol'].entries()) {
    initDb().insert(users).values({ id, name: id, email: `${id}@x.test`, createdAt: new Date(index + 1), updatedAt: new Date(index + 1) }).run()
  }
  saveConfig({ workspaces: [] })
  A = addWorkspace({ name: 'Main', rootPath: join(configDir, 'workspaces', 'a') }).id
  B = addWorkspace({ name: 'Side', rootPath: join(configDir, 'workspaces', 'b') }).id
  createWorkspaceMember(A, 'alice', 'owner')
  createWorkspaceMember(A, 'bob', 'member')
  createWorkspaceMember(B, 'zed', 'owner')
})
afterAll(() => {
  for (const client of clients) client.destroy()
  for (const server of servers) server.close()
  rmSync(configDir, { recursive: true, force: true })
})

/** Parameter names of a handler as written, without its context. */
function paramsOf(handler: Handler): string[] | null {
  const match = handler.toString().match(/^(?:async\s*)?\(([^)]*)\)/)
  return match ? match[1]!.split(',').map((param) => param.split('=')[0]!.trim()).slice(1) : null
}

describe('which channels name a workspace', () => {
  it('declares every handler that takes a workspace parameter, at the right position', () => {
    const missing: string[] = []
    for (const [channel, handler] of registered) {
      const params = paramsOf(handler)
      if (!params) continue // wrapped by a guard of its own; those are listed by hand
      const index = params.findIndex((param) => /workspace/i.test(param))
      if (index >= 0 && WORKSPACE_ARG_CHANNELS.get(channel) !== index) missing.push(`${channel} (argument ${index})`)
    }
    expect(missing).toEqual([])
  })

  it('declares only channels that exist, and owner channels name a workspace', () => {
    for (const channel of WORKSPACE_ARG_CHANNELS.keys()) expect(registered.has(channel)).toBe(true)
    for (const channel of OWNER_CHANNELS) expect(WORKSPACE_ARG_CHANNELS.has(channel)).toBe(true)
  })

  it('can read parameter names of most handlers (the check above is not vacuous)', () => {
    const readable = [...registered.values()].filter((handler) => paramsOf(handler)).length
    expect(readable).toBeGreaterThan(registered.size * 0.8)
    expect(registered.size).toBeGreaterThan(200)
  })
})

describe('the guard on every registered channel', () => {
  it('lets a member in and refuses another workspace by id or by name, without running the handler', async () => {
    const { url, calls } = await start(false)
    const alice = await connect(url, 'alice', A)
    for (const channel of channels) {
      if (!WORKSPACE_ARG_CHANNELS.has(channel)) {
        expect(await codeOf(alice.invoke(channel, ...plainArgs(channel)))).toBe('ok')
        continue
      }
      expect(await codeOf(alice.invoke(channel, ...argsFor(channel, B)))).toBe('forbidden')
      expect(await codeOf(alice.invoke(channel, ...argsFor(channel, 'Side')))).toBe('forbidden')
      expect(await codeOf(alice.invoke(channel, ...argsFor(channel, 'nowhere')))).toBe('forbidden')
      expect(await codeOf(alice.invoke(channel, ...argsFor(channel, A)))).toBe('ok')
      expect(await codeOf(alice.invoke(channel, ...argsFor(channel, 'main')))).toBe('ok')
    }
    // The handler ran exactly for the allowed calls.
    expect(calls.length).toBe(channels.length + channels.filter((channel) => WORKSPACE_ARG_CHANNELS.has(channel)).length)
  })

  it('refuses a member on the owner channels only', async () => {
    const { url } = await start(false)
    const bob = await connect(url, 'bob', A)
    for (const channel of channels.filter((channel) => WORKSPACE_ARG_CHANNELS.has(channel))) {
      const expected = OWNER_CHANNELS.has(channel) ? 'forbidden' : 'ok'
      expect(await codeOf(bob.invoke(channel, ...argsFor(channel, A)))).toBe(expected)
    }
  })

  it('lets a member read labels and statuses and keeps writing them to the owners', async () => {
    const { url } = await start(false)
    const bob = await connect(url, 'bob', A) // a member
    const alice = await connect(url, 'alice', A) // an owner
    const { labels, statuses } = RPC_CHANNELS
    for (const channel of [labels.LIST, statuses.LIST]) {
      expect(OWNER_CHANNELS.has(channel)).toBe(false)
      expect(await codeOf(bob.invoke(channel, A))).toBe('ok')
    }
    for (const channel of [labels.CREATE, labels.UPDATE, labels.MOVE, labels.REORDER, labels.DELETE, statuses.CREATE, statuses.UPDATE, statuses.DELETE, statuses.REORDER, statuses.SET_DEFAULT]) {
      expect(OWNER_CHANNELS.has(channel)).toBe(true)
      expect(await codeOf(bob.invoke(channel, A))).toBe('forbidden')
      expect(await codeOf(alice.invoke(channel, A))).toBe('ok')
    }
  })

  it('lets any member list, get and create agents, and only an agent\'s creator or an owner change or delete it', async () => {
    const { url } = await start(false)
    const [alice, bob, zed] = [await connect(url, 'alice', A), await connect(url, 'bob', A), await connect(url, 'zed', B)] // alice owns A, bob is a member, zed is in B only
    const { agents } = RPC_CHANNELS
    expect([...AGENT_WRITE_CHANNELS].sort()).toEqual([agents.UPDATE, agents.DELETE].sort())
    for (const channel of AGENT_WRITE_CHANNELS) expect(registered.has(channel)).toBe(true)
    for (const channel of [agents.LIST, agents.GET, agents.CREATE]) expect(await codeOf(bob.invoke(channel, 'x'))).toBe('ok')
    const mine = createAgent({ workspaceId: A, title: 'Bob\'s', provider: 'p', createdBy: 'user:bob' }).id
    const owners = createAgent({ workspaceId: A, title: 'Alice\'s', provider: 'p', createdBy: 'user:alice' }).id
    for (const channel of AGENT_WRITE_CHANNELS) {
      expect(await codeOf(bob.invoke(channel, mine))).toBe('ok') // its creator
      expect(await codeOf(bob.invoke(channel, owners))).toBe('forbidden') // someone else's
      expect(await codeOf(alice.invoke(channel, mine))).toBe('ok') // an owner of the workspace
      expect(await codeOf(alice.invoke(channel, owners))).toBe('ok')
      expect(await codeOf(bob.invoke(channel, 'nope'))).toBe('ok') // not an agent here: the handler says not_found
      expect(await codeOf(bob.invoke(channel))).toBe('ok')
      expect(await codeOf(zed.invoke(channel, mine))).toBe('ok') // zed's workspace is B, where it is no agent: the same not_found answer as an unknown id
    }
  })

  it('lets any member list, get and create routines, and only a routine\'s creator or an owner change, pause, resume, run or delete it', async () => {
    const { url } = await start(false)
    const [alice, bob, zed] = [await connect(url, 'alice', A), await connect(url, 'bob', A), await connect(url, 'zed', B)]
    const { routines } = RPC_CHANNELS
    expect([...ROUTINE_WRITE_CHANNELS].sort()).toEqual([routines.UPDATE, routines.DELETE, routines.PAUSE, routines.RESUME, routines.RUN, routines.RESET_WEBHOOK].sort())
    for (const channel of ROUTINE_WRITE_CHANNELS) expect(registered.has(channel)).toBe(true)
    for (const channel of [routines.LIST, routines.GET, routines.CREATE]) expect(await codeOf(bob.invoke(channel, 'x'))).toBe('ok')
    const config = { type: 'event' as const, event: 'LabelAdd', actions: [{ type: 'prompt' as const, prompt: 'x' }] }
    const mine = createRoutine({ workspaceId: A, title: 'Bob\'s', config, createdBy: 'user:bob' }).id
    const owners = createRoutine({ workspaceId: A, title: 'Alice\'s', config, createdBy: 'user:alice' }).id
    for (const channel of ROUTINE_WRITE_CHANNELS) {
      expect(await codeOf(bob.invoke(channel, mine))).toBe('ok') // its creator
      expect(await codeOf(bob.invoke(channel, owners))).toBe('forbidden') // someone else's
      expect(await codeOf(alice.invoke(channel, mine))).toBe('ok') // an owner of the workspace
      expect(await codeOf(alice.invoke(channel, owners))).toBe('ok')
      expect(await codeOf(bob.invoke(channel, 'nope'))).toBe('ok') // not a routine here: the handler says not_found
      expect(await codeOf(zed.invoke(channel, mine))).toBe('ok') // zed's workspace is B, where it is no routine
    }
  })

  it("makes a routine an owner changes the owner's, and runs Run now as the person who asked", async () => {
    const { url } = await start(true)
    const [alice, bob] = [await connect(url, 'alice', A), await connect(url, 'bob', A)]
    const { routines } = RPC_CHANNELS
    const config = { type: 'event' as const, event: 'LabelAdd', actions: [{ type: 'prompt' as const, prompt: 'x' }] }
    const id = createRoutine({ workspaceId: A, title: 'Bob\'s', config, createdBy: 'user:bob' }).id
    // bob's own change keeps it his
    expect(await bob.invoke(routines.UPDATE, id, { title: 'Still bob\'s' })).toMatchObject({ createdBy: 'user:bob' })
    // Run now by alice (an owner) runs as alice, and leaves the routine bob's
    promptedAs.length = 0
    await alice.invoke(routines.RUN, id)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(promptedAs).toEqual(['user:alice'])
    expect(await alice.invoke(routines.GET, id)).toMatchObject({ createdBy: 'user:bob' })
    // a change by alice makes it hers: its runs no longer use bob's connections, and bob can no longer change it
    expect(await alice.invoke(routines.PAUSE, id)).toMatchObject({ createdBy: 'user:alice' })
    expect(await codeOf(bob.invoke(routines.RESUME, id))).toBe('forbidden')
  })

  it('refuses the install channels to everyone but the instance owner, even a workspace owner', async () => {
    const { url, calls } = await start(false)
    const [alice, zed, bob] = [await connect(url, 'alice', A), await connect(url, 'zed', B), await connect(url, 'bob', A)]
    // every guarded channel is the server's (the desktop's main process answers its own channels without a guard)
    const owned = [...INSTANCE_OWNER_CHANNELS]
    expect(owned.filter((channel) => !registered.has(channel))).toEqual([])
    for (const channel of owned) {
      expect(await codeOf(zed.invoke(channel))).toBe('forbidden')
      expect(await codeOf(bob.invoke(channel))).toBe('forbidden')
      expect(await codeOf(alice.invoke(channel))).toBe('ok')
    }
    expect(calls.sort()).toEqual(owned.sort())
  })

  it('guards the channels that address a settings entity by user, workspace and install', async () => {
    const { url } = await start(false)
    const [alice, bob, zed] = [await connect(url, 'alice', A), await connect(url, 'bob', A), await connect(url, 'zed', B)]
    const { GET_SETTING: read, UPDATE_SETTING: write } = RPC_CHANNELS.settings
    const code = (client: typeof alice, channel: string, entity: string, key: string) =>
      codeOf(client.invoke(channel, entity, key, 'x'))
    // user:<id>: only that user, to read and to write
    expect(await code(bob, write, userEntity('bob'), 'colorTheme')).toBe('ok')
    expect(await code(bob, write, userEntity('alice'), 'colorTheme')).toBe('forbidden')
    expect(await code(bob, read, userEntity('alice'), 'colorTheme')).toBe('forbidden')
    expect(await code(alice, read, userEntity('bob'), 'colorTheme')).toBe('forbidden') // not even the instance owner
    // workspace:<id>: members read, owners write
    expect(await code(bob, read, workspaceEntity(A), 'defaults')).toBe('ok')
    expect(await code(bob, write, workspaceEntity(A), 'defaults')).toBe('forbidden')
    expect(await code(alice, write, workspaceEntity(A), 'defaults')).toBe('ok')
    expect(await code(zed, read, workspaceEntity(A), 'defaults')).toBe('forbidden')
    expect(await code(zed, write, workspaceEntity(A), 'defaults')).toBe('forbidden')
    // install: anyone signed in reads, only the instance owner writes
    expect(await code(bob, read, 'install', 'setupDeferred')).toBe('ok')
    expect(await code(bob, write, 'install', 'setupDeferred')).toBe('forbidden')
    expect(await code(zed, write, 'install', 'setupDeferred')).toBe('forbidden')
    expect(await code(alice, write, 'install', 'setupDeferred')).toBe('ok')
    // a thing that is not an entity is invalid, not forbidden
    expect(await code(bob, read, 'everyone', 'colorTheme')).toBe('invalid')
  })

  it('refuses every channel once the caller is no longer a member of the connection\'s workspace', async () => {
    const { url, calls } = await start(false)
    createWorkspaceMember(A, 'dave', 'member')
    const dave = await connect(url, 'dave', A)
    expect(await codeOf(dave.invoke(RPC_CHANNELS.workspaces.GET))).toBe('ok')
    deleteWorkspaceMember(A, 'dave')
    calls.length = 0
    for (const channel of channels) expect(await codeOf(dave.invoke(channel))).toBe('forbidden')
    expect(calls).toEqual([])
  })

  it('refuses a connection to a workspace the user is not in, including a reconnect', async () => {
    const { url } = await start(false)
    expect(await handshake(url, 'alice', A)).toBe('ok')
    expect(await handshake(url, 'alice', B)).toBe('forbidden')
    expect(await handshake(url, 'alice', 'Side')).toBe('forbidden')
    expect(await handshake(url, 'alice', 'nowhere')).toBe('forbidden')
    expect(await handshake(url, 'carol', A)).toBe('forbidden')
    expect(await handshake(url, 'carol')).toBe('ok') // no workspace yet: carol can still list and create
    const carol = await connect(url, 'carol')
    expect(await codeOf(carol.invoke(RPC_CHANNELS.window.SWITCH_WORKSPACE, A))).toBe('forbidden')
  })
})

describe('the workspace channels', () => {
  it('lists only the caller\'s workspaces, and guards the switch', async () => {
    const { url } = await start(true)
    const names = async (user: string, workspaceId?: string) =>
      ((await (await connect(url, user, workspaceId)).invoke(RPC_CHANNELS.workspaces.GET)) as { name: string }[]).map((workspace) => workspace.name)
    expect(await names('alice', A)).toEqual(['Main'])
    expect(await names('zed', B)).toEqual(['Side'])
    expect(await names('carol')).toEqual([])
    const alice = await connect(url, 'alice', A)
    expect(await codeOf(alice.invoke(RPC_CHANNELS.window.SWITCH_WORKSPACE, B))).toBe('forbidden')
    expect(await codeOf(alice.invoke(RPC_CHANNELS.window.SWITCH_WORKSPACE, A))).toBe('ok')
    const info = (await alice.invoke(RPC_CHANNELS.server.GET_WORKSPACES)) as { name: string }[]
    expect(info.map((workspace) => workspace.name)).toEqual(['Main'])
  })

  it('creates a workspace for any signed-in user, who becomes its owner, only inside the server\'s folder', async () => {
    const { url } = await start(true)
    const carol = await connect(url, 'carol')
    const outside = join(configDir, 'elsewhere')
    expect(await codeOf(carol.invoke(RPC_CHANNELS.workspaces.CREATE, outside, 'Out'))).toBe('invalid')
    expect(await codeOf(carol.invoke(RPC_CHANNELS.workspaces.CREATE, join(configDir, 'workspaces', '..', 'x'), 'Out'))).toBe('invalid')
    const created = (await carol.invoke(RPC_CHANNELS.workspaces.CREATE, join(configDir, 'workspaces', 'carol'), 'Carol')) as { id: string }
    expect(getMemberRole(created.id, 'carol')).toBe('owner')
    expect(((await carol.invoke(RPC_CHANNELS.workspaces.GET)) as { id: string }[]).map((workspace) => workspace.id)).toEqual([created.id])
    // Naming the folder of someone else's workspace does not take it over.
    expect(await codeOf(carol.invoke(RPC_CHANNELS.workspaces.CREATE, join(configDir, 'workspaces', 'a'), 'Mine'))).toBe('forbidden')
    expect(getMemberRole(A, 'carol')).toBeNull()
    // A signed-in user of the server can create through the server channel too.
    const viaServer = (await carol.invoke(RPC_CHANNELS.server.CREATE_WORKSPACE, 'Second')) as { id: string }
    expect(getMemberRole(viaServer.id, 'carol')).toBe('owner')
  })
})

describe('the connection channels', () => {
  const secret = 'sk-ant-api03-THE-WHOLE-SECRET-KEY-9876'
  const connection = (slug: string, scope?: string) => ({ slug, scope, type: 'anthropic', authType: 'api_key' as const, title: slug })

  beforeAll(() => {
    createConnection(connection('inst'), { apiKey: secret })
    createConnection(connection('in-a', workspaceScope(A)), { apiKey: secret })
    createConnection(connection('in-b', workspaceScope(B)), { apiKey: secret })
    createConnection(connection('mine-bob', userScope('bob')), { apiKey: secret })
    createWorkspaceMember(A, 'zed', 'member')
  })

  /** Arguments that name a connection where the channel expects one (an object where the channel takes a setup, a connection or setup-test params). */
  const callArgs = (channel: string, slug: string, scope?: string): unknown[] => {
    const index = CONNECTION_WRITE_CHANNELS.get(channel)!
    const objectChannels: string[] = [RPC_CHANNELS.settings.SETUP_LLM_CONNECTION, RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP, RPC_CHANNELS.llmConnections.SAVE]
    return [...Array(index).fill('x'), objectChannels.includes(channel) ? { slug, connectionSlug: slug, scope } : slug]
  }

  it('declares only channels that exist', () => {
    for (const channel of CONNECTION_WRITE_CHANNELS.keys()) expect(registered.has(channel)).toBe(true)
  })

  it("lets the instance owner change the install's connections, and nobody else, workspace owners included", async () => {
    const { url, calls } = await start(false)
    const [alice, bob, zed] = [await connect(url, 'alice', A), await connect(url, 'bob', A), await connect(url, 'zed', B)]
    for (const channel of CONNECTION_WRITE_CHANNELS.keys()) {
      expect(await codeOf(alice.invoke(channel, ...callArgs(channel, 'inst')))).toBe('ok')
      expect(await codeOf(bob.invoke(channel, ...callArgs(channel, 'inst')))).toBe('forbidden')
      expect(await codeOf(zed.invoke(channel, ...callArgs(channel, 'inst')))).toBe('forbidden')
    }
    expect(calls.length).toBe(CONNECTION_WRITE_CHANNELS.size)
  })

  it('lets the owners of a workspace change its connections, and nobody else', async () => {
    const { url } = await start(false)
    const [alice, bob, zedInB, zedInA] = [await connect(url, 'alice', A), await connect(url, 'bob', A), await connect(url, 'zed', B), await connect(url, 'zed', A)]
    for (const channel of CONNECTION_WRITE_CHANNELS.keys()) {
      // in-a belongs to A: its owner (alice) may, a member (bob, zed) may not
      expect(await codeOf(alice.invoke(channel, ...callArgs(channel, 'in-a')))).toBe('ok')
      expect(await codeOf(bob.invoke(channel, ...callArgs(channel, 'in-a')))).toBe('forbidden')
      expect(await codeOf(zedInA.invoke(channel, ...callArgs(channel, 'in-a')))).toBe('forbidden')
      // in-b belongs to B: its owner (zed, who is not the instance owner) may
      expect(await codeOf(zedInB.invoke(channel, ...callArgs(channel, 'in-b')))).toBe('ok')
    }
  })

  it("lets a person manage their own connections and nobody else's, the instance owner's included", async () => {
    const { url } = await start(false)
    const [bob, zed] = [await connect(url, 'bob', A), await connect(url, 'zed', B)]
    for (const channel of CONNECTION_WRITE_CHANNELS.keys()) {
      // mine-bob is bob's own: bob finds it; for the others the slug names nothing of theirs, so it is a new connection of their own
      expect(await codeOf(bob.invoke(channel, ...callArgs(channel, 'mine-bob')))).toBe('ok')
      expect(await codeOf(zed.invoke(channel, ...callArgs(channel, 'mine-bob')))).toBe('ok')
    }
  })

  it('makes a new connection the caller\'s own, the workspace\'s for its owners, the install\'s for the instance owner', async () => {
    const { url } = await start(false)
    const [alice, bob, zedInB] = [await connect(url, 'alice', A), await connect(url, 'bob', A), await connect(url, 'zed', B)]
    const setup = RPC_CHANNELS.settings.SETUP_LLM_CONNECTION
    // no scope named: the caller's own, anyone may
    expect(await codeOf(bob.invoke(setup, { slug: 'fresh' }))).toBe('ok')
    expect(await codeOf(zedInB.invoke(setup, { slug: 'fresh' }))).toBe('ok')
    expect(await codeOf(zedInB.invoke(setup, { slug: 'fresh', scope: 'user' }))).toBe('ok')
    // the workspace's: its owners; the install's: the instance owner
    expect(await codeOf(zedInB.invoke(setup, { slug: 'fresh', scope: 'workspace' }))).toBe('ok')
    expect(await codeOf(bob.invoke(setup, { slug: 'fresh', scope: 'workspace' }))).toBe('forbidden')
    expect(await codeOf(zedInB.invoke(setup, { slug: 'fresh', scope: 'install' }))).toBe('forbidden')
    expect(await codeOf(bob.invoke(setup, { slug: 'fresh', scope: 'install' }))).toBe('forbidden')
    expect(await codeOf(alice.invoke(setup, { slug: 'fresh', scope: 'install' }))).toBe('ok')
    // naming the install's connection that exists is the install's, whatever the person's own are called
    expect(await codeOf(bob.invoke(setup, { slug: 'inst' }))).toBe('forbidden')
    expect(await codeOf(bob.invoke(setup, { slug: 'inst', scope: 'user' }))).toBe('ok')
  })

  it('lets every member read connections and the sign-in status, with no secret in what comes back', async () => {
    const { url } = await start(true)
    const [alice, bob] = [await connect(url, 'alice', A), await connect(url, 'bob', A)]
    const { LIST, LIST_WITH_STATUS, GET } = RPC_CHANNELS.llmConnections
    const answers = [
      await bob.invoke(LIST),
      await bob.invoke(LIST_WITH_STATUS),
      await bob.invoke(GET, 'in-a'),
      await bob.invoke(GET, 'inst'),
      await bob.invoke(RPC_CHANNELS.onboarding.GET_AUTH_STATE),
      await alice.invoke(LIST_WITH_STATUS),
    ]
    expect((answers[0] as { slug: string }[]).map((c) => c.slug).sort()).toEqual(['in-a', 'inst', 'mine-bob'])
    expect((answers[1] as { isAuthenticated: boolean }[]).every((c) => c.isAuthenticated)).toBe(true)
    // a person's own connection is seen by that person only
    expect(((await alice.invoke(LIST)) as { slug: string }[]).map((c) => c.slug).sort()).toEqual(['in-a', 'inst'])
    expect(await alice.invoke(GET, 'mine-bob')).toBeNull()
    expect((await alice.invoke(RPC_CHANNELS.llmConnections.DELETE, 'mine-bob')) as { success: boolean }).toMatchObject({ success: false })
    expect(await bob.invoke(GET, 'mine-bob')).toMatchObject({ slug: 'mine-bob', scope: userScope('bob') })
    for (const answer of answers) {
      const text = JSON.stringify(answer)
      expect(text).not.toContain(secret)
      expect(text).not.toContain('THE-WHOLE-SECRET')
    }
  })

  it("lets every member choose their own default among the connections they see, never another's", async () => {
    const { url } = await start(true)
    const [alice, bob] = [await connect(url, 'alice', A), await connect(url, 'bob', A)]
    const { SET_DEFAULT, LIST_WITH_STATUS } = RPC_CHANNELS.llmConnections
    const defaultOf = async (client: typeof alice) => ((await client.invoke(LIST_WITH_STATUS)) as { slug: string; isDefault: boolean }[]).find((c) => c.isDefault)?.slug
    // bob, a member, picks a workspace connection and one of his own
    expect(await bob.invoke(SET_DEFAULT, 'in-a')).toMatchObject({ success: true })
    expect(await defaultOf(bob)).toBe('in-a')
    expect(await bob.invoke(SET_DEFAULT, 'mine-bob')).toMatchObject({ success: true })
    expect(await defaultOf(bob)).toBe('mine-bob')
    // it is his alone: alice's default is the install's
    expect(await defaultOf(alice)).toBe('inst')
    // alice does not see bob's connection, so she cannot make it hers
    expect(await alice.invoke(SET_DEFAULT, 'mine-bob')).toMatchObject({ success: false })
    expect(await defaultOf(alice)).toBe('inst')
  })

  it('lets only the instance owner ask whether claude is runnable', async () => {
    const { url } = await start(true)
    const [alice, bob, zed] = [await connect(url, 'alice', A), await connect(url, 'bob', A), await connect(url, 'zed', B)]
    expect(await alice.invoke(RPC_CHANNELS.claudeCode.GET_STATUS)).toMatchObject({ found: expect.any(Boolean), path: expect.any(String) })
    expect(await codeOf(bob.invoke(RPC_CHANNELS.claudeCode.GET_STATUS))).toBe('forbidden')
    expect(await codeOf(zed.invoke(RPC_CHANNELS.claudeCode.GET_STATUS))).toBe('forbidden')
    expect(await handshake(url, 'stranger', A)).not.toBe('ok')
  })

  it("lets only the instance owner connect a Claude subscription, always as their own", async () => {
    const { url } = await start(true)
    const [alice, bob, zed] = [await connect(url, 'alice', A), await connect(url, 'bob', A), await connect(url, 'zed', B)]
    const setup = RPC_CHANNELS.settings.SETUP_LLM_CONNECTION
    const claude = (scope?: string) => ({ slug: 'claude-test', type: 'claude-code', title: 'Claude', ...(scope ? { scope } : {}) })
    // a member and a workspace owner (zed owns B) are refused, as their own or the workspace's
    for (const scope of [undefined, 'user']) expect(await bob.invoke(setup, claude(scope))).toMatchObject({ success: false, error: CLAUDE_CODE_OWNER_ONLY })
    for (const scope of [undefined, 'user', 'workspace']) expect(await zed.invoke(setup, claude(scope))).toMatchObject({ success: false, error: CLAUDE_CODE_OWNER_ONLY })
    // the instance owner: as their own only
    expect(await alice.invoke(setup, claude('workspace'))).toMatchObject({ success: false, error: CLAUDE_CODE_OWNER_ONLY })
    expect(await alice.invoke(setup, claude('install'))).toMatchObject({ success: false, error: CLAUDE_CODE_OWNER_ONLY })
    expect(await alice.invoke(setup, claude('user'))).toMatchObject({ success: true })
    expect(getConnection('claude-test', { userId: 'alice' })?.scope).toBe(userScope('alice'))
    expect(getConnection('claude-test', { userId: 'bob', workspaceId: A })).toBeUndefined()
    deleteConnection(getConnection('claude-test', { userId: 'alice' })!.id)
  })
})

describe('dictation', () => {
  const create = RPC_CHANNELS.transcription.CREATE
  const audio = Buffer.from(new Uint8Array(8)).toString('base64')

  it('is for members only, and says not_configured (no crash) while no OpenRouter connection is visible', async () => {
    const { url } = await start(true)
    const bob = await connect(url, 'bob', A)
    expect(await codeOf(bob.invoke(create, audio, 'audio/webm'))).toBe('not_configured')
    expect(await codeOf(bob.invoke(create, audio, 'text/plain'))).toBe('invalid')
    expect(await codeOf(bob.invoke(create, 'x'.repeat(14_000_000), 'audio/webm'))).toBe('too_large')
    createWorkspaceMember(A, 'erin', 'member')
    const erin = await connect(url, 'erin', A)
    deleteWorkspaceMember(A, 'erin')
    expect(await codeOf(erin.invoke(create, audio, 'audio/webm'))).toBe('forbidden')
  })

  it("finds the key of the user's own or workspace's openrouter connection, and no one else's", () => {
    const fake = `sk-or-${crypto.randomUUID()}`
    const base = { slug: 'openrouter', type: 'openrouter', authType: 'api_key' as const, title: 'OpenRouter' }
    const mine = createConnection({ ...base, scope: userScope('bob') }, { apiKey: fake })
    const shared = createConnection({ ...base, scope: workspaceScope(B) })
    try {
      expect(getTranscriptionKey({ userId: 'bob', workspaceId: A })).toBe(fake)
      expect(getTranscriptionKey({ userId: 'alice', workspaceId: A })).toBeUndefined()
      expect(getTranscriptionKey({ userId: 'zed', workspaceId: B })).toBeUndefined() // a connection with no key
    } finally {
      deleteConnection(mine.id)
      deleteConnection(shared.id)
    }
  })
})
