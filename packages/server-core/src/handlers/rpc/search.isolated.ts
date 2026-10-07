import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Run in isolation: the config dir and the database are fixed when the modules load.
const configDir = mkdtempSync(join(tmpdir(), 'otto-search-rpc-'))
process.env.OTTO_CONFIG_DIR = configDir

const { RPC_CHANNELS: C } = await import('@otto/shared/protocol')
const { saveConfig, addWorkspace } = await import('@otto/shared/config')
const { initDb } = await import('@otto/shared/db')
const { pushSchema } = await import('../../../../shared/src/db/push.ts')
const { initMessages } = await import('@otto/shared/sessions')
const { ChatPersistenceQueue } = await import('../../../../shared/src/sessions/persistence-queue.ts')
const { createWorkspaceMember } = await import('@otto/shared/workspaces')
const { createLibraryFolder } = await import('@otto/shared/library')
const { registerSearchHandlers, HANDLED_CHANNELS } = await import('./search')
const { registerProjectsHandlers } = await import('./projects')
const { registerTasksHandlers } = await import('./tasks')
const { registerCommentsHandlers } = await import('./comments')
type Ctx = import('../../transport/types').RequestContext
type Handler = import('../../transport/types').HandlerFn
type Deps = import('../handler-deps').HandlerDeps
type Hit = { kind: string; id: string; title: string | null; snippet?: string; entity?: string }

const handlers = new Map<string, Handler>()
const server = {
  handle: (channel: string, handler: Handler) => void handlers.set(channel, handler),
  push() {},
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
const search = async (as: Ctx, query: unknown) => (await callAs(as, C.search.RUN, query)) as Hit[]

/** Writes a chat of `owner` with one user message through the real persistence queue. */
async function writeChat(workspace: string, id: string, owner: string, title: string, text: string) {
  const queue = new ChatPersistenceQueue({ db: () => initDb() })
  const chat = { id, workspaceId: workspace, workspaceRootPath: configDir, createdBy: `user:${owner}`, createdAt: 1, lastUsedAt: 1, name: title }
  queue.enqueue(id, () => ({ chat, sessionDir: join(configDir, id), messages: [{ id: `${id}-m1`, type: 'user', timestamp: 1000, content: text }] }) as never)
  await queue.flush(id)
}

beforeAll(async () => {
  await pushSchema(initDb())
  initMessages(initDb())
  saveConfig({ workspaces: [] })
  workspaceId = addWorkspace({ name: 'Test', rootPath: join(configDir, 'workspace') }).id
  otherId = addWorkspace({ name: 'Other', rootPath: join(configDir, 'other') }).id
  createWorkspaceMember(workspaceId, A, 'owner')
  createWorkspaceMember(workspaceId, B, 'member')
  createWorkspaceMember(otherId, A, 'owner')
  ctxA = { clientId: 'a', userId: A, workspaceId, webContentsId: null }
  ctxB = { clientId: 'b', userId: B, workspaceId, webContentsId: null }
  ctxOther = { clientId: 'o', userId: A, workspaceId: otherId, webContentsId: null }
  registerProjectsHandlers(server as never, deps)
  registerTasksHandlers(server as never, deps)
  registerCommentsHandlers(server as never, deps)
  registerSearchHandlers(server as never, deps)
})
afterAll(() => rmSync(configDir, { recursive: true, force: true }))

describe('search:run', () => {
  it('registers the channel it declares', () => {
    for (const channel of HANDLED_CHANNELS) expect(handlers.has(channel)).toBe(true)
  })

  it('merges every kind, by kind, with snippets where the title is not what matched', async () => {
    const project = await callAs(ctxA, C.projects.CREATE, { title: 'Zebra launch', description: 'plan' })
    const task = await callAs(ctxA, C.tasks.CREATE, { projectId: project.id, title: 'Paint', description: 'stripes for the zebra crossing' })
    const comment = await callAs(ctxB, C.comments.CREATE, `task:${task.id}`, 'Is the zebra paint dry?')
    await createLibraryFolder({ workspaceId, title: 'Zebra assets', createdBy: `user:${A}` })
    await writeChat(workspaceId, 'chat-a1', A, 'Savannah', 'Where do zebras sleep at night?')

    const hits = await search(ctxA, '  Zebra ')
    expect(hits.map((hit) => hit.kind)).toEqual(['chat', 'task', 'project', 'library', 'comment'])
    expect(hits[0]).toMatchObject({ id: 'chat-a1', title: 'Savannah' })
    expect(hits[0]!.snippet).toContain('zebras sleep')
    expect(hits[1]).toMatchObject({ id: task.id, title: 'Paint', snippet: 'stripes for the zebra crossing' })
    expect(hits[2]).toMatchObject({ id: project.id, title: 'Zebra launch' })
    expect(hits[2]!.snippet).toBeUndefined() // the title shows the match
    expect(hits[4]).toMatchObject({ id: comment.id, entity: `task:${task.id}`, title: 'Paint', snippet: 'Is the zebra paint dry?' })

    // the comment follows the task out of the results
    await callAs(ctxA, C.tasks.SET_STATUS, task.id, 'archived')
    expect((await search(ctxA, 'zebra')).map((hit) => hit.kind)).toEqual(['chat', 'project', 'library'])
  })

  it('never shows a user another user\'s chats, and still shows them the workspace', async () => {
    await writeChat(workspaceId, 'chat-b1', B, 'Secret plans', 'the heist needle is at midnight')
    await writeChat(workspaceId, 'chat-a2', A, 'Mine', 'my needle')
    await callAs(ctxA, C.projects.CREATE, { title: 'Needle project' })
    expect((await search(ctxA, 'needle')).filter((hit) => hit.kind === 'chat').map((hit) => hit.id)).toEqual(['chat-a2'])
    expect((await search(ctxB, 'needle')).filter((hit) => hit.kind === 'chat').map((hit) => hit.id)).toEqual(['chat-b1'])
    expect((await search(ctxB, 'needle')).filter((hit) => hit.kind === 'project')).toHaveLength(1)
    expect(JSON.stringify(await search(ctxA, 'heist'))).not.toContain('chat-b1')
  })

  it('stays in the connection\'s workspace', async () => {
    await callAs(ctxA, C.projects.CREATE, { title: 'Quokka project' })
    await writeChat(otherId, 'chat-o1', A, 'Elsewhere', 'quokka island')
    expect((await search(ctxA, 'quokka')).map((hit) => hit.kind)).toEqual(['project'])
    expect((await search(ctxOther, 'quokka')).map((hit) => hit.id)).toEqual(['chat-o1'])
  })

  it('answers nothing to a blank or odd query', async () => {
    for (const query of ['', '   ', '%', '"', 42, null, undefined]) expect(await search(ctxA, query)).toEqual([])
  })
})
