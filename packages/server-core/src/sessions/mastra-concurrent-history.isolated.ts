import { afterAll, expect, it } from 'bun:test'
import { join } from 'node:path'
import { addWorkspace, saveConfig } from '@otto/shared/config'
import { CONFIG_DIR } from '@otto/shared/config/paths'
import { createAgent } from '@otto/shared/agents'
import { createConnection, userScope } from '@otto/shared/connections'
import { createWorkspaceMember } from '@otto/shared/workspaces'
import { DB_PATH, initDb } from '@otto/shared/db'
import { getLibraryItems } from '@otto/shared/library'
import { loadSession, sessionPersistenceQueue } from '@otto/shared/sessions'
import { users } from '../../../shared/src/users/schema'
import { SessionManager } from './session-manager'
import { ChatPersistenceQueue } from '../../../shared/src/sessions/persistence-queue'
import { initMastraHistory } from './mastra-history'

const issued = new Set<string>()
const failures: string[] = []
const manager = new SessionManager()
const endpoint = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(request) {
  const body = await request.json() as { input?: unknown; tools?: unknown }
  const input = JSON.stringify(body.input)
  const job = input.match(/fixture-write-\d+/)?.[0]
  const selected = job && body.tools && !issued.has(job) && !input.includes('Reply with ONLY')
  if (selected) issued.add(job)
  const tool = { type: 'function_call', id: 'fc', call_id: crypto.randomUUID(), name: 'create_document', arguments: JSON.stringify({ title: job, content: '# One effect\n' + job }), status: 'completed' }
  return new Response(new ReadableStream({ async start(controller) {
    const emit = (event: unknown) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
    emit({ type: 'response.created', response: { id: 'fixture', created_at: 0, model: 'fixture' } })
    emit({ type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg' } })
    if (selected) {
      for (let index = 0; index < 32; index++) { emit({ type: 'response.output_text.delta', item_id: 'msg', delta: 'Progress ' }); await Bun.sleep(20) }
      emit({ type: 'response.output_item.added', output_index: 1, item: tool })
      emit({ type: 'response.function_call_arguments.delta', item_id: 'fc', output_index: 1, delta: tool.arguments })
      emit({ type: 'response.function_call_arguments.done', item_id: 'fc', output_index: 1, arguments: tool.arguments })
      emit({ type: 'response.output_item.done', output_index: 1, item: tool })
    } else emit({ type: 'response.output_text.delta', item_id: 'msg', delta: input.includes('Reply with ONLY') ? 'Concurrent chat' : 'Committed once.' })
    emit({ type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } })
    controller.close()
  } }), { headers: { 'content-type': 'text/event-stream' } })
} })
afterAll(async () => { await manager.flushAllSessions(); manager.cleanup(); await manager.closeNativeHistory(); endpoint.stop(true) })

it('streams concurrent chats with native partial replacement and domain effects on one physical database without dropped rows or lock errors', async () => {
  expect(DB_PATH.startsWith(CONFIG_DIR)).toBe(true)
  expect(DB_PATH.endsWith('/otto.db')).toBe(true)
  saveConfig({ workspaces: [] })
  const workspace = addWorkspace({ name: 'Concurrent history', rootPath: join(CONFIG_DIR, 'concurrent-history') })
  const human = 'anaaaaaaaaaa', actor = `user:${human}`
  const now = new Date()
  initDb().insert(users).values({ id: human, name: 'Ana', email: 'ana@example.test', createdAt: now, updatedAt: now }).run()
  createWorkspaceMember(workspace.id, human, 'owner')
  const agent = createAgent({ workspaceId: workspace.id, title: 'Writer', provider: 'openai', model: 'fixture', createdBy: actor })
  createConnection({ scope: userScope(human), slug: 'concurrent', type: 'openai', authType: 'api_key', title: 'Fixture', baseUrl: endpoint.url.href + 'v1', defaultModel: 'fixture', models: ['fixture'] }, { apiKey: 'controlled-key' })
  const chats = await Promise.all([0, 1, 2].map((index) => manager.createSession(workspace.id, { name: `Chat ${index}`, agentId: agent.id, llmConnection: 'concurrent', permissionMode: 'allow-all' }, { createdBy: actor })))
  manager.setEventSink((_channel, _target, event: any) => {
    if (event?.type === 'error') failures.push('native_error')
    if (event?.type === 'tool_result' && event.isError) failures.push('tool_error')
  })
  for (let round = 0; round < 3; round++) {
    await Promise.all(chats.map(async (chat, index) => {
      await Bun.sleep(index * 9)
      await manager.sendMessage(chat.id, `fixture-write-${round * 3 + index}`, undefined, undefined, { sender: actor })
    }))
    await manager.flushAllSessions()
  }
  expect(failures).toEqual([])
  expect(issued.size).toBe(9)
  expect(getLibraryItems(workspace.id, { type: 'document' })).toHaveLength(9)
  for (const chat of chats) {
    const stored = loadSession(workspace, chat.id)!
    expect(stored.messages.filter((message) => message.type === 'user')).toHaveLength(3)
    expect(stored.messages.filter((message) => message.type === 'tool' && message.toolName === 'create_document' && message.toolStatus === 'completed')).toHaveLength(3)
    expect(stored.messages.some((message) => message.type === 'assistant' && message.content === 'Committed once.')).toBe(true)
    expect(stored.messages.some((message) => (message as { partial?: boolean }).partial)).toBe(false)
  }
  expect(sessionPersistenceQueue.pendingCount).toBe(0)
  const memory = (await (await initMastraHistory()).storage.getStore('memory'))!
  await memory.saveThread({ thread: { id: 'held-write', resourceId: workspace.id, title: 'Fixture', createdAt: new Date(), updatedAt: new Date() } })
  await memory.saveMessages({ messages: [{ id: 'held-message', threadId: 'held-write', resourceId: workspace.id, role: 'user', createdAt: new Date(), content: { format: 2, parts: [{ type: 'text', text: 'Fixture' }] } }] })
  const queue = new ChatPersistenceQueue()
  const snapshot = (index: number) => (manager as any).chatWriteOf((manager as any).sessions.get(chats[index]!.id))
  let competing!: Promise<string>
  queue.enqueue(chats[0]!.id, () => {
    const first = snapshot(0)
    return { ...first, writeNativeMessages: async (messages: any) => {
      const deleting = memory.deleteMessages(['held-message'])
      await Promise.resolve()
      await Promise.resolve()
      queue.enqueue(chats[1]!.id, () => ({ ...snapshot(1), messages: undefined, writeNativeMessages: undefined }))
      competing = queue.flush(chats[1]!.id).then(() => 'committed', (error) => error.code ?? 'storage_error')
      await deleting
      await first.writeNativeMessages(messages)
    } }
  })
  await queue.flush(chats[0]!.id)
  const outcome = await competing
  queue.cancel(chats[0]!.id)
  queue.cancel(chats[1]!.id)
  expect(outcome).toBe('committed')
  expect(initDb().$client.query('SELECT COUNT(*) AS count FROM mastra_messages WHERE id=?').get('held-message')).toEqual({ count: 0 })
  expect(loadSession(workspace, chats[1]!.id)!.messages.filter((message) => message.type === 'tool' && message.toolStatus === 'completed')).toHaveLength(3)
}, 30000)
