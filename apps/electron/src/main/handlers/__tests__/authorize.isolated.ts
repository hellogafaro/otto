import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import './electron-mock'
import { createMockDeps } from './electron-mock'

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
const { authorize, OWNER_CHANNELS, WORKSPACE_ARG_CHANNELS } = await import('../../../../../../packages/server-core/src/bootstrap/authorize.ts')
const { registerAllRpcHandlers } = await import('../index')

type Handler = (...args: never[]) => unknown
const registered = new Map<string, Handler>()
const deps = {
  ...createMockDeps(),
  windowManager: undefined,
  sessionManager: {
    getWorkspaces: () => getWorkspaces(),
    getWorkspacesInfo: () => getWorkspaces().map((workspace) => ({ id: workspace.id, name: workspace.name })),
    getActiveSessionsInfo: () => [],
    setupConfigWatcher() {},
  },
} as never
registerAllRpcHandlers(
  { handle: (channel: string, handler: Handler) => void registered.set(channel, handler), push() {}, async invokeClient() {}, hasClientCapability: () => false, findClientsWithCapability: () => [] } as never,
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
    registerAllRpcHandlers(server, deps, { getConnectedClientCount: () => 0, serverId: 'test', startedAt: 0 })
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
  const arg = channel === RPC_CHANNELS.automations.TEST ? { workspaceId: target } : target
  return [...Array(index).fill('x'), arg]
}

beforeAll(async () => {
  await pushSchema(initDb())
  saveConfig({ workspaces: [], activeWorkspaceId: null, activeSessionId: null })
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
        expect(await codeOf(alice.invoke(channel))).toBe('ok')
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
