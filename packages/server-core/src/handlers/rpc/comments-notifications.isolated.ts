import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Run in isolation: the config dir and the database are fixed when the modules load.
const configDir = mkdtempSync(join(tmpdir(), 'otto-comments-rpc-'))
process.env.OTTO_CONFIG_DIR = configDir

const { RPC_CHANNELS: C } = await import('@otto/shared/protocol')
const { saveConfig, addWorkspace } = await import('@otto/shared/config')
const { initDb } = await import('@otto/shared/db')
const { pushSchema } = await import('../../../../shared/src/db/push.ts')
const { createWorkspaceMember } = await import('@otto/shared/workspaces')
const { registerCommentsHandlers, HANDLED_CHANNELS: COMMENT_CHANNELS } = await import('./comments')
const { registerNotificationsHandlers, HANDLED_CHANNELS: NOTIFICATION_CHANNELS } = await import('./notifications')
const { registerProjectsHandlers } = await import('./projects')
const { registerTasksHandlers } = await import('./tasks')
const { broadcastDomainChanges } = await import('./domain-changes')
type Ctx = import('../../transport/types').RequestContext
type Handler = import('../../transport/types').HandlerFn
type Deps = import('../handler-deps').HandlerDeps

const handlers = new Map<string, Handler>()
const pushes: { channel: string; target: unknown; args: unknown[] }[] = []
const server = {
  handle: (channel: string, handler: Handler) => void handlers.set(channel, handler),
  push: (channel: string, target: unknown, ...args: unknown[]) => void pushes.push({ channel, target, args }),
  async invokeClient() {},
  hasClientCapability: () => false,
  findClientsWithCapability: () => [],
}
const deps = { platform: { logger: { info() {}, warn() {}, error() {}, debug() {} } } } as unknown as Deps

const A = 'abcdefghijkl'
const B = 'mnopqrstuvwx'
let workspaceId = ''
let otherId = ''
let ctxA: Ctx
let ctxB: Ctx
let ctxOther: Ctx
const callAs = async (as: Ctx, channel: string, ...args: unknown[]) => handlers.get(channel)!(as, ...args)
const codeOf = async (run: Promise<unknown>) => run.then(() => 'ok', (error: { code?: string }) => error.code ?? 'other')

beforeAll(async () => {
  await pushSchema(initDb())
  saveConfig({ workspaces: [], activeWorkspaceId: null, activeSessionId: null })
  workspaceId = addWorkspace({ name: 'Test', rootPath: join(configDir, 'workspace') }).id
  otherId = addWorkspace({ name: 'Other', rootPath: join(configDir, 'other') }).id
  createWorkspaceMember(workspaceId, A, 'owner')
  createWorkspaceMember(workspaceId, B, 'member')
  createWorkspaceMember(otherId, A, 'owner')
  ctxA = { clientId: 'a', userId: A, workspaceId, webContentsId: null }
  ctxB = { clientId: 'b', userId: B, workspaceId, webContentsId: null }
  ctxOther = { clientId: 'o', userId: A, workspaceId: otherId, webContentsId: null }
  const wrapped = broadcastDomainChanges(server as never, deps)
  registerProjectsHandlers(wrapped, deps)
  registerTasksHandlers(wrapped, deps)
  registerCommentsHandlers(wrapped, deps)
  registerNotificationsHandlers(wrapped, deps)
})
afterAll(() => rmSync(configDir, { recursive: true, force: true }))

/** A task made by A, assigned to B, in a fresh project. */
async function makeTask(title = 'Fix login', assignees = [`user:${B}`]) {
  const project = await callAs(ctxA, C.projects.CREATE, { title: 'Project' })
  const task = await callAs(ctxA, C.tasks.CREATE, { projectId: project.id, title, assignees })
  return { project, task, entity: `task:${task.id}` }
}
type Item = { id: string; type: string; status: string; createdBy: string; entity: string; entityTitle: string | null; comment: { id: string; content: string; entity: string } | null }
const inbox = async (as: Ctx) => (await callAs(as, C.notifications.GET)) as Item[]

