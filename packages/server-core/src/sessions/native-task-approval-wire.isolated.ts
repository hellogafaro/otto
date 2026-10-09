import { afterAll, expect, it } from 'bun:test'
import { join } from 'node:path'
import { createAgent } from '@otto/shared/agents'
import { createConnection, workspaceScope } from '@otto/shared/connections'
import { addWorkspace, saveConfig } from '@otto/shared/config'
import { CONFIG_DIR } from '@otto/shared/config/paths'
import { initDb } from '@otto/shared/db'
import { loadSession } from '@otto/shared/sessions'
import { getTasks, getTask } from '@otto/shared/tasks'
import { createProject } from '@otto/shared/projects'
import { createLibraryFolder, getLibraryItem, getLibraryItems } from '@otto/shared/library'
import { users } from '../../../shared/src/users/schema'
import { createWorkspaceMember } from '@otto/shared/workspaces'
import { SessionManager } from './session-manager'

const manager = new SessionManager()
let calls = 0
let actions: { name: string; args: Record<string, unknown> }[] = [{ name: 'create_task', args: { title: 'Disposable QA task', projectId: null, description: null, documentId: null, dueAt: null } }]
let wireShape: { strict?: boolean; required: string[]; nullable: string[] } | undefined
const shapes = new Map<string, { strict?: boolean; required: string[] }>()
let failProvider = false
const endpoint = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(request) {
  const body = await request.json() as { tools?: { name?: string; strict?: boolean; parameters?: { required?: string[]; properties?: Record<string, { type?: string | string[]; anyOf?: { type?: string }[] }> } }[] }
  if (failProvider) { failProvider = false; return Response.json({ error: { message: 'fixture-sensitive-provider-data', type: 'invalid_request_error' } }, { status: 400 }) }
  const advertised = body.tools?.find((tool) => tool.name === 'create_task')
  for (const tool of body.tools ?? []) if (tool.name) shapes.set(tool.name, { strict: tool.strict, required: tool.parameters?.required ?? [] })
  if (advertised) wireShape = { strict: advertised.strict, required: advertised.parameters?.required ?? [], nullable: Object.entries(advertised.parameters?.properties ?? {}).filter(([, field]) => Array.isArray(field.type) && field.type.includes('null') || field.anyOf?.some((choice) => choice.type === 'null')).map(([name]) => name) }
  const tool = actions[calls++]
  const item = tool ? { type: 'function_call', id: 'fc', call_id: crypto.randomUUID(), name: tool.name, arguments: JSON.stringify(tool.args), status: 'completed' } : { type: 'message', id: 'msg' }
  const events = [{ type: 'response.created', response: { id: 'fixture', created_at: 0, model: 'fixture' } }, { type: 'response.output_item.added', output_index: 0, item }, ...(tool ? [{ type: 'response.function_call_arguments.delta', item_id: 'fc', output_index: 0, delta: JSON.stringify(tool.args) }, { type: 'response.function_call_arguments.done', item_id: 'fc', output_index: 0, arguments: JSON.stringify(tool.args) }, { type: 'response.output_item.done', output_index: 0, item }] : [{ type: 'response.output_text.delta', item_id: 'msg', delta: 'Recorded.' }]), { type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }]
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
} })
afterAll(async () => { await manager.cleanup(); await manager.closeNativeHistory(); endpoint.stop(true) })

