import { beforeAll, expect, it } from 'bun:test'
import { basename, join } from 'node:path'
import { addWorkspace, saveConfig } from '@otto/shared/config'
import { CONFIG_DIR } from '@otto/shared/config/paths'
import { createAgent } from '@otto/shared/agents'
import { DB_PATH, initDb, openDb, type Db } from '@otto/shared/db'
import { createLibraryFolder, deleteLibraryItem } from '@otto/shared/library'
import { createProject, getProject, setProjectStatus } from '@otto/shared/projects'
import type { CreateSessionOptions, Session } from '@otto/shared/protocol'
import { getLinkedPageChatId } from '@otto/shared/sessions'
import { getChat, getChats } from '../../../shared/src/sessions/chats.ts'
import { addChatMembers, getChatMembers } from '../../../shared/src/sessions/members.ts'
import { createSession as createStoredSession, loadSession } from '../../../shared/src/sessions/storage.ts'
import { createTask, getTask, setTaskStatus, updateTask } from '@otto/shared/tasks'
import { createWorkspaceMember, deleteWorkspaceMember } from '@otto/shared/workspaces'
import { initLinkedPageChat } from './linked-page-chat'

type Record = Session & { contextEntity: string }
type Deps = Parameters<typeof initLinkedPageChat>[1]

beforeAll(() => {
  expect(basename(CONFIG_DIR)).toStartWith('otto-test-')
  saveConfig({ workspaces: [] })
})

function fixture() {
  const workspace = addWorkspace({ name: 'Linked page fixture', rootPath: join(CONFIG_DIR, crypto.randomUUID()) })
  const otherWorkspace = addWorkspace({ name: 'Foreign linked fixture', rootPath: join(CONFIG_DIR, crypto.randomUUID()) })
  const userId = crypto.randomUUID(), otherUser = crypto.randomUUID(), outsider = crypto.randomUUID(), agentId = crypto.randomUUID()
  createWorkspaceMember(workspace.id, userId, 'owner')
  createWorkspaceMember(workspace.id, otherUser, 'owner')
  createWorkspaceMember(otherWorkspace.id, outsider, 'owner')
  const project = createProject({ workspaceId: workspace.id, title: 'Project page', createdBy: `user:${userId}` })
  const task = createTask({ workspaceId: workspace.id, title: 'Unlinked task page', createdBy: `user:${userId}` })
  const library = createLibraryFolder({ workspaceId: workspace.id, title: 'Library page', createdBy: `user:${userId}` })
  const records = new Map<string, Record>()
  const audiences = new Map<string, Set<string>>()
  const creates: { workspaceId: string; options?: CreateSessionOptions; createdBy?: string | null; contextEntity?: string }[] = []
  const reads: { sessionId: string; userId?: string | null }[] = []
  let beforeCreate: (contextEntity?: string) => Promise<void> = async () => {}, beforeRead = async () => {}
  const sessions: Deps['sessions'] = {
    canSeeSession: (sessionId, viewer) => !!viewer && !!audiences.get(sessionId)?.has(viewer),
    createSession: async (workspaceId, options, internal) => {
      creates.push({ workspaceId, options, createdBy: internal?.createdBy, contextEntity: internal?.contextEntity })
      await beforeCreate(internal?.contextEntity)
      const session: Record = {
        id: crypto.randomUUID(), workspaceId, workspaceName: workspace.name, name: options?.name,
        contextEntity: internal?.contextEntity ?? '', agentId, lastMessageAt: Date.now(), messages: [],
        isProcessing: false, sessionStatus: 'todo', members: [internal?.createdBy ?? '', `agent:${agentId}`],
      }
      records.set(session.id, session)
      audiences.set(session.id, new Set([internal?.createdBy?.slice(5) ?? '']))
      return structuredClone(session)
    },
    getSession: async (sessionId, _page, viewer) => {
      reads.push({ sessionId, userId: viewer })
      await beforeRead()
      const value = records.get(sessionId)
      return value && sessions.canSeeSession(sessionId, viewer ?? null) ? structuredClone(value) : null
    },
  }
  const findLinkedSessionId: Deps['findLinkedSessionId'] = (workspaceId, entity) => [...records.values()].find((item) => item.workspaceId === workspaceId && item.contextEntity === entity)?.id
  const deps: Deps = { sessions, findLinkedSessionId }
  const input = (contextEntity = `task:${task.id}`, viewer = userId) => ({ workspaceId: workspace.id, userId: viewer, contextEntity })
  return { workspace, otherWorkspace, userId, otherUser, outsider, agentId, project, task, library, records, audiences, creates, reads, sessions, deps, input,
    onCreate: (callback: (contextEntity?: string) => Promise<void>) => { beforeCreate = callback }, onRead: (callback: () => Promise<void>) => { beforeRead = callback } }
}

