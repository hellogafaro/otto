import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Run in isolation: the config dir and the database are fixed when the modules load.
const configDir = mkdtempSync(join(tmpdir(), 'otto-labels-rpc-'))
process.env.OTTO_CONFIG_DIR = configDir

const { RPC_CHANNELS } = await import('@otto/shared/protocol')
const { saveConfig, addWorkspace } = await import('@otto/shared/config')
const { initDb } = await import('@otto/shared/db')
const { pushSchema } = await import('../../../../shared/src/db/push.ts')
const { createWorkspaceMember } = await import('@otto/shared/workspaces')
const { initLabelsStatusesImport } = await import('@otto/shared/labels/import')
const { getLabelsFlat } = await import('@otto/shared/labels/storage')
const { getWorkspacePermissions } = await import('@otto/shared/agent')
const { broadcastDomainChanges } = await import('./domain-changes')
const { registerLabelsHandlers } = await import('./labels')
const { registerStatusesHandlers } = await import('./statuses')
const { runPermissionsAction } = await import('../../sessions/permissions-tool')
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
const labelEvents: string[] = []
const deps = { sessionManager: { emitLabelConfigChange: (id: string) => void labelEvents.push(id) } } as never

const [OWNER, MEMBER, OUTSIDER] = ['aaaaaaaaaaaa', 'bbbbbbbbbbbb', 'cccccccccccc']
let workspaceId = ''
let ctx: Ctx
const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(ctx, ...args)

beforeAll(async () => {
  await pushSchema(initDb())
  saveConfig({ workspaces: [] })
  workspaceId = addWorkspace({ name: 'Test', rootPath: join(configDir, 'workspace') }).id
  createWorkspaceMember(workspaceId, OWNER, 'owner')
  createWorkspaceMember(workspaceId, MEMBER, 'member')
  initLabelsStatusesImport()
  ctx = { clientId: 'c1', userId: OWNER, workspaceId, webContentsId: null }
  const wrapped = broadcastDomainChanges(server as never, { platform: {} } as never)
  registerLabelsHandlers(wrapped, deps)
  registerStatusesHandlers(wrapped, deps)
})
afterAll(() => rmSync(configDir, { recursive: true, force: true }))

const domainPushes = () => pushes.filter((args) => args[0] === RPC_CHANNELS.domain.CHANGED).map((args) => args[2])

describe('labels and statuses handlers', () => {
  it('list what the importer seeded, by workspace id or name', async () => {
    expect(((await call(RPC_CHANNELS.labels.LIST, workspaceId)) as { id: string }[]).map((l) => l.id)).toContain('development')
    expect(((await call(RPC_CHANNELS.statuses.LIST, 'Test')) as { id: string }[]).map((s) => s.id)).toEqual(['backlog', 'todo', 'needs-review', 'done', 'cancelled', 'archived'])
  })

  it('push domain:changed to the workspace after a write, not after a failed one, and fire the label automation event', async () => {
    pushes.length = 0
    await call(RPC_CHANNELS.labels.CREATE, workspaceId, { name: 'Billing' })
    expect(domainPushes()).toEqual([{ domain: 'labels', workspaceId }])
    expect(pushes[0]![1]).toEqual({ to: 'workspace', workspaceId })
    expect(labelEvents).toEqual([workspaceId])

    await call(RPC_CHANNELS.statuses.REORDER, workspaceId, ['done', 'todo'])
    expect(domainPushes()).toEqual([{ domain: 'labels', workspaceId }, { domain: 'statuses', workspaceId }])

    await expect(call(RPC_CHANNELS.labels.DELETE, workspaceId, 'nope')).rejects.toThrow()
    await expect(call(RPC_CHANNELS.statuses.REORDER, workspaceId, ['nope'])).rejects.toThrow()
    expect(domainPushes()).toHaveLength(2) // the failed writes pushed nothing
    expect(labelEvents).toHaveLength(1)

    await call(RPC_CHANNELS.labels.DELETE, workspaceId, 'billing')
    expect(domainPushes()).toHaveLength(3)
    expect(getLabelsFlat(workspaceId).some((l) => l.id === 'billing')).toBe(false)
  })
})