it('approves one plain standalone task when a strict provider supplies null for absent optional fields', async () => {
  saveConfig({ workspaces: [] })
  const workspace = addWorkspace({ name: 'Task wire fixture', rootPath: join(CONFIG_DIR, 'task-wire') })
  const human = crypto.randomUUID(), actor = `user:${human}`, now = new Date()
  initDb().insert(users).values({ id: human, name: 'Fixture', email: 'fixture@example.test', createdAt: now, updatedAt: now }).run()
  createWorkspaceMember(workspace.id, human, 'owner')
  const connection = createConnection({ scope: workspaceScope(workspace.id), slug: 'fixture', type: 'openai', authType: 'api_key', title: 'Fixture', baseUrl: endpoint.url.href + 'v1', defaultModel: 'fixture', models: ['fixture'] }, { apiKey: 'controlled-fixture-key' })
  const agent = createAgent({ workspaceId: workspace.id, title: 'Recorder', provider: 'openai', model: 'fixture', llmConnectionId: connection.id, createdBy: actor })
  const chat = await manager.createSession(workspace.id, { name: 'Plain task', agentId: agent.id, llmConnectionId: connection.id, permissionMode: 'ask' }, { createdBy: actor })
  const failures: string[] = []
  let approved: Promise<boolean> | undefined
  manager.setEventSink((_channel, _target, event: any) => {
    if (event?.type === 'error') failures.push(event.error)
    if (event?.type === 'permission_request') approved = manager.respondToPermission(chat.id, event.request.requestId, true, false, undefined, human)
  })
  await manager.sendMessage(chat.id, 'Help me create a task. Details: testing otto qa', undefined, undefined, { sender: actor })
  await manager.flushSession(chat.id)
  expect(wireShape?.required).toContain('description')
  expect(wireShape?.strict).toBe(false)
  expect(wireShape?.nullable).toContain('description')
  expect(wireShape?.nullable).toContain('documentId')
  expect(failures).toEqual([])
  expect(await approved).toBe(true)
  const tasks = getTasks(workspace.id)
  expect(tasks).toHaveLength(1)
  expect(tasks[0]!.projectId).toBeNull()
  const row = loadSession(workspace, chat.id)!.messages.find((message) => message.toolName === 'create_task')!
  expect(row.nativeAction?.status).toBe('approved')
  expect(row.toolStatus).toBe('completed')
  expect(row.toolInput).toEqual({})
  actions = []
  calls = 0
  await manager.sendMessage(chat.id, 'Read-only follow-up; do not repeat completed work.', undefined, undefined, { sender: actor })
  await manager.flushSession(chat.id)
  const reloaded = loadSession(workspace, chat.id)!
  expect(getTasks(workspace.id).map((task) => task.id)).toEqual([tasks[0]!.id])
  expect(reloaded.messages.filter((message) => message.toolName === 'create_task' && message.toolStatus === 'completed')).toHaveLength(1)
  expect(reloaded.messages.find((message) => message.toolName === 'create_task')!.nativeAction?.payloadHash).toBe(row.nativeAction!.payloadHash)
  const run = async (script: typeof actions) => {
    actions = script
    calls = 0
    await manager.sendMessage(chat.id, 'Run the disposable contract fixture.', undefined, undefined, { sender: actor })
    await manager.flushSession(chat.id)
  }
  const discover = (name: string) => ({ name: 'search_tools', args: { query: name } })
  const beforeNegative = getTasks(workspace.id).length
  for (const args of [{ title: null }, { title: 'Invalid', description: 42 }, { title: 'Invalid', documentId: '/private/path' }, { title: 'Invalid', unexpectedField: null }]) {
    await run([{ name: 'create_task', args }])
    expect(getTasks(workspace.id)).toHaveLength(beforeNegative)
    expect(loadSession(workspace, chat.id)!.messages.findLast((message) => message.toolName === 'create_task')!.toolStatus).toBe('error')
  }
  expect(failures.every((message) => !/attachments|local sources/i.test(message))).toBe(true)
  await run([discover('task_create'), { name: 'task_create', args: { title: 'Canonical task', projectId: null, description: null, dueAt: null, resources: null } }])
  expect(getTasks(workspace.id)).toHaveLength(beforeNegative + 1)
  expect(shapes.get('task_create')?.required).toContain('title')
  const task = getTasks(workspace.id).find((task) => task.title === 'Canonical task')!
  const project = createProject({ workspaceId: workspace.id, title: 'Existing project', createdBy: actor })
  const { updateTask } = await import('@otto/shared/tasks')
  updateTask(workspace.id, task.id, { projectId: project.id, expectedUpdatedAt: task.updatedAt }, actor)
  await run([discover('task_update'), { name: 'task_update', args: { id: task.id, title: 'Renamed only', expectedUpdatedAt: getTask(workspace.id, task.id)!.updatedAt } }])
  expect(getTask(workspace.id, task.id)!.projectId).toBe(project.id)
  expect(shapes.get('task_update')?.strict).toBe(false)
  expect(shapes.get('task_update')?.required).not.toContain('projectId')
  await run([discover('task_update'), { name: 'task_update', args: { id: task.id, projectId: null, expectedUpdatedAt: getTask(workspace.id, task.id)!.updatedAt } }])
  expect(getTask(workspace.id, task.id)!.projectId).toBeNull()
  await run([discover('library_create_folder'), { name: 'library_create_folder', args: { title: 'Root folder', parentId: null } }])
  const folderResult = loadSession(workspace, chat.id)!.messages.findLast((message) => message.toolName === 'library_create_folder')!
  expect(folderResult.toolStatus).toBe('completed')
  expect(shapes.get('library_create_folder')?.required).toContain('title')
  const parent = createLibraryFolder({ workspaceId: workspace.id, title: 'Parent', createdBy: actor })
  const child = createLibraryFolder({ workspaceId: workspace.id, title: 'Child', parentId: parent.id, createdBy: actor })
  await run([discover('library_update_item'), { name: 'library_update_item', args: { id: child.id, title: 'Renamed child', expectedUpdatedAt: child.updatedAt } }])
  expect(getLibraryItem(workspace.id, child.id)!.parentId).toBe(parent.id)
  await run([discover('library_update_item'), { name: 'library_update_item', args: { id: child.id, parentId: null, expectedUpdatedAt: getLibraryItem(workspace.id, child.id)!.updatedAt } }])
  expect(getLibraryItem(workspace.id, child.id)!.parentId).toBeNull()
  expect(shapes.get('library_update_item')?.strict).toBe(false)
  const nested = createLibraryFolder({ workspaceId: workspace.id, title: 'Nested child', parentId: parent.id, createdBy: actor })
  await run([{ name: 'library_list', args: { parentId: null } }])
  const rootPage = JSON.parse(loadSession(workspace, chat.id)!.messages.findLast((message) => message.toolName === 'library_list')!.toolResult!)
  expect(rootPage.total).toBe(getLibraryItems(workspace.id, { parentId: null }).length)
  expect(rootPage.items.map((item: { id: string }) => item.id)).toContain(parent.id)
  expect(rootPage.items.map((item: { id: string }) => item.id)).not.toContain(nested.id)
  expect(shapes.get('library_list')?.strict).toBe(false)
  expect(shapes.get('library_list')?.required).not.toContain('parentId')
  await run([{ name: 'library_list', args: {} }])
  const allPage = JSON.parse(loadSession(workspace, chat.id)!.messages.findLast((message) => message.toolName === 'library_list')!.toolResult!)
  expect(allPage.items.map((item: { id: string }) => item.id)).toContain(nested.id)
  const beforeProviderFailure = getTasks(workspace.id).length
  failProvider = true
  await run([])
  expect(getTasks(workspace.id)).toHaveLength(beforeProviderFailure)
  expect(failures.at(-1)).toContain('connection and model')
  expect(failures.join('\n')).not.toContain('fixture-sensitive-provider-data')
})