function storedFixture(f: ReturnType<typeof fixture>, readDb: Db = initDb()) {
  const createdIds: string[] = []
  const agent = createAgent({ workspaceId: f.workspace.id, title: 'Stored chat default', provider: 'openai', createdBy: `user:${f.userId}` })
  const read = (sessionId: string): Session | null => {
    const stored = getChat(f.workspace.id, f.workspace.rootPath, sessionId, readDb)
    return stored ? { ...stored, workspaceId: f.workspace.id, workspaceName: f.workspace.name, lastMessageAt: stored.lastMessageAt ?? stored.createdAt, messages: [], isProcessing: false, members: getChatMembers(f.workspace.id, sessionId, readDb).map((member) => member.actor) } : null
  }
  const sessions: Deps['sessions'] = {
    createSession: async (workspaceId, options, internal) => {
      expect(workspaceId).toBe(f.workspace.id)
      expect(Object.keys(options!)).toEqual(['name'])
      const stored = createStoredSession(f.workspace, { name: options?.name, createdBy: internal?.createdBy ?? undefined, contextEntity: internal?.contextEntity, agentId: agent.id })
      createdIds.push(stored.id)
      return read(stored.id)!
    },
    canSeeSession: (sessionId, viewer) => !!viewer && getChatMembers(f.workspace.id, sessionId, readDb).some((member) => member.actor === `user:${viewer}`),
    getSession: async (sessionId, _page, viewer) => sessions.canSeeSession(sessionId, viewer ?? null) ? read(sessionId) : null,
  }
  return { createdIds, agent, deps: { sessions, findLinkedSessionId: (workspaceId: string, entity: string) => getLinkedPageChatId(workspaceId, entity, readDb) } satisfies Deps }
}

it('uses one canonical chat per project/task/Library page and reuses the identity with fresh dependencies', async () => {
  const f = fixture()
  for (const contextEntity of [`project:${f.project.id}`, `task:${f.task.id}`, `library:${f.library.id}`]) {
    const created = await initLinkedPageChat(f.input(contextEntity), f.deps)
    const reused = await initLinkedPageChat(f.input(contextEntity), { ...f.deps, sessions: { ...f.sessions } })
    expect(reused).toEqual(created)
    expect(created).toMatchObject({ workspaceId: f.workspace.id, contextEntity, agentId: f.agentId, isProcessing: false })
  }
  expect(f.creates).toHaveLength(3)
  expect(f.creates.map((call) => call.options?.name)).toEqual([f.project.title, f.task.title, f.library.title])
  for (const call of f.creates) {
    expect(call.createdBy).toBe(`user:${f.userId}`)
    expect(Object.keys(call.options!)).toEqual(['name'])
    expect(call.contextEntity).toMatch(/^(?:project|task|library):/)
  }
  expect(getTask(f.workspace.id, f.task.id)).toEqual(f.task)
  expect(getProject(f.workspace.id, f.project.id)).toEqual(f.project)
  expect(f.reads.every((call) => call.userId === f.userId)).toBe(true)
})

it('serializes only a same-workspace/entity bootstrap and creates once under concurrent calls', async () => {
  const f = fixture()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  f.onCreate(() => gate)
  const first = initLinkedPageChat(f.input(), f.deps)
  await Bun.sleep(5)
  const repeated = Array.from({ length: 12 }, () => initLinkedPageChat(f.input(), f.deps))
  await Bun.sleep(5)
  expect(f.creates).toHaveLength(1)
  release()
  const results = await Promise.all([first, ...repeated])
  expect(new Set(results.map((item) => item.id)).size).toBe(1)
  expect(f.creates).toHaveLength(1)
  expect(f.reads).toHaveLength(13)
})

it('does not serialize different entities or workspaces', async () => {
  const f = fixture(), other = fixture()
  let release!: () => void
  f.onCreate((contextEntity) => contextEntity === `task:${f.task.id}` ? new Promise<void>((resolve) => { release = resolve }) : Promise.resolve())
  const pending = initLinkedPageChat(f.input(), f.deps)
  await Bun.sleep(5)
  const different = await initLinkedPageChat(f.input(`project:${f.project.id}`), f.deps)
  expect(different.workspaceId).toBe(f.workspace.id)
  const separate = await initLinkedPageChat(other.input(), other.deps)
  expect(separate.workspaceId).toBe(other.workspace.id)
  release()
  await pending
})

