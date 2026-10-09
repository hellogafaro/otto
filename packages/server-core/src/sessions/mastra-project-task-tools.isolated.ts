import { beforeAll, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { createAgent, deleteAgent } from '@otto/shared/agents'
import { addWorkspace, saveConfig } from '@otto/shared/config'
import { CONFIG_DIR } from '@otto/shared/config/paths'
import { createComment, createEvent, getComments, getCommentsById, updateComment } from '@otto/shared/comments'
import { DB_PATH, initDb } from '@otto/shared/db'
import { createLibraryFolder } from '@otto/shared/library'
import { getNotifications } from '@otto/shared/notifications'
import { createProject, getProject, getProjects, updateProject } from '@otto/shared/projects'
import { projects } from '@otto/shared/projects/schema'
import { createTask, getTask, getTasks, getTimesheets, MAX_TIME, updateTask } from '@otto/shared/tasks'
import { tasks } from '@otto/shared/tasks/schema'
import { users } from '@otto/shared/users/schema'
import { createWorkspaceMember, deleteWorkspaceMember } from '@otto/shared/workspaces'
import { createMastraProjectTaskTools, PROJECT_TASK_DESTRUCTIVE_TOOL_NAMES, PROJECT_TASK_NOTIFICATION_TOOL_NAMES, PROJECT_TASK_WRITE_TOOL_NAMES } from './mastra-project-task-tools'

type Tools = ReturnType<typeof createMastraProjectTaskTools>
beforeAll(() => {
  expect(basename(CONFIG_DIR)).toStartWith('otto-test-')
  saveConfig({ workspaces: [] })
})

const call = async (tools: Tools, name: keyof Tools, input: unknown): Promise<any> => {
  const tool = tools[name]
  const parsed = (tool.inputSchema as z.ZodType).parse(input)
  return tool.execute!(parsed as never, {} as never)
}

function fixture() {
  expect(basename(CONFIG_DIR)).toStartWith('otto-test-')
  expect(DB_PATH).toBe(join(CONFIG_DIR, 'otto.db'))
  expect(existsSync(DB_PATH)).toBe(true)
  const workspace = addWorkspace({ name: 'Scoped work fixture', rootPath: join(CONFIG_DIR, crypto.randomUUID()) })
  const foreign = addWorkspace({ name: 'Foreign work fixture', rootPath: join(CONFIG_DIR, crypto.randomUUID()) })
  const ownerId = crypto.randomUUID(), memberId = crypto.randomUUID(), outsiderId = crypto.randomUUID()
  for (const userId of [ownerId, memberId, outsiderId]) {
    initDb().insert(users).values({ id: userId, name: 'Fixture person', email: `${userId}@example.test`, createdAt: new Date(), updatedAt: new Date() }).run()
  }
  createWorkspaceMember(workspace.id, ownerId, 'owner')
  createWorkspaceMember(workspace.id, memberId, 'member')
  createWorkspaceMember(foreign.id, outsiderId, 'owner')
  createAgent({ workspaceId: workspace.id, title: 'Protected default', provider: 'openai', createdBy: `user:${ownerId}` })
  const agent = createAgent({ workspaceId: workspace.id, title: 'Fixture agent', provider: 'openai', createdBy: `user:${ownerId}` })
  let userId: string = memberId
  let accessible = true
  const allowedChats = new Set<string>([crypto.randomUUID(), '261008-legacy-chat'])
  const chatChecks: string[] = []
  const humanChecks: string[] = []
  const scope = {
    workspaceId: workspace.id, agentId: agent.id,
    getUserId: () => { humanChecks.push(userId); return userId },
    assertAccess: () => { if (!accessible) throw new Error('Access removed') },
    assertChatAccess: (id: string) => { chatChecks.push(id); if (!allowedChats.has(id)) throw new Error('Chat not found') },
  }
  const tools = createMastraProjectTaskTools(scope)
  const project = createProject({ workspaceId: workspace.id, title: 'Fixture project', createdBy: `user:${ownerId}` })
  const task = createTask({ workspaceId: workspace.id, projectId: project.id, title: 'Fixture task', createdBy: `user:${ownerId}` })
  return { workspace, foreign, ownerId, memberId, outsiderId, agent, tools, scope, project, task, allowedChats, chatChecks, humanChecks,
    setUserId: (id: string) => { userId = id }, setAccess: (value: boolean) => { accessible = value } }
}

it('exposes distinct strict tool schemas and exhaustive write, destructive and notification policy sets', () => {
  const f = fixture()
  expect(Object.keys(f.tools)).toHaveLength(24)
  for (const name of ['prepare_project', 'create_project', 'create_task', 'update_task', 'list_work']) expect(f.tools).not.toHaveProperty(name)
  const reads = new Set(['project_list', 'project_get', 'task_list', 'task_get', 'comment_list', 'comment_get', 'timesheet_list'])
  for (const name of Object.keys(f.tools)) expect(PROJECT_TASK_WRITE_TOOL_NAMES.has(name)).toBe(!reads.has(name))
  for (const name of [...PROJECT_TASK_DESTRUCTIVE_TOOL_NAMES, ...PROJECT_TASK_NOTIFICATION_TOOL_NAMES]) expect(PROJECT_TASK_WRITE_TOOL_NAMES.has(name)).toBe(true)
  for (const name of ['project_set_status', 'project_delete', 'task_set_status', 'task_delete', 'comment_delete', 'timesheet_delete']) expect(PROJECT_TASK_DESTRUCTIVE_TOOL_NAMES.has(name)).toBe(true)
  for (const name of ['task_assign', 'comment_create', 'comment_update', 'comment_delete']) expect(PROJECT_TASK_NOTIFICATION_TOOL_NAMES.has(name)).toBe(true)
  for (const tool of Object.values(f.tools)) {
    expect((tool.inputSchema as z.ZodType).safeParse({ arbitraryPath: '/Users/jg', createdBy: `user:${f.ownerId}` }).success).toBe(false)
  }
  expect((f.tools.task_create.inputSchema as z.ZodType).safeParse({ projectId: f.project.id, title: 'Selected task', assignees: [`user:${f.ownerId}`] }).success).toBe(false)
  expect((f.tools.task_update.inputSchema as z.ZodType).safeParse({ id: f.task.id, expectedUpdatedAt: f.task.updatedAt, assignees: [] }).success).toBe(false)
  expect((f.tools.task_set_status.inputSchema as z.ZodType).safeParse({ id: f.task.id, expectedUpdatedAt: f.task.updatedAt, status: 'deleted' }).success).toBe(false)
  expect((f.tools.project_set_status.inputSchema as z.ZodType).safeParse({ id: f.project.id, expectedUpdatedAt: f.project.updatedAt, status: 'deleted' }).success).toBe(false)
})

it('manages project/task lifecycle with domain versions, explicit statuses and no automatic assignments', async () => {
  const f = fixture()
  const renamed = await call(f.tools, 'project_update', { id: f.project.id, title: 'Reviewed project', description: 'Reviewed scope', expectedUpdatedAt: f.project.updatedAt })
  expect(renamed.updatedAt).toBeGreaterThan(f.project.updatedAt)
  await expect(call(f.tools, 'project_update', { id: f.project.id, title: 'Stale overwrite', expectedUpdatedAt: f.project.updatedAt })).rejects.toThrow('changed')
  await expect(call(f.tools, 'project_set_status', { id: f.project.id, status: 'archived', expectedUpdatedAt: f.project.updatedAt })).rejects.toThrow('changed')
  const archived = await call(f.tools, 'project_set_status', { id: f.project.id, status: 'archived', expectedUpdatedAt: renamed.updatedAt })
  expect(await call(f.tools, 'project_list', {})).not.toContainEqual(archived)
  expect(await call(f.tools, 'project_list', { status: ['archived'] })).toContainEqual(archived)
  const restored = await call(f.tools, 'project_set_status', { id: f.project.id, status: 'active', expectedUpdatedAt: archived.updatedAt })
  const created = await call(f.tools, 'task_create', { projectId: f.project.id, title: ' Reviewed task ', description: 'Brief' })
  expect(created).toMatchObject({ title: 'Reviewed task', status: 'todo', assignees: [], dueAt: null, createdBy: `agent:${f.agent.id}` })
  expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  await call(f.tools, 'task_get', { id: created.id })
  await call(f.tools, 'task_list', { projectId: f.project.id })
  expect(getTask(f.workspace.id, created.id)).toEqual(created)
  const edited = await call(f.tools, 'task_update', { id: created.id, title: 'Explicit edit', expectedUpdatedAt: created.updatedAt })
  expect(getComments(f.workspace.id, `task:${created.id}`).items).toMatchObject([{ createdBy: `agent:${f.agent.id}`, event: { kind: 'title' } }])
  const due = await call(f.tools, 'task_set_due', { id: created.id, dueAt: 1_800_000_000_000, expectedUpdatedAt: edited.updatedAt })
  expect(getComments(f.workspace.id, `task:${created.id}`).items.at(-1)).toMatchObject({ createdBy: `agent:${f.agent.id}`, event: { kind: 'due' } })
  await expect(call(f.tools, 'task_set_due', { id: created.id, dueAt: null, expectedUpdatedAt: edited.updatedAt })).rejects.toThrow('changed')
  const cleared = await call(f.tools, 'task_set_due', { id: created.id, dueAt: null, expectedUpdatedAt: due.updatedAt })
  const done = await call(f.tools, 'task_set_status', { id: created.id, status: 'done', expectedUpdatedAt: cleared.updatedAt })
  await expect(call(f.tools, 'task_delete', { id: created.id, expectedUpdatedAt: cleared.updatedAt })).rejects.toThrow('changed')
  const deleted = await call(f.tools, 'task_delete', { id: created.id, expectedUpdatedAt: done.updatedAt })
  expect(getComments(f.workspace.id, `task:${created.id}`).items.at(-1)).toMatchObject({ createdBy: `agent:${f.agent.id}`, event: { kind: 'status', to: 'deleted' } })
  expect(await call(f.tools, 'task_list', { projectId: f.project.id })).not.toContainEqual(deleted)
  expect(await call(f.tools, 'task_list', { projectId: f.project.id, status: ['deleted'] })).toEqual([deleted])
  await expect(call(f.tools, 'task_update', { id: created.id, title: 'Cannot edit deleted', expectedUpdatedAt: deleted.updatedAt })).rejects.toThrow('deleted')
  await expect(call(f.tools, 'timesheet_create', { taskId: created.id, time: 1000 })).rejects.toThrow('does not exist')
  const taskRestored = await call(f.tools, 'task_set_status', { id: created.id, status: 'todo', expectedUpdatedAt: deleted.updatedAt })
  expect(taskRestored.status).toBe('todo')
  const projectDeleted = await call(f.tools, 'project_delete', { id: f.project.id, expectedUpdatedAt: restored.updatedAt })
  await expect(call(f.tools, 'task_create', { projectId: f.project.id, title: 'Deleted destination' })).rejects.toThrow('does not exist')
  expect(getTask(f.workspace.id, created.id)?.status).toBe('todo')
  expect((await call(f.tools, 'project_get', { id: f.project.id })).status).toBe('deleted')
  await call(f.tools, 'project_set_status', { id: f.project.id, status: 'active', expectedUpdatedAt: projectDeleted.updatedAt })
})

it('checks the live initiating human, workspace boundaries and existing actors before changes or notifications', async () => {
  const f = fixture()
  const foreignProject = createProject({ workspaceId: f.foreign.id, title: 'Foreign project', createdBy: `user:${f.outsiderId}` })
  const foreignTask = createTask({ workspaceId: f.foreign.id, projectId: foreignProject.id, title: 'Foreign task', createdBy: `user:${f.outsiderId}` })
  const foreignAgent = createAgent({ workspaceId: f.foreign.id, title: 'Foreign agent', provider: 'openai', createdBy: `user:${f.outsiderId}` })
  await expect(call(f.tools, 'project_get', { id: foreignProject.id })).rejects.toThrow('not found')
  await expect(call(f.tools, 'task_get', { id: foreignTask.id })).rejects.toThrow('not found')
  await expect(call(f.tools, 'project_delete', { id: foreignProject.id, expectedUpdatedAt: foreignProject.updatedAt })).rejects.toThrow('not found')
  await expect(call(f.tools, 'task_update', { id: f.task.id, projectId: foreignProject.id, expectedUpdatedAt: f.task.updatedAt })).rejects.toThrow('not found')
  for (const actor of [`user:${f.outsiderId}`, `agent:${foreignAgent.id}`, `agent:${crypto.randomUUID()}`]) {
    await expect(call(f.tools, 'task_assign', { id: f.task.id, assignees: [actor], expectedUpdatedAt: f.task.updatedAt })).rejects.toThrow('not in this workspace')
    await expect(call(f.tools, 'project_add_member', { id: f.project.id, actor, expectedUpdatedAt: f.project.updatedAt })).rejects.toThrow('not in this workspace')
  }
  expect(getTask(f.workspace.id, f.task.id)).toEqual(f.task)
  expect(getNotifications(f.outsiderId, f.workspace.id)).toEqual([])
  const assigned = await call(f.tools, 'task_assign', { id: f.task.id, assignees: [`user:${f.ownerId}`, `agent:${f.agent.id}`], expectedUpdatedAt: f.task.updatedAt })
  expect(getComments(f.workspace.id, `task:${f.task.id}`).items).toMatchObject([{ createdBy: `agent:${f.agent.id}`, event: { kind: 'assignees' } }])
  expect(getNotifications(f.ownerId, f.workspace.id)).toMatchObject([{ type: 'assigned', createdBy: `agent:${f.agent.id}`, entity: `task:${f.task.id}` }])
  await expect(call(f.tools, 'task_assign', { id: f.task.id, assignees: [`user:${f.memberId}`], expectedUpdatedAt: f.task.updatedAt })).rejects.toThrow('changed')
  expect(getNotifications(f.memberId, f.workspace.id)).toEqual([])
  expect(getTask(f.workspace.id, f.task.id)).toEqual(assigned)
  const added = await call(f.tools, 'project_add_member', { id: f.project.id, actor: `user:${f.memberId}`, expectedUpdatedAt: f.project.updatedAt })
  expect(added.members).toContain(`user:${f.memberId}`)
  const removed = await call(f.tools, 'project_remove_member', { id: f.project.id, actor: `user:${f.memberId}`, expectedUpdatedAt: added.updatedAt })
  expect(removed.members).not.toContain(`user:${f.memberId}`)
  f.setUserId(f.ownerId)
  const ownerCreated = await call(f.tools, 'task_create', { projectId: f.project.id, title: 'Exact live actor' })
  expect(ownerCreated.createdBy).toBe(`agent:${f.agent.id}`)
  expect(f.humanChecks.at(-1)).toBe(f.ownerId)
  f.setUserId(f.outsiderId)
  await expect(call(f.tools, 'task_create', { projectId: f.project.id, title: 'No owner fallback' })).rejects.toThrow('not a workspace member')
  f.setUserId('')
  await expect(call(f.tools, 'task_get', { id: f.task.id })).rejects.toThrow()
  f.setUserId(f.memberId)
  f.setAccess(false)
  await expect(call(f.tools, 'task_assign', { id: f.task.id, assignees: [], expectedUpdatedAt: assigned.updatedAt })).rejects.toThrow('Access removed')
  f.setAccess(true)
  deleteWorkspaceMember(f.workspace.id, f.memberId)
  await expect(call(f.tools, 'project_list', {})).rejects.toThrow('not a workspace member')
})

it('refuses a foreign, missing or removed named agent while preserving live-human authorization', async () => {
  const f = fixture()
  const foreignAgent = createAgent({ workspaceId: f.foreign.id, title: 'Foreign named agent', provider: 'openai', createdBy: `user:${f.outsiderId}` })
  for (const agentId of [foreignAgent.id, crypto.randomUUID()]) {
    const tools = createMastraProjectTaskTools({ ...f.scope, agentId })
    await expect(call(tools, 'task_get', { id: f.task.id })).rejects.toThrow('named agent is not in this workspace')
    await expect(call(tools, 'task_create', { projectId: f.project.id, title: 'Refused foreign scope' })).rejects.toThrow('named agent is not in this workspace')
    await expect(call(tools, 'timesheet_create', { taskId: f.task.id, time: 1000 })).rejects.toThrow('named agent is not in this workspace')
    await expect(call(tools, 'comment_create', { entity: `task:${f.task.id}`, content: 'Refused foreign scope' })).rejects.toThrow('named agent is not in this workspace')
  }
  createAgent({ workspaceId: f.workspace.id, title: 'Remaining workspace agent', provider: 'openai', createdBy: `user:${f.ownerId}` })
  deleteAgent(f.workspace.id, f.agent.id)
  await expect(call(f.tools, 'task_get', { id: f.task.id })).rejects.toThrow('named agent is not in this workspace')
  await expect(call(f.tools, 'task_assign', { id: f.task.id, assignees: [`user:${f.ownerId}`], expectedUpdatedAt: f.task.updatedAt })).rejects.toThrow('named agent is not in this workspace')
  expect(getTask(f.workspace.id, f.task.id)).toEqual(f.task)
  expect(getTimesheets(f.workspace.id, f.task.id)).toEqual([])
  expect(getComments(f.workspace.id, `task:${f.task.id}`).items).toEqual([])
  expect(getNotifications(f.ownerId, f.workspace.id)).toEqual([])
})

it('checks chat/library resource access on reads, writes and both representations of historical link events', async () => {
  const f = fixture()
  const localFolder = await createLibraryFolder({ workspaceId: f.workspace.id, title: 'Local resources', createdBy: `user:${f.ownerId}` })
  const foreignFolder = await createLibraryFolder({ workspaceId: f.foreign.id, title: 'Foreign resources', createdBy: `user:${f.outsiderId}` })
  const deniedChat = crypto.randomUUID()
  const validLinks = [
    { type: 'chat', title: 'Allowed legacy chat', ref: '261008-legacy-chat' },
    { type: 'library', title: 'Workspace folder', ref: localFolder.id },
    { type: 'url', title: 'Reviewed URL', ref: 'https://example.test/brief' },
  ]
  const linked = await call(f.tools, 'task_set_resources', { id: f.task.id, resources: validLinks, expectedUpdatedAt: f.task.updatedAt })
  expect(linked.resources).toEqual(validLinks)
  expect(getComments(f.workspace.id, `task:${f.task.id}`).items).toMatchObject([{ createdBy: `agent:${f.agent.id}`, event: { kind: 'links' } }])
  expect(f.chatChecks).toContain('261008-legacy-chat')
  const before = f.chatChecks.length
  expect((await call(f.tools, 'task_get', { id: f.task.id })).resources).toEqual(validLinks)
  expect(f.chatChecks.length).toBeGreaterThan(before)
  for (const resource of [
    { type: 'chat', title: 'Private chat metadata', ref: deniedChat },
    { type: 'library', title: 'Foreign library metadata', ref: foreignFolder.id },
  ]) {
    await expect(call(f.tools, 'task_set_resources', { id: f.task.id, resources: [resource], expectedUpdatedAt: linked.updatedAt })).rejects.toThrow()
    await expect(call(f.tools, 'project_update', { id: f.project.id, resources: [resource], expectedUpdatedAt: f.project.updatedAt })).rejects.toThrow()
    await expect(call(f.tools, 'task_create', { projectId: f.project.id, title: 'Refused resource', resources: [resource] })).rejects.toThrow()
  }
  expect(getTask(f.workspace.id, f.task.id)).toEqual(linked)
  for (const resource of [
    { type: 'url', title: 'File path', ref: 'file:///Users/jg/private' },
    { type: 'chat', title: 'Path traversal', ref: '../private' },
    { type: 'library', title: 'Unknown input', ref: localFolder.id, arbitrary: true },
  ]) await expect(call(f.tools, 'task_set_resources', { id: f.task.id, resources: [resource], expectedUpdatedAt: linked.updatedAt })).rejects.toThrow()
  await expect(call(f.tools, 'task_set_resources', { id: f.task.id, resources: [], expectedUpdatedAt: f.task.updatedAt })).rejects.toThrow('changed')
  const privateLink = { type: 'chat' as const, title: 'Private title must not escape', ref: deniedChat }
  const unsafeTask = createTask({ workspaceId: f.workspace.id, projectId: f.project.id, title: 'Pre-existing private link', resources: [privateLink], createdBy: `user:${f.ownerId}` })
  await expect(call(f.tools, 'task_get', { id: unsafeTask.id })).rejects.toThrow('Chat not found')
  await expect(call(f.tools, 'task_list', {})).rejects.toThrow('Chat not found')
  await expect(call(f.tools, 'task_update', { id: unsafeTask.id, title: 'Refused read/return', expectedUpdatedAt: unsafeTask.updatedAt })).rejects.toThrow('Chat not found')
  const unsafeProject = updateProject(f.workspace.id, f.project.id, { resources: [privateLink] })
  await expect(call(f.tools, 'project_get', { id: unsafeProject.id })).rejects.toThrow('Chat not found')
  await expect(call(f.tools, 'project_list', {})).rejects.toThrow('Chat not found')
  updateProject(f.workspace.id, f.project.id, { resources: [] })
  const historical = createEvent({ workspaceId: f.workspace.id, entity: `task:${f.task.id}`, createdBy: `user:${f.ownerId}`, event: { kind: 'links', added: [], removed: [privateLink] } })!
  await expect(call(f.tools, 'comment_get', { id: historical.id })).rejects.toThrow('Chat not found')
  await expect(call(f.tools, 'comment_list', { entity: `task:${f.task.id}` })).rejects.toThrow('Chat not found')
  const historicalAdded = createEvent({ workspaceId: f.workspace.id, entity: `project:${f.project.id}`, createdBy: `user:${f.ownerId}`, event: { kind: 'links', added: [privateLink], removed: [] } })!
  await expect(call(f.tools, 'comment_get', { id: historicalAdded.id })).rejects.toThrow('Chat not found')
  const foreignComment = createComment({ workspaceId: f.foreign.id, entity: `project:${unsafeProject.id}`, createdBy: `user:${f.outsiderId}`, content: 'Foreign comment' })
  await expect(call(f.tools, 'comment_get', { id: foreignComment.id })).rejects.toThrow('not found')
})

it('preserves comment author-only rules, expected versions, pagination and actual mention notifications', async () => {
  const f = fixture()
  const posted = await call(f.tools, 'comment_create', { entity: `task:${f.task.id}`, content: `Reviewed comment user:${f.ownerId}` })
  expect(posted.createdBy).toBe(`agent:${f.agent.id}`)
  expect(getNotifications(f.ownerId, f.workspace.id)).toMatchObject([{ type: 'mention', entity: `comment:${posted.id}`, createdBy: `agent:${f.agent.id}` }])
  const humanOwned = createComment({ workspaceId: f.workspace.id, entity: `project:${f.project.id}`, content: 'Human-authored reviewed comment', createdBy: `user:${f.memberId}` })
  f.setUserId(f.ownerId)
  await expect(call(f.tools, 'comment_update', { id: humanOwned.id, content: 'Not the author', expectedUpdatedAt: humanOwned.updatedAt })).rejects.toThrow('Only the author')
  await expect(call(f.tools, 'comment_delete', { id: humanOwned.id, expectedUpdatedAt: humanOwned.updatedAt })).rejects.toThrow('Only the author')
  f.setUserId(f.memberId)
  const humanEdited = await call(f.tools, 'comment_update', { id: humanOwned.id, content: 'Reviewed human-owned edit', expectedUpdatedAt: humanOwned.updatedAt })
  expect(humanEdited.createdBy).toBe(`user:${f.memberId}`)
  await call(f.tools, 'comment_delete', { id: humanOwned.id, expectedUpdatedAt: humanEdited.updatedAt })
  expect(getCommentsById(f.workspace.id, [humanOwned.id])).toEqual([])
  f.setUserId(f.ownerId)
  const edited = await call(f.tools, 'comment_update', { id: posted.id, content: 'Reviewed edit', expectedUpdatedAt: posted.updatedAt })
  expect(edited.createdBy).toBe(`agent:${f.agent.id}`)
  expect(f.humanChecks.at(-1)).toBe(f.ownerId)
  f.setUserId(f.memberId)
  await expect(call(f.tools, 'comment_update', { id: posted.id, content: 'Stale edit', expectedUpdatedAt: posted.updatedAt })).rejects.toThrow('changed')
  await expect(call(f.tools, 'comment_delete', { id: posted.id, expectedUpdatedAt: posted.updatedAt })).rejects.toThrow('changed')
  expect(getNotifications(f.ownerId, f.workspace.id)).toHaveLength(1)
  const second = await call(f.tools, 'comment_create', { entity: `task:${f.task.id}`, content: 'Second reviewed comment' })
  const newest = await call(f.tools, 'comment_list', { entity: `task:${f.task.id}`, limit: 1 })
  expect(newest).toMatchObject({ items: [second], more: true, earlier: 1 })
  expect(await call(f.tools, 'comment_list', { entity: `task:${f.task.id}`, before: second.id, limit: 1 })).toMatchObject({ items: [edited], more: false })
  const status = await call(f.tools, 'task_set_status', { id: f.task.id, status: 'doing', expectedUpdatedAt: f.task.updatedAt })
  const event = getComments(f.workspace.id, `task:${f.task.id}`).items.find((item) => item.type === 'event')!
  expect(event.createdBy).toBe(`agent:${f.agent.id}`)
  await expect(call(f.tools, 'comment_update', { id: event.id, content: 'Cannot edit activity', expectedUpdatedAt: event.updatedAt })).rejects.toThrow('Activity events')
  await expect(call(f.tools, 'comment_delete', { id: event.id, expectedUpdatedAt: event.updatedAt })).rejects.toThrow('Activity events')
  await expect(call(f.tools, 'comment_create', { entity: `task:${crypto.randomUUID()}`, content: 'Missing entity' })).rejects.toThrow('not found')
  await call(f.tools, 'comment_delete', { id: posted.id, expectedUpdatedAt: edited.updatedAt })
  expect(getCommentsById(f.workspace.id, [posted.id])).toEqual([])
  expect(getNotifications(f.ownerId, f.workspace.id)).toEqual([])
  expect(getTask(f.workspace.id, f.task.id)).toEqual(status)
  const otherAgent = createAgent({ workspaceId: f.workspace.id, title: 'Other author', provider: 'openai', createdBy: `user:${f.ownerId}` })
  const ownedByOtherAgent = createComment({ workspaceId: f.workspace.id, entity: `task:${f.task.id}`, createdBy: `agent:${otherAgent.id}`, content: 'Another agent’s old comment' })
  await expect(call(f.tools, 'comment_update', { id: ownedByOtherAgent.id, content: 'No author fallback', expectedUpdatedAt: ownedByOtherAgent.updatedAt })).rejects.toThrow('Only the author')
  await expect(call(f.tools, 'comment_delete', { id: ownedByOtherAgent.id, expectedUpdatedAt: ownedByOtherAgent.updatedAt })).rejects.toThrow('Only the author')
})

it('logs actual bounded immutable time as the named agent and confines deletion to the selected task', async () => {
  const f = fixture()
  const entry = await call(f.tools, 'timesheet_create', { taskId: f.task.id, time: 60_000, notes: 'Actual measured minute' })
  expect(entry).toMatchObject({ taskId: f.task.id, time: 60_000, createdBy: `agent:${f.agent.id}`, notes: 'Actual measured minute' })
  expect(await call(f.tools, 'timesheet_list', { taskId: f.task.id })).toEqual([entry])
  expect(getComments(f.workspace.id, `task:${f.task.id}`).items).toMatchObject([{ createdBy: `agent:${f.agent.id}`, event: { kind: 'time', time: 60_000 } }])
  for (const time of [0, -1, 1.5, MAX_TIME + 1]) await expect(call(f.tools, 'timesheet_create', { taskId: f.task.id, time })).rejects.toThrow()
  const otherTask = createTask({ workspaceId: f.workspace.id, projectId: f.project.id, title: 'Other task', createdBy: `user:${f.ownerId}` })
  await expect(call(f.tools, 'timesheet_delete', { id: entry.id, taskId: otherTask.id })).rejects.toThrow('not found on this task')
  await expect(call(f.tools, 'timesheet_list', { taskId: crypto.randomUUID() })).rejects.toThrow('not found')
  expect(getTimesheets(f.workspace.id, f.task.id)).toEqual([entry])
  f.setUserId(f.ownerId)
  const liveEntry = await call(f.tools, 'timesheet_create', { taskId: f.task.id, time: 1000 })
  expect(liveEntry.createdBy).toBe(`agent:${f.agent.id}`)
  expect(f.humanChecks.at(-1)).toBe(f.ownerId)
  await call(f.tools, 'timesheet_delete', { id: entry.id, taskId: f.task.id })
  expect(getTimesheets(f.workspace.id, f.task.id)).toEqual([liveEntry])
})

it('reads legacy stored IDs without allowing arbitrary identifiers or actor impersonation', async () => {
  const f = fixture()
  const legacyProjectId = 'legacyproj01', legacyTaskId = 'legacytask01'
  initDb().update(projects).set({ id: legacyProjectId }).where(eq(projects.id, f.project.id)).run()
  initDb().update(tasks).set({ id: legacyTaskId, projectId: legacyProjectId }).where(eq(tasks.id, f.task.id)).run()
  expect((await call(f.tools, 'project_get', { id: legacyProjectId })).title).toBe(f.project.title)
  expect((await call(f.tools, 'task_get', { id: legacyTaskId })).projectId).toBe(legacyProjectId)
  const live = updateTask(f.workspace.id, legacyTaskId, { title: 'External domain edit' }, `user:${f.ownerId}`)
  await expect(call(f.tools, 'task_update', { id: legacyTaskId, title: 'Stale legacy update', expectedUpdatedAt: f.task.updatedAt })).rejects.toThrow('changed')
  expect(getTask(f.workspace.id, legacyTaskId)).toEqual(live)
  for (const id of ['../../private', 'task:legacytask01', 'default', '12345678-1234-1234-8234-123456789012']) await expect(call(f.tools, 'task_get', { id })).rejects.toThrow()
  await expect(call(f.tools, 'task_create', { projectId: legacyProjectId, title: 'Spoofed creator', createdBy: `user:${f.ownerId}` })).rejects.toThrow()
  const ownComment = createComment({ workspaceId: f.workspace.id, entity: `task:${legacyTaskId}`, content: 'Domain-owned edit', createdBy: `user:${f.memberId}` })
  const externallyEdited = updateComment(f.workspace.id, ownComment.id, `user:${f.memberId}`, 'Externally edited', ownComment.updatedAt)
  await expect(call(f.tools, 'comment_update', { id: ownComment.id, content: 'Stale domain comment', expectedUpdatedAt: ownComment.updatedAt })).rejects.toThrow('changed')
  expect(getCommentsById(f.workspace.id, [ownComment.id])).toEqual([externallyEdited])
  expect(getProject(f.workspace.id, legacyProjectId)).toBeDefined()
})

it('creates tasks in a zero-project workspace through the native factory with strict optional-project schemas', async () => {
  const f = fixture()
  const workspace = addWorkspace({ name: 'Zero-project tasks', rootPath: join(CONFIG_DIR, crypto.randomUUID()) })
  createWorkspaceMember(workspace.id, f.memberId, 'owner')
  const agent = createAgent({ workspaceId: workspace.id, title: 'Workspace task agent', provider: 'openai', createdBy: `user:${f.memberId}` })
  const tools = createMastraProjectTaskTools({ ...f.scope, workspaceId: workspace.id, agentId: agent.id })
  expect(getProjects(workspace.id)).toEqual([])
  const createSchema = tools.task_create.inputSchema as z.ZodType
  const updateSchema = tools.task_update.inputSchema as z.ZodType
  expect(createSchema.safeParse({ title: 'No project needed' }).success).toBe(true)
  expect(createSchema.safeParse({ title: 'Explicitly unlinked', projectId: null }).success).toBe(true)
  expect(createSchema.safeParse({ title: 'No implicit default', projectId: 'default' }).success).toBe(false)
  expect(createSchema.safeParse({ title: 'No actor impersonation', createdBy: `user:${f.memberId}` }).success).toBe(false)
  const json = z.toJSONSchema(createSchema, { io: 'input' })
  expect(json.required).not.toContain('projectId')
  expect(json.additionalProperties).toBe(false)
  const created = await call(tools, 'task_create', { title: 'Unlinked native task' })
  const explicit = await call(tools, 'task_create', { title: 'Explicit native task', projectId: null })
  expect(created).toMatchObject({ projectId: null, status: 'todo', assignees: [], dueAt: null, createdBy: `agent:${agent.id}` })
  expect(explicit.projectId).toBeNull()
  expect(getProjects(workspace.id)).toEqual([])
  expect(await call(tools, 'task_get', { id: created.id })).toEqual(created)
  expect(await call(tools, 'task_list', {})).toContainEqual(created)
  expect(getTasks(workspace.id)).toContainEqual(created)
  expect(updateSchema.safeParse({ id: created.id, projectId: null, expectedUpdatedAt: created.updatedAt }).success).toBe(true)
  expect(updateSchema.safeParse({ id: created.id, projectId: null }).success).toBe(false)
  expect(updateSchema.safeParse({ id: created.id, expectedUpdatedAt: created.updatedAt }).success).toBe(false)
  await expect(call(tools, 'task_create', { title: 'Foreign link', projectId: f.project.id })).rejects.toThrow('Project not found')
  await expect(call(tools, 'task_update', { id: created.id, projectId: f.project.id, expectedUpdatedAt: created.updatedAt })).rejects.toThrow('Project not found')
  const project = createProject({ workspaceId: workspace.id, title: 'Explicit selection', createdBy: `user:${f.memberId}` })
  const linked = await call(tools, 'task_update', { id: created.id, projectId: project.id, expectedUpdatedAt: created.updatedAt })
  const edited = await call(tools, 'task_update', { id: created.id, title: 'Text only', expectedUpdatedAt: linked.updatedAt })
  expect(edited.projectId).toBe(project.id)
  await expect(call(tools, 'task_update', { id: created.id, projectId: null, expectedUpdatedAt: created.updatedAt })).rejects.toThrow('changed')
  const unlinked = await call(tools, 'task_update', { id: created.id, projectId: null, expectedUpdatedAt: edited.updatedAt })
  expect(unlinked.projectId).toBeNull()
  const inaccessible = createProject({ workspaceId: workspace.id, title: 'Inaccessible links', createdBy: `user:${f.memberId}`, resources: [{ type: 'chat', title: 'Private chat', ref: crypto.randomUUID() }] })
  await expect(call(tools, 'task_create', { title: 'Denied link', projectId: inaccessible.id })).rejects.toThrow('Chat not found')
  await expect(call(tools, 'task_update', { id: created.id, projectId: inaccessible.id, expectedUpdatedAt: unlinked.updatedAt })).rejects.toThrow('Chat not found')
  expect(getTask(workspace.id, created.id)).toEqual(unlinked)
  f.setAccess(false)
  await expect(call(tools, 'task_create', { title: 'Auth is mandatory' })).rejects.toThrow('Access removed')
  f.setAccess(true)
  f.setUserId(f.outsiderId)
  await expect(call(tools, 'task_create', { title: 'Workspace membership is mandatory' })).rejects.toThrow('not a workspace member')
})
