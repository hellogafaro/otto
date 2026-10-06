import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Run in isolation: the config dir and the database are fixed when the modules load.
const configDir = mkdtempSync(join(tmpdir(), 'otto-projects-rpc-'))
process.env.OTTO_CONFIG_DIR = configDir

const { RPC_CHANNELS } = await import('@otto/shared/protocol')
const { saveConfig, addWorkspace } = await import('@otto/shared/config')
const { initDb } = await import('@otto/shared/db')
const { pushSchema } = await import('../../../../shared/src/db/push.ts')
const { getProjectPromptContext } = await import('@otto/shared/projects')
const { createWorkspaceMember } = await import('@otto/shared/workspaces')
const { registerProjectsHandlers, HANDLED_CHANNELS: PROJECT_CHANNELS } = await import('./projects')
const { registerTasksHandlers, HANDLED_CHANNELS: TASK_CHANNELS } = await import('./tasks')
type Ctx = import('../../transport/types').RequestContext
type Handler = import('../../transport/types').HandlerFn
type Deps = import('../handler-deps').HandlerDeps

const handlers = new Map<string, Handler>()
const server = {
  handle: (channel: string, handler: Handler) => void handlers.set(channel, handler),
  push() {},
  async invokeClient() {},
  hasClientCapability: () => false,
  findClientsWithCapability: () => [],
}
const deps = { platform: { logger: { info() {}, warn() {}, error() {}, debug() {} } } } as unknown as Deps

const USER_ID = 'abcdefghijkl'
const ME = `user:${USER_ID}`
let workspaceId = ''
let ctx: Ctx
let otherCtx: Ctx
const callAs = async (as: Ctx, channel: string, ...args: unknown[]) => handlers.get(channel)!(as, ...args)
const call = (channel: string, ...args: unknown[]) => callAs(ctx, channel, ...args)

beforeAll(async () => {
  await pushSchema(initDb())
  saveConfig({ workspaces: [], activeWorkspaceId: null, activeSessionId: null })
  workspaceId = addWorkspace({ name: 'Test', rootPath: join(configDir, 'workspace') }).id
  const otherId = addWorkspace({ name: 'Other', rootPath: join(configDir, 'other') }).id
  createWorkspaceMember(workspaceId, USER_ID, 'owner')
  createWorkspaceMember(otherId, USER_ID, 'owner')
  ctx = { clientId: 'c1', userId: USER_ID, workspaceId, webContentsId: null }
  otherCtx = { clientId: 'c2', userId: USER_ID, workspaceId: otherId, webContentsId: null }
  registerProjectsHandlers(server as never, deps)
  registerTasksHandlers(server as never, deps)
})
afterAll(() => rmSync(configDir, { recursive: true, force: true }))