it('refuses an inaccessible canonical chat without metadata reads, duplication, or adding a person', async () => {
  const f = fixture()
  const created = await initLinkedPageChat(f.input(), f.deps)
  const readCount = f.reads.length
  const members = [...created.members!]
  await expect(initLinkedPageChat(f.input(undefined, f.otherUser), f.deps)).rejects.toThrow('Linked page conversation is unavailable')
  expect(f.creates).toHaveLength(1)
  expect(f.reads).toHaveLength(readCount)
  expect(f.records.get(created.id)?.members).toEqual(members)
  expect(f.audiences.get(created.id)?.has(f.otherUser)).toBe(false)
  f.audiences.get(created.id)!.add(f.otherUser)
  expect((await initLinkedPageChat(f.input(undefined, f.otherUser), f.deps)).id).toBe(created.id)
  expect(f.creates).toHaveLength(1)
})

it('rechecks the waiting caller separately rather than returning another person’s private result', async () => {
  const f = fixture()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  f.onCreate(() => gate)
  const first = initLinkedPageChat(f.input(), f.deps)
  await Bun.sleep(5)
  const second = initLinkedPageChat(f.input(undefined, f.otherUser), f.deps)
  const refusal = second.then(() => { throw new Error('A private chat was returned') }, (error: Error) => error)
  release()
  await first
  expect((await refusal).message).toBe('Linked page conversation is unavailable')
  expect(f.creates).toHaveLength(1)
  expect(f.reads).toHaveLength(1)
})

it('requires the actual workspace member and an existing non-deleted scoped domain entity', async () => {
  const f = fixture()
  const foreign = createProject({ workspaceId: f.otherWorkspace.id, title: 'Private foreign page', createdBy: `user:${f.outsider}` })
  for (const input of [f.input(`project:${foreign.id}`), f.input('comment:aaaaaaaaaaaa'), f.input(`task:${crypto.randomUUID()}`), f.input(`task:${f.task.id}:extra`), f.input(undefined, f.outsider), { ...f.input(), userId: '' }, { ...f.input(), workspaceId: crypto.randomUUID() }]) {
    await expect(initLinkedPageChat(input, f.deps)).rejects.toThrow('Linked page conversation is unavailable')
  }
  setProjectStatus(f.workspace.id, f.project.id, 'deleted')
  setTaskStatus(f.workspace.id, f.task.id, 'deleted', `user:${f.userId}`)
  await deleteLibraryItem(f.workspace.id, f.library.id)
  for (const contextEntity of [`project:${f.project.id}`, `task:${f.task.id}`, `library:${f.library.id}`]) {
    await expect(initLinkedPageChat(f.input(contextEntity), f.deps)).rejects.toThrow('Linked page conversation is unavailable')
  }
  expect(f.creates).toHaveLength(0)
})

it('denies inaccessible linked resources before lookup or create', async () => {
  const f = fixture()
  const hidden = createProject({ workspaceId: f.workspace.id, title: 'Must not leak title', createdBy: `user:${f.userId}`, resources: [{ type: 'chat', title: 'Must not leak private chat', ref: crypto.randomUUID() }] })
  await expect(initLinkedPageChat(f.input(`project:${hidden.id}`), f.deps)).rejects.toThrow('Linked page conversation is unavailable')
  updateTask(f.workspace.id, f.task.id, { resources: [{ type: 'library', title: 'Missing scoped item', ref: crypto.randomUUID() }] }, `user:${f.userId}`)
  await expect(initLinkedPageChat(f.input(), f.deps)).rejects.toThrow('Linked page conversation is unavailable')
  expect(f.creates).toHaveLength(0)
  expect(f.reads).toHaveLength(0)
})

it('denies an accessible chat resource belonging to another workspace', async () => {
  const f = fixture()
  const foreign = createStoredSession(f.otherWorkspace, { createdBy: `user:${f.userId}` })
  f.audiences.set(foreign.id, new Set([f.userId]))
  updateTask(f.workspace.id, f.task.id, { resources: [{ type: 'chat', title: 'Foreign linked chat', ref: foreign.id }] }, `user:${f.userId}`)
  await expect(initLinkedPageChat(f.input(), f.deps)).rejects.toThrow('Linked page conversation is unavailable')
  expect(f.creates).toHaveLength(0)
  expect(f.reads).toHaveLength(0)
})

it('rechecks workspace, page, and chat access after asynchronous creation and reading', async () => {
  for (const revoke of ['workspace', 'page', 'chat'] as const) {
    const f = fixture()
    f.onRead(async () => {
      if (revoke === 'workspace') deleteWorkspaceMember(f.workspace.id, f.userId)
      if (revoke === 'page') setTaskStatus(f.workspace.id, f.task.id, 'deleted', `user:${f.userId}`)
      if (revoke === 'chat') f.audiences.clear()
    })
    await expect(initLinkedPageChat(f.input(), f.deps)).rejects.toThrow('Linked page conversation is unavailable')
    expect(f.creates).toHaveLength(1)
  }
})

