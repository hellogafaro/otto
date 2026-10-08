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
import { createManagedSession } from './session-manager.ts'
import { loadSession } from '@otto/shared/sessions'
import { storedToMessage } from '@otto/core/types'
import { assertOwnsSession } from './private-chats.ts'

process.env.OTTO_MASTRA_CHAT = '1'
const ana = 'anaaaaaaaaaa'
const ben = 'benbbbbbbbbb'
const requests: { key: string | null; body: any }[] = []
const approvals: { sessionId: string; requestId: string }[] = []
let nextCall: (() => { name: string; args: object } | null)[] = []
let decline = false
const manager = new SessionManager()
let failResponse = 0
let stopAfterWrite = false
const endpoint = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(request) {
  requests.push({ key: request.headers.get('authorization'), body: await request.json() })
  const call = nextCall.shift()?.()
  if (failResponse) {
    failResponse--
    return new Response(`data: ${JSON.stringify({ type: 'response.failed', sequence_number: 1, response: { error: { code: 'fixture_failure', message: 'Controlled failure after write' } } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
  }
  const item = call ? { type: 'function_call', id: 'fc', call_id: 'call-' + requests.length, name: call.name, arguments: JSON.stringify(call.args), status: 'completed' } : { type: 'message', id: 'msg' }
  const parts = [
    { type: 'response.created', response: { id: 'response-' + requests.length, created_at: 0, model: 'fixture' } },
    ...(call ? [{ type: 'response.output_item.added', output_index: 1, item: { type: 'message', id: 'commentary' } }, { type: 'response.output_text.delta', item_id: 'commentary', delta: 'I will do that scoped action.' }, { type: 'response.output_item.done', output_index: 1, item: { type: 'message', id: 'commentary' } }] : []),
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
    if (event?.type === 'tool_result' && stopAfterWrite) {
      stopAfterWrite = false
      void manager.cancelProcessing(event.sessionId)
    }
    if (event?.type !== 'permission_request') return
    expect(event.request.canRemember).toBe(false)
    expect(event.request.command).not.toBe('{}')
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
  await manager.flushSession(chat.id)
  const ordered = loadSession(workspace, chat.id)!.messages
  const commentary = ordered.findIndex((entry) => entry.type === 'assistant' && entry.isIntermediate === true)
  const firstTool = ordered.findIndex((entry) => entry.type === 'tool')
  const finalText = ordered.findLastIndex((entry) => entry.type === 'assistant' && !entry.isIntermediate)
  expect(commentary).toBeLessThan(firstTool)
  expect(firstTool).toBeLessThan(finalText)
  expect(ordered[finalText].content).toBe('Done with the scoped work.')
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
  nextCall = [
    () => ({ name: 'create_document', args: { title: 'Recovered brief.md', content: 'One persisted write' } }),
    () => { failResponse = 100; return null },
  ]
  await manager.sendMessage(chat.id, `agent:${scout.id} one write before failure`, undefined, undefined, { sender: `user:${ben}` })
  failResponse = 0
  await manager.flushSession(chat.id)
  const saved = loadSession(workspace, chat.id)!
  const recoveredDocument = getLibraryItems(workspace.id, { type: 'document' }).find((item) => item.title === 'Recovered brief.md')!
  expect(recoveredDocument).toBeDefined()
  expect(saved.messages.at(-1)?.type).toBe('error')
  const reconstructed = createManagedSession({ ...saved, messages: saved.messages.map(storedToMessage) }, workspace, {
    messagesLoaded: true, messages: saved.messages.map(storedToMessage), members: [{ actor: `user:${ana}`, readAt: null }, { actor: `user:${ben}`, readAt: null }, { actor: `agent:${scout.id}`, readAt: null }, { actor: `agent:${writer.id}`, readAt: null }],
  })
  reconstructed.messages.push({ id: 'resultonly01', role: 'tool', author: `agent:${scout.id}`, content: '', timestamp: Date.now(), toolName: 'create_document', toolUseId: 'noinput00001', toolStatus: 'completed', toolResult: JSON.stringify({ id: recoveredDocument.id }), isError: false })
  ;(manager as unknown as { sessions: Map<string, typeof reconstructed> }).sessions.set(chat.id, reconstructed)
  nextCall = [() => null]
  await manager.sendMessage(chat.id, `agent:${writer.id} use the existing result, do not create again`, undefined, undefined, { sender: `user:${ana}` })
  expect(JSON.stringify(requests.at(-1)!.body.input)).toContain(recoveredDocument.id)
  expect(JSON.stringify(requests.at(-1)!.body.input)).toContain('Recorded work outcome by Scout')
  expect(JSON.stringify(requests.at(-1)!.body.input)).toContain('Input: {}')
  expect(getLibraryItems(workspace.id, { type: 'document' }).filter((item) => item.title === 'Recovered brief.md')).toHaveLength(1)
  stopAfterWrite = true
  nextCall = [() => ({ name: 'create_document', args: { title: 'Stopped brief.md', content: 'Written before Stop' } }), () => null]
  await manager.sendMessage(chat.id, `agent:${writer.id} work then Stop`, undefined, undefined, { sender: `user:${ben}` })
  await manager.flushSession(chat.id)
  const stoppedDocument = getLibraryItems(workspace.id, { type: 'document' }).find((item) => item.title === 'Stopped brief.md')!
  expect(stoppedDocument).toBeDefined()
  nextCall = [() => null]
  await manager.sendMessage(chat.id, `agent:${scout.id} use the action completed before Stop`, undefined, undefined, { sender: `user:${ana}` })
  expect(JSON.stringify(requests.at(-1)!.body.input)).toContain(stoppedDocument.id)
  expect(getLibraryItems(workspace.id, { type: 'document' }).filter((item) => item.title === 'Stopped brief.md')).toHaveLength(1)
  reconstructed.permissionMode = 'safe'
  nextCall = [() => null]
  await manager.sendMessage(chat.id, `agent:${writer.id} read-only planning`, undefined, undefined, { sender: `user:${ben}` })
  expect(requests.at(-1)!.body.tools.map((tool: any) => tool.name)).toContain('read_document')
  expect(requests.at(-1)!.body.tools.map((tool: any) => tool.name)).not.toContain('create_document')
  expect(requests.at(-1)!.body.tools.map((tool: any) => tool.name)).not.toContain('update_task')
  expect(JSON.stringify(requests.at(-1)!.body)).toContain('Explore mode is read-only')
  expect(JSON.stringify(requests.at(-1)!.body)).not.toContain('your own Linux computer')
  nextCall = [() => ({ name: 'create_document', args: { title: 'Routine brief.md', content: 'Created by authorized routine' } }), () => null]
  const routine = await manager.executePromptAutomation({workspaceId:workspace.id,workspaceRootPath:workspace.rootPath,prompt:'Prepare routine brief',permissionMode:'allow-all',llmConnection:'same-name',model:'pi/fixture',createdBy:`user:${ana}`,agentId:scout.id,automationName:'Fixture routine',automationId:'routine-fixture'})
  expect(getLibraryItems(workspace.id,{type:'document'}).some((item)=>item.title==='Routine brief.md'&&item.createdBy===`agent:${scout.id}`)).toBe(true)
  expect(requests.at(-1)!.key).toBe('Bearer fixture-'+ana)
  expect((await manager.getSession(routine.sessionId)) as unknown).toMatchObject({triggeredBy:{automationName:'Fixture routine'}})
  const before = requests.length
  deleteWorkspaceMember(workspace.id, ana)
  await manager.sendMessage(chat.id, `agent:${writer.id} creator removed`, undefined, undefined, { sender: `user:${ben}` })
  expect(requests).toHaveLength(before)
}, 30000)
