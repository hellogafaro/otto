import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Run in isolation: the config dir and the database are fixed when the modules load.
const configDir = mkdtempSync(join(tmpdir(), 'otto-sources-rpc-'))
process.env.OTTO_CONFIG_DIR = configDir

const { RPC_CHANNELS: C } = await import('@otto/shared/protocol')
const { saveConfig, addWorkspace } = await import('@otto/shared/config')
const { initDb } = await import('@otto/shared/db')
const { pushSchema } = await import('../../../../shared/src/db/push.ts')
const { createWorkspaceMember } = await import('@otto/shared/workspaces')
const { getCredentialManager } = await import('@otto/shared/credentials')
const { getSource, getSourceCredential, getSources, loadSource, syncLocalSource } = await import('@otto/shared/sources')
const { authorize } = await import('../../bootstrap/authorize')
const { broadcastDomainChanges } = await import('./domain-changes')
const { registerSourcesHandlers } = await import('./sources')
const { registerOAuthHandlers } = await import('./oauth')
type Handler = import('../../transport/types').HandlerFn
type Ctx = import('../../transport/types').RequestContext

const handlers = new Map<string, Handler>()
const pushes: unknown[][] = []
const server = {
  handle: (channel: string, handler: Handler) => void handlers.set(channel, handler),
  push: (...args: unknown[]) => void pushes.push(args),
  async invokeClient() {},
  hasClientCapability: () => false,
  findClientsWithCapability: () => [],
}

const [OWNER, CREATOR, OTHER, OUTSIDER] = ['aaaaaaaaaaaa', 'bbbbbbbbbbbb', 'cccccccccccc', 'dddddddddddd']
let workspaceId = ''
const root = join(configDir, 'workspace')
const ctxOf = (userId: string): Ctx => ({ clientId: 'c1', userId, workspaceId, webContentsId: null })
const call = (userId: string, channel: string, ...args: unknown[]) => handlers.get(channel)!(ctxOf(userId), ...args)
const refused = (userId: string, channel: string, ...args: unknown[]) => {
  try {
    authorize({ userId, workspaceId }, channel, args)
    return false
  } catch (error) {
    return (error as { code?: string }).code === 'forbidden'
  }
}

beforeAll(async () => {
  await pushSchema(initDb())
  saveConfig({ workspaces: [] })
  workspaceId = addWorkspace({ name: 'Test', rootPath: root }).id
  createWorkspaceMember(workspaceId, OWNER, 'owner')
  createWorkspaceMember(workspaceId, CREATOR, 'member')
  createWorkspaceMember(workspaceId, OTHER, 'member')
  const deps = { platform: { logger: { info() {}, warn() {}, error() {} } }, oauthFlowStore: {}, sessionManager: {} } as never
  registerSourcesHandlers(broadcastDomainChanges(server as never, deps), deps)
  registerOAuthHandlers(broadcastDomainChanges(server as never, deps), deps)
})
afterAll(() => rmSync(configDir, { recursive: true, force: true }))

