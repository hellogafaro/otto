import { afterAll, expect, it } from 'bun:test'
import { join } from 'node:path'
import { createAgent } from '@otto/shared/agents'
import { createConnection, userScope } from '@otto/shared/connections'
import { addWorkspace, saveConfig } from '@otto/shared/config'
import { initDb } from '@otto/shared/db'
import { getLibraryItems, readLibraryText, createLibraryItem } from '@otto/shared/library'
import { createProject } from '@otto/shared/projects'
import { getTasks } from '@otto/shared/tasks'
import { getComments } from '@otto/shared/comments'
import { createWorkspaceMember, deleteWorkspaceMember } from '@otto/shared/workspaces'
import { users } from '../../../shared/src/users/schema.ts'
import { CONFIG_DIR } from '@otto/shared/config/paths'
import { SessionManager } from './session-manager.ts'
import { assertOwnsSession } from './private-chats.ts'

process.env.OTTO_MASTRA_CHAT = '1'
const ana = 'anaaaaaaaaaa'
const ben = 'benbbbbbbbbb'
const requests: { key: string | null; body: any }[] = []
const approvals: { sessionId: string; requestId: string }[] = []
let nextCall: (() => { name: string; args: object } | null)[] = []
let decline = false
const manager = new SessionManager()
const endpoint = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(request) {
  requests.push({ key: request.headers.get('authorization'), body: await request.json() })
  const call = nextCall.shift()?.()
  const item = call ? { type: 'function_call', id: 'fc', call_id: 'call-' + requests.length, name: call.name, arguments: JSON.stringify(call.args), status: 'completed' } : { type: 'message', id: 'msg' }
  const parts = [
    { type: 'response.created', response: { id: 'response-' + requests.length, created_at: 0, model: 'fixture' } },
    { type: 'response.output_item.added', output_index: 0, item },
    ...(call ? [{ type: 'response.function_call_arguments.delta', item_id: 'fc', output_index: 0, delta: JSON.stringify(call.args) }, { type: 'response.function_call_arguments.done', item_id: 'fc', output_index: 0, arguments: JSON.stringify(call.args) }, { type: 'response.output_item.done', output_index: 0, item }] : [{ type: 'response.output_text.delta', item_id: 'msg', delta: 'Done with the scoped work.' }]),
    { type: 'response.completed', response: { usage: { input_tokens: 12, output_tokens: 5, total_tokens: 17 } } },
  ]
  return new Response(parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
} })
afterAll(() => { manager.cleanup(); endpoint.stop(); delete process.env.OTTO_MASTRA_CHAT })

