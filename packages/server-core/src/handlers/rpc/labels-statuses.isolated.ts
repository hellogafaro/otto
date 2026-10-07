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
const { runWorkspaceConfigAction } = await import('../../sessions/workspace-config-tool')
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

describe('the agent tools labels_edit, statuses_edit and permissions_edit', () => {
  const run = (user: string | null, domain: 'labels' | 'statuses' | 'permissions', args: Record<string, unknown>) => runWorkspaceConfigAction(workspaceId, user, domain, args)
  const code = (fn: () => unknown) => {
    try {
      fn()
    } catch (error) {
      return (error as { code?: string }).code
    }
  }

  it('let an owner change the workspace and report that something was written', () => {
    expect(run(OWNER, 'labels', { action: 'create', name: 'Ops' })).toMatchObject({ result: { id: 'ops' }, wrote: true })
    expect(run(OWNER, 'labels', { action: 'create', name: 'Oncall', parentId: 'ops', valueType: 'string', autoRules: [{ semantic: 'Is it urgent?' }] }).wrote).toBe(true)
    expect(run(OWNER, 'labels', { action: 'reorder', parentId: null, orderedIds: ['ops'] }).wrote).toBe(true)
    expect(run(OWNER, 'labels', { action: 'delete', id: 'ops' })).toMatchObject({ result: { stripped: 0 }, wrote: true })
    const created = run(OWNER, 'statuses', { action: 'create', label: 'Blocked', category: 'open', icon: '⛔' })
    expect(created).toMatchObject({ result: { id: 'blocked', icon: '⛔' }, wrote: true })
    expect(run(OWNER, 'statuses', { action: 'set_default', id: 'blocked' }).wrote).toBe(true)
    expect(run(OWNER, 'statuses', { action: 'set_default', id: 'todo' }).wrote).toBe(true)
    expect(run(OWNER, 'statuses', { action: 'delete', id: 'blocked' })).toMatchObject({ result: { migrated: 0 }, wrote: true })
    expect(run(OWNER, 'permissions', { action: 'update', rules: { allowedBashPatterns: ['^make\\s+test'] } }).wrote).toBe(true)
    expect(getWorkspacePermissions(workspaceId)).toEqual({ allowedBashPatterns: ['^make\\s+test'] })
  })

  it('let a member read, never write, and a non-member nothing', () => {
    for (const [domain, read] of [['labels', 'list'], ['statuses', 'list'], ['permissions', 'get']] as const) {
      expect(run(MEMBER, domain, { action: read }).wrote).toBe(false)
      expect(code(() => run(OUTSIDER, domain, { action: read }))).toBe('forbidden')
      expect(code(() => run(null, domain, { action: read }))).toBe('forbidden')
    }
    expect(code(() => run(MEMBER, 'labels', { action: 'create', name: 'Nope' }))).toBe('forbidden')
    expect(code(() => run(MEMBER, 'statuses', { action: 'reorder', orderedIds: ['done'] }))).toBe('forbidden')
    expect(code(() => run(MEMBER, 'permissions', { action: 'update', rules: {} }))).toBe('forbidden')
    expect(getLabelsFlat(workspaceId).some((l) => l.id === 'nope')).toBe(false)
  })

  it('refuse what the domain refuses, and say an unknown action is unknown', () => {
    expect(code(() => run(OWNER, 'labels', { action: 'create' }))).toBe('invalid') // no name
    expect(code(() => run(OWNER, 'labels', { action: 'update', id: 'nope', name: 'x' }))).toBe('not_found')
    expect(code(() => run(OWNER, 'statuses', { action: 'delete', id: 'todo' }))).toBe('forbidden') // fixed
    expect(code(() => run(OWNER, 'statuses', { action: 'create', label: 'X', category: 'open', icon: 'https://x.test/i.svg' }))).toBe('invalid')
    expect(code(() => run(OWNER, 'permissions', { action: 'update', rules: { allowedBashPatterns: ['('] } }))).toBe('invalid')
    expect(code(() => run(OWNER, 'labels', { action: 'explode' }))).toBe('invalid')
  })

  it('show an image icon as [image] instead of its data', () => {
    const { result } = run(MEMBER, 'statuses', { action: 'list' }) as { result: { id: string; icon?: string }[] }
    expect(result.find((s) => s.id === 'todo')?.icon).toBe('[image]')
  })
})

describe('the agent tool routines_edit', () => {
  const config = { type: 'event', event: 'LabelAdd', actions: [{ type: 'prompt', prompt: 'triage' }] }
  const run = (user: string | null, args: Record<string, unknown>, runRoutine?: Parameters<typeof runWorkspaceConfigAction>[4]) => runWorkspaceConfigAction(workspaceId, user, 'routines', args, runRoutine)
  const code = (fn: () => unknown) => {
    try {
      fn()
    } catch (error) {
      return (error as { code?: string }).code
    }
  }

  it("lets any member create one as their own and only its creator or an owner change it; an owner's change makes it the owner's", () => {
    const created = run(MEMBER, { action: 'create', title: 'Triage', config }) as { result: { id: string; createdBy: string }; wrote: boolean }
    expect(created).toMatchObject({ result: { createdBy: `user:${MEMBER}` }, wrote: true })
    const id = created.result.id
    expect(run(MEMBER, { action: 'list' })).toMatchObject({ wrote: false })
    expect((run(MEMBER, { action: 'get', id }).result as { runs: unknown[] }).runs).toEqual([])
    expect(run(MEMBER, { action: 'update', id, title: 'Triage bugs' }).result).toMatchObject({ title: 'Triage bugs', createdBy: `user:${MEMBER}` })
    expect(code(() => run(OUTSIDER, { action: 'list' }))).toBe('forbidden')
    expect(code(() => run(MEMBER, { action: 'create', title: 'Bad', config: { type: 'event', actions: [] } }))).toBe('invalid')

    expect(run(OWNER, { action: 'pause', id }).result).toMatchObject({ createdBy: `user:${OWNER}` })
    expect(code(() => run(MEMBER, { action: 'resume', id }))).toBe('forbidden')
    expect(code(() => run(MEMBER, { action: 'delete', id }))).toBe('forbidden')
  })

  it('runs a routine as the caller, and deletes it', () => {
    const id = (run(MEMBER, { action: 'create', title: 'Run me', config }).result as { id: string }).id
    const ranAs: string[] = []
    const result = run(MEMBER, { action: 'run', id }, (routine) => (ranAs.push(routine.createdBy), { id: 'run1', routineId: routine.id, scheduledFor: 0, status: 'running', chatId: null, error: null, startedAt: 0 }))
    expect(result).toMatchObject({ result: { id: 'run1' }, wrote: true })
    expect(ranAs).toEqual([`user:${MEMBER}`])
    expect(code(() => run(MEMBER, { action: 'run', id }))).toBe('invalid') // nothing to run it with
    expect(run(MEMBER, { action: 'delete', id })).toMatchObject({ result: { deleted: id }, wrote: true })
    expect(code(() => run(MEMBER, { action: 'get', id }))).toBe('not_found')
  })
})