describe('sources handlers', () => {
  it('creates a source (folder, then a row made by the caller) and lists the rows read from their folders', async () => {
    pushes.length = 0
    const created = (await call(CREATOR, C.sources.CREATE, workspaceId, { name: 'Shop', provider: 'custom', type: 'api', icon: '🛒', api: { baseUrl: 'https://shop.test', authType: 'bearer' } })) as { slug: string }
    expect(created.slug).toBe('shop')
    expect(getSource(workspaceId, 'shop')).toMatchObject({ title: 'Shop', type: 'api', authStatus: 'needs_auth', createdBy: `user:${CREATOR}` })
    const list = (await call(OTHER, C.sources.GET, 'Test')) as { config: { slug: string; name: string }; guide: { raw: string } | null; workspaceId: string }[]
    expect(list.map((s) => [s.config.slug, s.config.name])).toEqual([['shop', 'Shop']])
    expect(list[0]!.workspaceId).toBe(workspaceId) // credentials and rows are keyed by the workspace's id, not its folder name
    expect(pushes.filter((args) => args[0] === C.domain.CHANGED).map((args) => args[2])).toEqual([{ domain: 'sources', workspaceId }])
  })

  it('lists no folder that is not a row yet, and a sync of the folder makes it one', async () => {
    await mkdir(join(root, 'sources', 'by-agent'), { recursive: true })
    await writeFile(join(root, 'sources', 'by-agent', 'config.json'), JSON.stringify({ id: 'x', name: 'By agent', slug: 'by-agent', enabled: true, provider: 'custom', type: 'local', local: { path: '/tmp' } }))
    expect(((await call(OTHER, C.sources.GET, workspaceId)) as { config: { slug: string } }[]).map((s) => s.config.slug)).toEqual(['shop'])
    await syncLocalSource(workspaceId, 'by-agent')
    expect(((await call(OTHER, C.sources.GET, workspaceId)) as { config: { slug: string } }[]).map((s) => s.config.slug)).toEqual(['by-agent', 'shop'])
    expect(getSource(workspaceId, 'by-agent')?.createdBy).toBe(`user:${OWNER}`) // a folder nobody made through a client: the workspace's first owner
  })

  it('saves a credential as the source\'s secret, never in the folder, and never turns a client\'s string into a path', async () => {
    pushes.length = 0
    await call(CREATOR, C.sources.SAVE_CREDENTIALS, workspaceId, 'shop', 'secret-token')
    const source = loadSource(root, 'shop')!
    expect(getSourceCredential(workspaceId, 'shop', 'source_bearer')).toEqual({ value: 'secret-token' })
    expect(await getCredentialManager().getSourceCredential({ type: 'source_bearer', workspaceId, sourceId: 'shop' })).toEqual({ value: 'secret-token' })
    expect(await Bun.file(join(root, 'sources', 'shop', 'config.json')).text()).not.toContain('secret-token')
    expect(source.config.isAuthenticated).toBe(true)
    expect(pushes.filter((args) => args[0] === C.domain.CHANGED).map((args) => args[2])).toEqual([{ domain: 'sources', workspaceId }])
    for (const slug of ['..', '../..', 'nope']) {
      await expect(call(CREATOR, C.sources.SAVE_CREDENTIALS, workspaceId, slug, 'x')).rejects.toMatchObject({ code: 'not_found' })
      await expect(call(CREATOR, C.sources.DELETE, workspaceId, slug)).rejects.toMatchObject({ code: 'not_found' })
      expect(await call(CREATOR, C.sources.GET_PERMISSIONS, workspaceId, slug)).toBeNull()
    }
  })

  it('authorizes: members read and create, the creator or an owner writes, credentials included; others and outsiders are refused', () => {
    expect(refused(OTHER, C.sources.GET, workspaceId)).toBe(false)
    expect(refused(OUTSIDER, C.sources.GET, workspaceId)).toBe(true)
    expect(refused(OTHER, C.sources.CREATE, workspaceId)).toBe(false)
    expect(refused(OUTSIDER, C.sources.CREATE, workspaceId)).toBe(true)
    for (const [channel, args] of [
      [C.sources.DELETE, [workspaceId, 'shop']],
      [C.sources.SAVE_CREDENTIALS, [workspaceId, 'shop', 'x']],
      [C.oauth.START, [{ sourceSlug: 'shop' }]],
      [C.oauth.REVOKE, [{ sourceSlug: 'shop' }]],
    ] as [string, unknown[]][]) {
      expect(refused(CREATOR, channel, ...args)).toBe(false)
      expect(refused(OWNER, channel, ...args)).toBe(false)
      expect(refused(OTHER, channel, ...args)).toBe(true)
      expect(refused(OUTSIDER, channel, ...args)).toBe(true)
    }
    expect(refused(OTHER, C.sources.DELETE, 'Test', 'shop')).toBe(true) // by name too
    expect(refused(OTHER, C.sources.DELETE, workspaceId, 'missing')).toBe(false) // the handler answers not_found
    expect(refused(OTHER, C.oauth.START, { sourceSlug: 'missing' })).toBe(false)
  })

  it('revoking signs the source out: the secret goes, the source needs auth, domain:changed is pushed', async () => {
    pushes.length = 0
    await call(CREATOR, C.oauth.REVOKE, { sourceSlug: 'shop' })
    expect(getSourceCredential(workspaceId, 'shop', 'source_bearer')).toBeUndefined()
    expect(loadSource(root, 'shop')!.config.connectionStatus).toBe('needs_auth')
    expect(pushes.filter((args) => args[0] === C.domain.CHANGED).map((args) => args[2])).toEqual([{ domain: 'sources', workspaceId }])
  })

  it('deletes the row, its secret, the bundle and the folder, and pushes domain:changed once; a failed delete pushes nothing', async () => {
    await call(CREATOR, C.sources.SAVE_CREDENTIALS, workspaceId, 'shop', 'again')
    pushes.length = 0
    await expect(call(OWNER, C.sources.DELETE, workspaceId, 'missing')).rejects.toMatchObject({ code: 'not_found' })
    expect(pushes).toHaveLength(0)
    await call(CREATOR, C.sources.DELETE, workspaceId, 'shop')
    expect(getSource(workspaceId, 'shop')).toBeUndefined()
    expect(getSourceCredential(workspaceId, 'shop', 'source_bearer')).toBeUndefined()
    expect(existsSync(join(root, 'sources', 'shop'))).toBe(false)
    expect(pushes.filter((args) => args[0] === C.domain.CHANGED).map((args) => args[2])).toEqual([{ domain: 'sources', workspaceId }])
    expect(getSources(workspaceId).map((s) => s.slug)).toEqual(['by-agent'])
  })
})