describe('comments and notifications RPC', () => {
  it('registers every channel it declares', () => {
    for (const channel of [...COMMENT_CHANNELS, ...NOTIFICATION_CHANNELS]) expect(handlers.has(channel)).toBe(true)
  })

  it('tells the assignee, with the entity title, and nobody for their own assignment', async () => {
    const { entity } = await makeTask()
    expect((await inbox(ctxB)).map((n) => [n.type, n.createdBy, n.entity, n.entityTitle, n.status, n.comment])).toEqual([
      ['assigned', `user:${A}`, entity, 'Fix login', 'unread', null],
    ])
    expect(await inbox(ctxA)).toEqual([])
    await makeTask('Mine', [`user:${A}`])
    expect(await inbox(ctxA)).toEqual([])
  })

  it('refuses an assignee who is not a member of the workspace', async () => {
    const project = await callAs(ctxA, C.projects.CREATE, { title: 'Project' })
    expect(await codeOf(callAs(ctxA, C.tasks.CREATE, { projectId: project.id, title: 'x', assignees: ['user:zzzzzzzzzzzz'] }))).toBe('invalid')
  })

  it('a comment mentioning someone tells them, with the comment; nobody else, not even the assignee', async () => {
    const { entity } = await makeTask()
    const before = await callAs(ctxA, C.notifications.GET_UNREAD_COUNT)
    const comment = await callAs(ctxB, C.comments.CREATE, entity, `Look user:${A}, and user:${A} again, and user:${B}`)
    expect(comment).toMatchObject({ entity, createdBy: `user:${B}`, content: `Look user:${A}, and user:${A} again, and user:${B}` })
    expect(await callAs(ctxA, C.notifications.GET_UNREAD_COUNT)).toBe(before + 1)
    const [latest] = await inbox(ctxA)
    expect(latest).toMatchObject({
      type: 'mention',
      status: 'unread',
      createdBy: `user:${B}`,
      entity: `comment:${comment.id}`,
      entityTitle: 'Fix login',
      comment: { id: comment.id, content: comment.content, entity },
    })
    expect((await inbox(ctxB)).filter((n) => n.entity === entity || n.comment?.entity === entity).map((n) => n.type)).toEqual(['assigned'])

    await callAs(ctxA, C.comments.CREATE, entity, 'no mention')
    expect(await callAs(ctxA, C.notifications.GET_UNREAD_COUNT)).toBe(before + 1)
    expect((await callAs(ctxA, C.comments.GET, entity)).map((row: { content: string }) => row.content)).toEqual([comment.content, 'no mention'])
  })

  it('needs a comment on an entity that exists in the workspace', async () => {
    const { entity } = await makeTask()
    expect(await codeOf(callAs(ctxA, C.comments.CREATE, 'task:missing00000', 'x'))).toBe('not_found')
    expect(await codeOf(callAs(ctxA, C.comments.CREATE, 'chat:abcdefghijkl', 'x'))).toBe('not_found')
    expect(await codeOf(callAs(ctxA, C.comments.CREATE, 42, 'x'))).toBe('not_found')
    expect(await codeOf(callAs(ctxOther, C.comments.CREATE, entity, 'x'))).toBe('not_found')
    expect(await codeOf(callAs(ctxA, C.comments.CREATE, entity, ' '))).toBe('invalid')
    expect(await callAs(ctxOther, C.comments.GET, entity)).toEqual([])
  })

  it('comments on a project work the same way', async () => {
    const { project } = await makeTask()
    const comment = await callAs(ctxA, C.comments.CREATE, `project:${project.id}`, `hello user:${B}`)
    expect((await inbox(ctxB))[0]).toMatchObject({ type: 'mention', entityTitle: 'Project', comment: { id: comment.id, entity: `project:${project.id}` } })
  })

  it('lets only the author edit or delete a comment, and deleting removes its notifications', async () => {
    const { entity } = await makeTask()
    const comment = await callAs(ctxA, C.comments.CREATE, entity, `first user:${B}`)
    expect(await codeOf(callAs(ctxB, C.comments.UPDATE, comment.id, 'mine'))).toBe('forbidden')
    expect(await codeOf(callAs(ctxB, C.comments.DELETE, comment.id))).toBe('forbidden')
    expect(await codeOf(callAs(ctxOther, C.comments.UPDATE, comment.id, 'x'))).toBe('not_found')
    const edited = await callAs(ctxA, C.comments.UPDATE, comment.id, `edited user:${B}`, comment.updatedAt)
    expect(edited).toMatchObject({ content: `edited user:${B}`, createdAt: comment.createdAt })
    expect(await codeOf(callAs(ctxA, C.comments.UPDATE, comment.id, 'stale', comment.updatedAt))).toBe('conflict')

    expect((await inbox(ctxB))[0]!.comment?.content).toBe(`edited user:${B}`)
    await callAs(ctxA, C.comments.DELETE, comment.id)
    expect((await inbox(ctxB)).some((n) => n.comment?.id === comment.id)).toBe(false)
    expect(await callAs(ctxA, C.comments.GET, entity)).toEqual([])
  })

  it('reassigning tells only the newly assigned; a status change tells nobody', async () => {
    const { task } = await makeTask()
    const count = async (as: Ctx) => (await inbox(as)).length
    const [a0, b0] = [await count(ctxA), await count(ctxB)]
    await callAs(ctxA, C.tasks.SET_STATUS, task.id, 'doing')
    await callAs(ctxA, C.tasks.UPDATE, task.id, { title: 'Renamed' })
    await callAs(ctxA, C.tasks.UPDATE, task.id, { assignees: [`user:${B}`] })
    expect([await count(ctxA), await count(ctxB)]).toEqual([a0, b0])
    await callAs(ctxB, C.tasks.UPDATE, task.id, { assignees: [`user:${A}`, `user:${B}`] })
    expect([await count(ctxA), await count(ctxB)]).toEqual([a0 + 1, b0])
    expect((await inbox(ctxA))[0]).toMatchObject({ type: 'assigned', createdBy: `user:${B}`, entityTitle: 'Renamed' })
  })

  it('keeps the inbox the caller\'s own and per workspace', async () => {
    const { entity } = await makeTask()
    await callAs(ctxB, C.comments.CREATE, entity, `ping user:${A}`)
    const mine = await inbox(ctxA)
    const unreadBefore = await callAs(ctxA, C.notifications.GET_UNREAD_COUNT)
    expect(unreadBefore).toBeGreaterThan(0)
    expect(await callAs(ctxOther, C.notifications.GET_UNREAD_COUNT)).toBe(0)
    expect(await inbox(ctxOther)).toEqual([])

    // B cannot touch A's rows, ids or 'all'
    const bBefore = await inbox(ctxB)
    await callAs(ctxB, C.notifications.SET_STATUS, mine.map((n) => n.id), 'read')
    await callAs(ctxB, C.notifications.CLEAR, mine.map((n) => n.id))
    expect(await callAs(ctxA, C.notifications.GET_UNREAD_COUNT)).toBe(unreadBefore)
    expect(await inbox(ctxB)).toEqual(bBefore)
    expect(await codeOf(callAs(ctxA, C.notifications.SET_STATUS, 'one', 'read'))).toBe('invalid')
    expect(await codeOf(callAs(ctxA, C.notifications.SET_STATUS, 'all', 'pending'))).toBe('invalid')

    // another workspace's 'all' leaves this one alone
    await callAs(ctxOther, C.notifications.SET_STATUS, 'all', 'read')
    expect(await callAs(ctxA, C.notifications.GET_UNREAD_COUNT)).toBe(unreadBefore)

    await callAs(ctxA, C.notifications.SET_STATUS, [mine[0]!.id], 'read')
    expect(await callAs(ctxA, C.notifications.GET_UNREAD_COUNT)).toBe(unreadBefore - 1)
    await callAs(ctxA, C.notifications.SET_STATUS, 'all', 'read')
    expect(await callAs(ctxA, C.notifications.GET_UNREAD_COUNT)).toBe(0)
    await callAs(ctxA, C.notifications.SET_STATUS, [mine[0]!.id], 'unread')
    expect(await callAs(ctxA, C.notifications.GET_UNREAD_COUNT)).toBe(1)
    await callAs(ctxA, C.notifications.CLEAR, [mine[0]!.id])
    expect((await inbox(ctxA)).length).toBe(mine.length - 1)
    await callAs(ctxA, C.notifications.CLEAR, 'all')
    expect(await inbox(ctxA)).toEqual([])
  })
})