it('never retargets an existing agent or running turn while resolving a page', async () => {
  const f = fixture()
  const created = await initLinkedPageChat(f.input(), f.deps)
  const active = f.records.get(created.id)!
  active.isProcessing = true
  active.currentAgentId = crypto.randomUUID()
  active.currentRunId = crypto.randomUUID()
  const before = structuredClone(active)
  expect(await initLinkedPageChat(f.input(), f.deps)).toEqual(before)
  expect(f.records.get(created.id)).toEqual(before)
  expect(getTask(f.workspace.id, f.task.id)).toEqual(f.task)
  expect(f.creates).toHaveLength(1)
})

it('releases a failed bootstrap and reuses a chat already persisted before an uncertain create reply', async () => {
  const f = fixture()
  let fail = true
  const createSession: Deps['sessions']['createSession'] = async (...args) => {
    const created = await f.sessions.createSession(...args)
    if (fail) { fail = false; throw new Error('Controlled uncertain reply') }
    return created
  }
  const deps = { ...f.deps, sessions: { ...f.sessions, createSession } }
  await expect(initLinkedPageChat(f.input(), deps)).rejects.toThrow('Controlled uncertain reply')
  const reused = await initLinkedPageChat(f.input(), deps)
  expect(f.creates).toHaveLength(1)
  expect(f.records.has(reused.id)).toBe(true)
})

it('rejects a missing persistence binding and never falls back to the private creation result', async () => {
  const f = fixture()
  await expect(initLinkedPageChat(f.input(), { ...f.deps, findLinkedSessionId: () => undefined })).rejects.toThrow('Linked page conversation is unavailable')
  expect(f.creates).toHaveLength(1)
  expect(f.reads).toHaveLength(0)
})

it('refuses a mismatched session projection instead of returning unrelated metadata', async () => {
  const f = fixture()
  await initLinkedPageChat(f.input(), f.deps)
  const deps: Deps = { ...f.deps, sessions: { ...f.sessions, getSession: async (...args) => {
    const session = await f.sessions.getSession(...args)
    return session ? { ...session, contextEntity: `project:${f.project.id}` } : null
  } } }
  await expect(initLinkedPageChat(f.input(), deps)).rejects.toThrow('Linked page conversation is unavailable')
  expect(f.creates).toHaveLength(1)
})

it('persists the canonical page context in real chat storage, lists it in Chats, and reuses it after a physical database reopen', async () => {
  const f = fixture()
  const physical = storedFixture(f)
  const before = getTask(f.workspace.id, f.task.id)
  const created = await initLinkedPageChat(f.input(), physical.deps)
  expect(created.contextEntity).toBe(`task:${f.task.id}`)
  expect(loadSession(f.workspace, created.id)?.contextEntity).toBe(`task:${f.task.id}`)
  expect(getChats(f.workspace.id, f.workspace.rootPath, { actor: `user:${f.userId}` }).map((item) => item.id)).toContain(created.id)
  const reopened = openDb(DB_PATH)
  try {
    const cold = storedFixture(f, reopened)
    const reused = await initLinkedPageChat(f.input(), cold.deps)
    expect(reused.id).toBe(created.id)
    expect(reused.agentId).toBe(physical.agent.id)
    expect(cold.createdIds).toEqual([])
    expect(loadSession(f.workspace, created.id, reopened)?.contextEntity).toBe(`task:${f.task.id}`)
    expect(getTask(f.workspace.id, f.task.id)).toEqual(before)
    expect(physical.createdIds).toEqual([created.id])
  } finally {
    (reopened as unknown as { $client: { close(): void } }).$client.close()
  }
})

it('concurrent stored bootstrap creates once and refuses another workspace owner until explicit chat membership exists', async () => {
  const f = fixture()
  const physical = storedFixture(f)
  const resolved = await Promise.all(Array.from({ length: 8 }, () => initLinkedPageChat(f.input(), physical.deps)))
  const created = resolved[0]!
  expect(new Set(resolved.map((item) => item.id)).size).toBe(1)
  expect(physical.createdIds).toEqual([created.id])
  const members = getChatMembers(f.workspace.id, created.id)
  expect(members.map((member) => member.actor)).toEqual([`user:${f.userId}`, `agent:${physical.agent.id}`])
  await expect(initLinkedPageChat(f.input(undefined, f.otherUser), physical.deps)).rejects.toThrow('Linked page conversation is unavailable')
  expect(physical.createdIds).toEqual([created.id])
  expect(getChatMembers(f.workspace.id, created.id)).toEqual(members)
  expect(getChats(f.workspace.id, f.workspace.rootPath, { actor: `user:${f.otherUser}` })).toEqual([])
  addChatMembers(f.workspace.id, created.id, [`user:${f.otherUser}`])
  expect((await initLinkedPageChat(f.input(undefined, f.otherUser), physical.deps)).id).toBe(created.id)
  expect(physical.createdIds).toEqual([created.id])
  expect(getTask(f.workspace.id, f.task.id)).toEqual(f.task)
})