describe('label and status writes (what the otto CLI calls too)', () => {
  it('update, move and reorder labels, and fire the label automation event', async () => {
    labelEvents.length = 0
    await call(RPC_CHANNELS.labels.CREATE, workspaceId, { name: 'Ops' })
    await call(RPC_CHANNELS.labels.CREATE, workspaceId, { name: 'Oncall', parentId: 'ops' })
    expect(await call(RPC_CHANNELS.labels.UPDATE, workspaceId, 'oncall', { name: 'On call', valueType: 'string' })).toMatchObject({ id: 'oncall', name: 'On call', valueType: 'string' })
    await call(RPC_CHANNELS.labels.MOVE, workspaceId, 'oncall')
    expect(getLabelsFlat(workspaceId).find((l) => l.id === 'oncall')).toBeDefined()
    await call(RPC_CHANNELS.labels.REORDER, workspaceId, ['oncall', 'ops'])
    expect(labelEvents).toHaveLength(5)
    await expect(call(RPC_CHANNELS.labels.UPDATE, workspaceId, 'nope', { name: 'x' })).rejects.toMatchObject({ code: 'not_found' })
    await call(RPC_CHANNELS.labels.DELETE, workspaceId, 'ops')
    await call(RPC_CHANNELS.labels.DELETE, workspaceId, 'oncall')
  })

  it('create, update, set the default of and delete statuses, refusing what the domain refuses', async () => {
    pushes.length = 0
    expect(await call(RPC_CHANNELS.statuses.CREATE, workspaceId, { label: 'Blocked', category: 'open', icon: '⛔' })).toMatchObject({ id: 'blocked', icon: '⛔' })
    expect(await call(RPC_CHANNELS.statuses.UPDATE, workspaceId, 'blocked', { label: 'Stuck' })).toMatchObject({ id: 'blocked', label: 'Stuck' })
    await call(RPC_CHANNELS.statuses.SET_DEFAULT, workspaceId, 'blocked')
    await expect(call(RPC_CHANNELS.statuses.DELETE, workspaceId, 'blocked')).rejects.toMatchObject({ code: 'forbidden' }) // the default
    await call(RPC_CHANNELS.statuses.SET_DEFAULT, workspaceId, 'todo')
    expect(await call(RPC_CHANNELS.statuses.DELETE, workspaceId, 'blocked')).toEqual({ migrated: 0 })
    await expect(call(RPC_CHANNELS.statuses.DELETE, workspaceId, 'todo')).rejects.toMatchObject({ code: 'forbidden' }) // fixed
    await expect(call(RPC_CHANNELS.statuses.CREATE, workspaceId, { label: 'X', category: 'open', icon: 'https://x.test/i.svg' })).rejects.toMatchObject({ code: 'invalid' })
    expect(domainPushes()).toEqual(Array(5).fill({ domain: 'statuses', workspaceId }))
  })
})

describe('the agent tool permissions_edit', () => {
  const code = (fn: () => unknown) => {
    try {
      fn()
    } catch (error) {
      return (error as { code?: string }).code
    }
  }

  it('lets an owner replace the rules, a member read them and a non-member nothing', () => {
    expect(runPermissionsAction(workspaceId, OWNER, { action: 'update', rules: { allowedBashPatterns: ['^make\\s+test'] } }).wrote).toBe(true)
    expect(getWorkspacePermissions(workspaceId)).toEqual({ allowedBashPatterns: ['^make\\s+test'] })
    expect(runPermissionsAction(workspaceId, MEMBER, { action: 'get' })).toEqual({ result: { allowedBashPatterns: ['^make\\s+test'] }, wrote: false })
    expect(code(() => runPermissionsAction(workspaceId, MEMBER, { action: 'update', rules: {} }))).toBe('forbidden')
    expect(code(() => runPermissionsAction(workspaceId, OUTSIDER, { action: 'get' }))).toBe('forbidden')
    expect(code(() => runPermissionsAction(workspaceId, null, { action: 'get' }))).toBe('forbidden')
  })

  it('refuses a bad rule and an unknown action', () => {
    expect(code(() => runPermissionsAction(workspaceId, OWNER, { action: 'update', rules: { allowedBashPatterns: ['('] } }))).toBe('invalid')
    expect(code(() => runPermissionsAction(workspaceId, OWNER, { action: 'explode' }))).toBe('invalid')
  })
})