describe('domain:changed after writes', () => {
  const sent = () => pushes.splice(0).map((p) => ({ channel: p.channel, target: p.target, change: p.args[0] }))
  const to = (domain: string, userIds?: string[]) => ({
    channel: C.domain.CHANGED,
    target: { to: 'workspace', workspaceId, ...(userIds && { userIds }) },
    change: { domain, workspaceId, ...(userIds && { userIds }) },
  })

  it('pushes each stale domain once, to the workspace, after a successful write', async () => {
    sent() // what the earlier tests pushed
    const project = await callAs(ctxA, C.projects.CREATE, { title: 'Pushed' })
    expect(sent()).toEqual([to('projects')])
    await callAs(ctxA, C.tasks.CREATE, { projectId: project.id, title: 'T' })
    expect(sent()).toEqual([to('tasks')]) // nobody was assigned: nobody to tell
  })

  it('tells the newly assigned people of an assignment, and the mentioned of a comment', async () => {
    const project = await callAs(ctxA, C.projects.CREATE, { title: 'Pushed' })
    sent()
    const task = await callAs(ctxA, C.tasks.CREATE, { projectId: project.id, title: 'T', assignees: [`user:${B}`, 'agent:default'] })
    expect(sent()).toEqual([to('tasks'), to('notifications', [B])])
    await callAs(ctxA, C.tasks.SET_STATUS, task.id, 'doing')
    expect(sent()).toEqual([to('tasks')])
    const comment = await callAs(ctxA, C.comments.CREATE, `task:${task.id}`, `hi user:${B}`)
    expect(sent()).toEqual([to('comments'), to('notifications', [B])])
    await callAs(ctxA, C.comments.CREATE, `task:${task.id}`, 'no mention')
    expect(sent()).toEqual([to('comments')])
    await callAs(ctxA, C.comments.UPDATE, comment.id, 'edited')
    expect(sent()).toEqual([to('comments')])
    await callAs(ctxA, C.comments.DELETE, comment.id)
    expect(sent()).toEqual([to('comments'), to('notifications')])
  })

  it('does not push for reads or failed writes', async () => {
    sent()
    await callAs(ctxA, C.projects.LIST)
    await callAs(ctxA, C.comments.GET, 'task:missing00000')
    await callAs(ctxA, C.notifications.GET)
    await codeOf(callAs(ctxA, C.tasks.CREATE, { projectId: 'missing00000', title: 'x' }))
    await codeOf(callAs(ctxA, C.comments.CREATE, 'task:missing00000', 'x'))
    expect(sent()).toEqual([])
  })

  it('tells only the caller when only their own inbox changed', async () => {
    sent()
    await callAs(ctxB, C.notifications.SET_STATUS, 'all', 'read')
    await callAs(ctxB, C.notifications.CLEAR, [])
    expect(sent()).toEqual([to('notifications', [B]), to('notifications', [B])])
  })
})