describe('projects, tasks and timesheets RPC', () => {
  it('registers every channel it declares', () => {
    for (const channel of [...PROJECT_CHANNELS, ...TASK_CHANNELS]) expect(handlers.has(channel)).toBe(true)
  })

  it('runs a project through create, update, conflict, archive and restore', async () => {
    const project = await call(RPC_CHANNELS.projects.CREATE, {
      title: 'Launch',
      description: 'Ship it',
      resources: [{ type: 'url', title: 'Repo', ref: 'https://example.com/repo' }],
    })
    expect(project).toMatchObject({ title: 'Launch', status: 'active' })
    expect(await call(RPC_CHANNELS.projects.GET, project.id)).toEqual(project)
    expect(await call(RPC_CHANNELS.projects.GET, 'missing00000')).toBeNull()
    expect(await call(RPC_CHANNELS.projects.LIST)).toEqual([project])
    expect(await call(RPC_CHANNELS.projects.GET_MEMBERS, project.id)).toEqual([{ actor: ME, role: 'contributor' }])

    const renamed = await call(RPC_CHANNELS.projects.UPDATE, project.id, { title: 'Launch 2', expectedUpdatedAt: project.updatedAt })
    expect(renamed.title).toBe('Launch 2')
    await expect(call(RPC_CHANNELS.projects.UPDATE, project.id, { title: 'Stale', expectedUpdatedAt: project.updatedAt })).rejects.toThrow('changed since')
    expect((await call(RPC_CHANNELS.projects.GET, project.id)).title).toBe('Launch 2')

    await call(RPC_CHANNELS.projects.SET_MEMBER, project.id, 'agent:default', 'viewer')
    expect(await call(RPC_CHANNELS.projects.GET_MEMBERS, project.id)).toEqual([
      { actor: 'agent:default', role: 'viewer' },
      { actor: ME, role: 'contributor' },
    ])
    await call(RPC_CHANNELS.projects.REMOVE_MEMBER, project.id, 'agent:default')

    expect(await call(RPC_CHANNELS.projects.SET_STATUS, project.id, 'archived')).toMatchObject({ status: 'archived' })
    expect(await call(RPC_CHANNELS.projects.LIST)).toEqual([])
    expect(await call(RPC_CHANNELS.projects.LIST, { status: 'archived' })).toHaveLength(1)
    expect(await call(RPC_CHANNELS.projects.SET_STATUS, project.id, 'active')).toMatchObject({ status: 'active' })
    expect(await call(RPC_CHANNELS.projects.LIST)).toHaveLength(1)
    await expect(call(RPC_CHANNELS.projects.CREATE, { title: '' })).rejects.toThrow('title is required')
  })

  it('refuses people who are not members of the workspace as assignees or project members', async () => {
    const stranger = 'user:zzzzzzzzzzzz'
    const project = await call(RPC_CHANNELS.projects.CREATE, { title: 'Members' })
    await expect(call(RPC_CHANNELS.projects.SET_MEMBER, project.id, stranger, 'viewer')).rejects.toThrow('not a member')
    await expect(call(RPC_CHANNELS.tasks.CREATE, { projectId: project.id, title: 'x', assignees: [ME, stranger] })).rejects.toThrow('not a member')
    const task = await call(RPC_CHANNELS.tasks.CREATE, { projectId: project.id, title: 'x', assignees: ['agent:default'] })
    await expect(call(RPC_CHANNELS.tasks.UPDATE, task.id, { assignees: [stranger] })).rejects.toMatchObject({ code: 'invalid' })
    expect((await call(RPC_CHANNELS.tasks.GET, task.id)).assignees).toEqual(['agent:default'])
    // A member of another workspace is not enough.
    createWorkspaceMember(otherCtx.workspaceId!, 'abcdefghijkm', 'member')
    await expect(call(RPC_CHANNELS.projects.SET_MEMBER, project.id, 'user:abcdefghijkm', 'viewer')).rejects.toThrow('not a member')
  })

  it('gives the agent prompt the project, and nothing for unknown or deleted ones', async () => {
    const project = await call(RPC_CHANNELS.projects.CREATE, {
      title: 'Prompted',
      description: 'Context',
      resources: [{ type: 'chat', title: 'Kickoff', ref: 'c1' }],
    })
    expect(getProjectPromptContext(workspaceId, project.id)).toEqual({
      title: 'Prompted',
      description: 'Context',
      resources: [{ type: 'chat', title: 'Kickoff', ref: 'c1' }],
    })
    expect(getProjectPromptContext(workspaceId, 'missing00000')).toBeUndefined()
    expect(getProjectPromptContext('other-workspace', project.id)).toBeUndefined()
    await call(RPC_CHANNELS.projects.SET_STATUS, project.id, 'archived')
    expect(getProjectPromptContext(workspaceId, project.id)?.title).toBe('Prompted')
    await call(RPC_CHANNELS.projects.SET_STATUS, project.id, 'deleted')
    expect(getProjectPromptContext(workspaceId, project.id)).toBeUndefined()
  })

  it('runs a task with timesheets and keeps workspaces apart', async () => {
    const project = await call(RPC_CHANNELS.projects.CREATE, { title: 'Work' })
    const task = await call(RPC_CHANNELS.tasks.CREATE, { projectId: project.id, title: 'Write', assignees: [ME, ME] })
    expect(task).toMatchObject({ projectId: project.id, status: 'todo', assignees: [ME] })
    expect(await call(RPC_CHANNELS.tasks.GET, task.id)).toEqual(task)
    expect(await call(RPC_CHANNELS.tasks.LIST, { assignee: ME })).toEqual([task])
    await expect(call(RPC_CHANNELS.tasks.CREATE, { projectId: 'missing00000', title: 'x' })).rejects.toThrow('does not exist')

    const updated = await call(RPC_CHANNELS.tasks.UPDATE, task.id, { title: 'Write more', expectedUpdatedAt: task.updatedAt })
    expect(updated.title).toBe('Write more')
    await expect(call(RPC_CHANNELS.tasks.UPDATE, task.id, { title: 'Stale', expectedUpdatedAt: task.updatedAt })).rejects.toThrow('changed since')

    const sheet = await call(RPC_CHANNELS.timesheets.CREATE, { taskId: task.id, time: 60_000, notes: 'draft' })
    expect(sheet).toMatchObject({ taskId: task.id, time: 60_000, notes: 'draft', createdBy: ME })
    expect(await call(RPC_CHANNELS.timesheets.LIST, task.id)).toEqual([sheet])
    await expect(call(RPC_CHANNELS.timesheets.CREATE, { taskId: task.id, time: 0 })).rejects.toThrow('milliseconds')

    expect(await call(RPC_CHANNELS.tasks.GET, task.id)).toEqual(updated)
    expect(await callAs(otherCtx, RPC_CHANNELS.tasks.GET, task.id)).toBeNull()
    expect(await callAs(otherCtx, RPC_CHANNELS.tasks.LIST)).toEqual([])
    expect(await callAs(otherCtx, RPC_CHANNELS.timesheets.LIST, task.id)).toEqual([])
    await expect(callAs(otherCtx, RPC_CHANNELS.projects.UPDATE, project.id, { title: 'x' })).rejects.toThrow('does not exist')

    expect(await call(RPC_CHANNELS.tasks.SET_STATUS, task.id, 'archived')).toMatchObject({ status: 'archived' })
    expect(await call(RPC_CHANNELS.tasks.LIST, { projectId: project.id })).toEqual([])
    expect(await call(RPC_CHANNELS.tasks.SET_STATUS, task.id, 'todo')).toMatchObject({ status: 'todo' })
    expect(await call(RPC_CHANNELS.tasks.LIST, { projectId: project.id })).toHaveLength(1)

    await call(RPC_CHANNELS.timesheets.DELETE, sheet.id)
    expect(await call(RPC_CHANNELS.timesheets.LIST, task.id)).toEqual([])
    await expect(call(RPC_CHANNELS.timesheets.DELETE, sheet.id)).rejects.toThrow('does not exist')
  })
})