it('two humans and two named agents create and update a linked brief with scoped keys and authorized approvals', async () => {
  saveConfig({ workspaces: [] })
  const workspace = addWorkspace({ name: 'Shared work', rootPath: join(CONFIG_DIR, 'work') })
  const foreign = addWorkspace({ name: 'Private other', rootPath: join(CONFIG_DIR, 'other') })
  for (const [id, name] of [[ana, 'Ana'], [ben, 'Ben']]) {
    const now = new Date()
    initDb().insert(users).values({ id, name, email: name + '@example.test', createdAt: now, updatedAt: now }).run()
    createWorkspaceMember(workspace.id, id, 'owner')
    createConnection({ scope: userScope(id), slug: 'same-name', type: 'openai', authType: 'api_key', title: name, baseUrl: endpoint.url.href + 'v1', defaultModel: 'pi/fixture', models: ['pi/fixture'] }, { apiKey: 'fixture-' + id })
  }
  const scout = createAgent({ workspaceId: workspace.id, title: 'Scout', provider: 'openai', model: 'pi/fixture', createdBy: `user:${ana}` })
  const writer = createAgent({ workspaceId: workspace.id, title: 'Writer', provider: 'openai', model: 'pi/fixture', createdBy: `user:${ben}` })
  const project = createProject({ workspaceId: workspace.id, title: 'Launch', createdBy: `user:${ana}` })
  const secretDoc = await createLibraryItem({ workspaceId: foreign.id, title: 'Private.md', mime: 'text/markdown', bytes: new TextEncoder().encode('foreign-private-content'), createdBy: `user:${ana}` })
  const chat = await manager.createSession(workspace.id, { agentId: scout.id, name: 'Brief', llmConnection: 'same-name', permissionMode: 'ask' }, { createdBy: `user:${ana}` })
  await manager.addSessionMembers(chat.id, ana, [`user:${ben}`, `agent:${writer.id}`])
  const otherChat = await manager.createSession(workspace.id, { agentId: writer.id, name: 'Ben private', llmConnection: 'same-name' }, { createdBy: `user:${ben}` })
  manager.setEventSink((_channel, _target, event: any) => {
    if (event?.type !== 'permission_request') return
    approvals.push({ sessionId: event.sessionId, requestId: event.request.requestId })
    expect(() => assertOwnsSession(manager, { userId: 'outsider0001' }, event.sessionId)).toThrow()
    expect(manager.respondToPermission(otherChat.id, event.request.requestId, true, false)).toBe(false)
    assertOwnsSession(manager, { userId: ben }, event.sessionId)
    expect(manager.respondToPermission(event.sessionId, event.request.requestId, !decline, false)).toBe(true)
  })
  const doc = () => getLibraryItems(workspace.id, { type: 'document' })[0]
  const task = () => getTasks(workspace.id)[0]
  nextCall = [
    () => ({ name: 'create_document', args: { title: 'Launch brief.md', content: '# Launch\nDraft by Scout' } }),
    () => ({ name: 'create_task', args: { projectId: project.id, title: 'Review launch brief', documentId: doc().id } }),
    () => null,
  ]
  await manager.sendMessage(chat.id, `agent:${scout.id} draft the brief and task`, undefined, undefined, { sender: `user:${ben}` })
  expect(requests.length).toBeGreaterThan(0)
  expect(approvals.length).toBeGreaterThan(0)
  expect(doc().createdBy).toBe(`agent:${scout.id}`)
  expect(task().createdBy).toBe(`agent:${scout.id}`)
  expect(task().resources).toEqual([{ type: 'library', title: doc().title, ref: doc().id }])
  nextCall = [
    () => ({ name: 'update_document', args: { id: doc().id, content: '# Launch\nReviewed by Writer', expectedUpdatedAt: doc().updatedAt } }),
    () => ({ name: 'update_task', args: { id: task().id, title: 'Reviewed launch brief', expectedUpdatedAt: task().updatedAt } }),
    () => null,
  ]
  await manager.sendMessage(chat.id, `agent:${writer.id} refine the brief`, undefined, undefined, { sender: `user:${ana}` })
  expect(await readLibraryText(workspace.id, doc().id)).toContain('Reviewed by Writer')
  expect(task().title).toBe('Reviewed launch brief')
  expect(getComments(workspace.id, `task:${task().id}`).items.some((entry) => entry.createdBy === `agent:${writer.id}` && entry.event?.kind === 'title')).toBe(true)
  expect(requests.every((request) => request.key === 'Bearer fixture-' + ana)).toBe(true)
  expect(approvals).toHaveLength(4)
  expect(requests.every((request) => !JSON.stringify(request.body).includes('foreign-private-content'))).toBe(true)
  expect(requests[0].body.tools.map((tool: any) => tool.name)).not.toContain('bash')
  const count = requests.length
  decline = true
  nextCall = [() => ({ name: 'create_document', args: { title: 'Declined.md', content: 'no' } }), () => null]
  await manager.sendMessage(chat.id, `agent:${writer.id} declined action`, undefined, undefined, { sender: `user:${ben}` })
  expect(getLibraryItems(workspace.id, { type: 'document' })).toHaveLength(1)
  decline = false
  nextCall = [() => ({ name: 'read_document', args: { id: secretDoc.id } }), () => null]
  await manager.sendMessage(chat.id, `agent:${writer.id} unavailable document`, undefined, undefined, { sender: `user:${ana}` })
  expect(JSON.stringify(requests.slice(count))).not.toContain('foreign-private-content')
  const before = requests.length
  deleteWorkspaceMember(workspace.id, ana)
  await manager.sendMessage(chat.id, `agent:${writer.id} creator removed`, undefined, undefined, { sender: `user:${ben}` })
  expect(requests).toHaveLength(before)
})
