import { afterAll, expect, it, mock } from 'bun:test'
import { createClient } from '@libsql/client'
import { join } from 'node:path'
import { createAgent } from '@otto/shared/agents'
import { createConnection, workspaceScope } from '@otto/shared/connections'
import { addWorkspace, saveConfig } from '@otto/shared/config'
import { CONFIG_DIR } from '@otto/shared/config/paths'
import { initDb } from '@otto/shared/db'
import { getProjects } from '@otto/shared/projects'
import { loadSession, sessionPersistenceQueue } from '@otto/shared/sessions'
import { getTasks } from '@otto/shared/tasks'
import { updateSetting, userEntity } from '@otto/shared/settings'
import { users } from '../../../shared/src/users/schema'
import { createWorkspaceMember } from '@otto/shared/workspaces'
import { SessionManager } from './session-manager'
import { initMastraHistory } from './mastra-history'
import { getChatMembers } from '../../../shared/src/sessions/members'

const manager = new SessionManager()
const failures: string[] = []
const stages = new Map<string, number>()
const dueAt = Date.parse('2026-10-09T00:00:00+02:00')
const physicalClient = createClient
let transactionHold: { opened: () => void; released: Promise<void> } | undefined
mock.module('@libsql/client', () => ({ createClient: (...args: Parameters<typeof createClient>) => new Proxy(physicalClient(...args), {
  get(target, property) {
    if (property === 'transaction') return async (...args: Parameters<typeof target.transaction>) => {
      const transaction = await target.transaction(...args)
      const hold = transactionHold
      if (!hold) return transaction
      transactionHold = undefined
      hold.opened()
      return new Proxy(transaction, { get(target, property) {
        if (property === 'execute') return async (...args: Parameters<typeof target.execute>) => {
          await hold.released
          return target.execute(...args)
        }
        const value = Reflect.get(target, property)
        return typeof value === 'function' ? value.bind(target) : value
      } })
    }
    const value = Reflect.get(target, property)
    return typeof value === 'function' ? value.bind(target) : value
  },
}) }))
let titleRequests = 0
let timezoneRequests = 0
const endpoint = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(request) {
  const body = await request.json() as { input?: unknown }
  const input = JSON.stringify(body.input)
  if (JSON.stringify(body).includes("initiating person's timezone is Europe/Madrid")) timezoneRequests++
  const job = input.match(/standalone-fixture-\d+/)?.[0]
  const title = input.includes('Reply with ONLY')
  if (title) titleRequests++
  const stage = job && !title ? stages.get(job) ?? 0 : 2
  if (job && !title) stages.set(job, stage + 1)
  const call = stage === 0
    ? { name: 'project_list', args: {} }
    : stage === 1 ? { name: 'create_task', args: { title: job, dueAt } } : undefined
  const item = call ? { type: 'function_call', id: 'fc', call_id: crypto.randomUUID(), name: call.name, arguments: JSON.stringify(call.args), status: 'completed' } : { type: 'message', id: 'msg' }
  return new Response(new ReadableStream({ async start(controller) {
    const emit = (event: unknown) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
    emit({ type: 'response.created', response: { id: 'fixture', created_at: 0, model: 'fixture' } })
    emit({ type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg' } })
    if (call) {
      for (let index = 0; index < 32; index++) {
        emit({ type: 'response.output_text.delta', item_id: 'msg', delta: 'Recording the requested future task. ' })
        await Bun.sleep(20)
      }
      emit({ type: 'response.output_item.added', output_index: 1, item })
      emit({ type: 'response.function_call_arguments.delta', item_id: 'fc', output_index: 1, delta: item.arguments })
      emit({ type: 'response.function_call_arguments.done', item_id: 'fc', output_index: 1, arguments: item.arguments })
      emit({ type: 'response.output_item.done', output_index: 1, item })
    } else {
      emit({ type: 'response.output_text.delta', item_id: 'msg', delta: title ? 'Future task' : 'The task was recorded, not executed.' })
    }
    emit({ type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } })
    controller.close()
  } }), { headers: { 'content-type': 'text/event-stream' } })
} })

afterAll(async () => {
  await manager.flushAllSessions()
  await manager.cleanup()
  await manager.closeNativeHistory()
  endpoint.stop(true)
})

it('records one standalone future task from a fresh streamed chat, persists its final response and automatic title, and reloads without any project', async () => {
  saveConfig({ workspaces: [] })
  const workspace = addWorkspace({ name: 'Standalone task', rootPath: join(CONFIG_DIR, 'standalone') })
  const human = crypto.randomUUID(), actor = `user:${human}`
  const now = new Date()
  initDb().insert(users).values({ id: human, name: 'Fixture', email: 'standalone@example.test', createdAt: now, updatedAt: now }).run()
  createWorkspaceMember(workspace.id, human, 'owner')
  updateSetting(userEntity(human), 'timezone', 'Europe/Madrid')
  const connection = createConnection({ scope: workspaceScope(workspace.id), slug: 'standalone', type: 'openai', authType: 'api_key', title: 'Fixture', baseUrl: endpoint.url.href + 'v1', defaultModel: 'fixture', models: ['fixture'] }, { apiKey: 'controlled-key' })
  const agent = createAgent({ workspaceId: workspace.id, title: 'Recorder', provider: 'openai', model: 'fixture', llmConnectionId: connection.id, createdBy: actor })
  manager.setEventSink((_channel, _target, event: any) => {
    if (event?.type === 'error') failures.push('native_error')
    if (event?.type === 'tool_result' && event.isError) failures.push('tool_error')
  })
  expect(getProjects(workspace.id)).toHaveLength(0)
  for (let index = 0; index < 3; index++) {
    const chat = await manager.createSession(workspace.id, { agentId: agent.id, llmConnection: connection.slug, llmConnectionId: connection.id, permissionMode: 'allow-all' }, { createdBy: actor })
    await manager.sendMessage(chat.id, `standalone-fixture-${index}: record the future task due tomorrow, do not execute it`, undefined, undefined, { sender: actor })
    await manager.flushAllSessions()
    for (let poll = 0; poll < 100 && !loadSession(workspace, chat.id)?.name; poll++) await Bun.sleep(20)
    await manager.flushAllSessions()
    const stored = loadSession(workspace, chat.id)!
    expect(stored.name).toBeTruthy()
    expect(stored.messages.some((message) => message.type === 'assistant' && message.content === 'The task was recorded, not executed.')).toBe(true)
    expect(stored.messages.filter((message) => message.type === 'tool' && message.toolName === 'create_task' && message.toolStatus === 'completed')).toHaveLength(1)
    expect(stored.messages.some((message) => (message as { partial?: boolean }).partial)).toBe(false)
    const rows = getTasks(workspace.id).filter((task) => task.title === `standalone-fixture-${index}`)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.projectId).toBeNull()
    expect(rows[0]!.dueAt).toBe(dueAt)
  }
  expect(failures).toEqual([])
  expect(getProjects(workspace.id)).toHaveLength(0)
  expect(getTasks(workspace.id)).toHaveLength(3)
  expect(titleRequests).toBeGreaterThan(0)
  expect(timezoneRequests).toBeGreaterThan(0)
  expect(sessionPersistenceQueue.pendingCount).toBe(0)
}, 30000)

it('admits a fresh task message while the official history adapter is replacing an earlier partial row', async () => {
  const workspace = addWorkspace({ name: 'Admission boundary', rootPath: join(CONFIG_DIR, 'admission') })
  const human = crypto.randomUUID(), actor = `user:${human}`
  const now = new Date()
  initDb().insert(users).values({ id: human, name: 'Fixture', email: 'admission@example.test', createdAt: now, updatedAt: now }).run()
  createWorkspaceMember(workspace.id, human, 'owner')
  const connection = createConnection({ scope: workspaceScope(workspace.id), slug: 'admission', type: 'openai', authType: 'api_key', title: 'Fixture', baseUrl: endpoint.url.href + 'v1', defaultModel: 'fixture', models: ['fixture'] }, { apiKey: 'controlled-key' })
  const agent = createAgent({ workspaceId: workspace.id, title: 'Recorder', provider: 'openai', model: 'fixture', llmConnectionId: connection.id, createdBy: actor })
  const chat = await manager.createSession(workspace.id, { agentId: agent.id, llmConnection: connection.slug, llmConnectionId: connection.id, permissionMode: 'allow-all' }, { createdBy: actor })
  await manager.flushAllSessions()
  const memory = (await (await initMastraHistory()).storage.getStore('memory'))!
  const threadId = crypto.randomUUID(), messageId = crypto.randomUUID()
  await memory.saveThread({ thread: { id: threadId, resourceId: workspace.id, title: 'Held partial', createdAt: now, updatedAt: now } })
  await memory.saveMessages({ messages: [{ id: messageId, threadId, resourceId: workspace.id, role: 'assistant', createdAt: now, content: { format: 2, parts: [{ type: 'text', text: 'Controlled partial' }] } }] })
  let release!: () => void, opened!: () => void
  const openedTransaction = new Promise<void>((resolve) => { opened = resolve })
  transactionHold = { opened, released: new Promise<void>((resolve) => { release = resolve }) }
  let replacing!: Promise<void>
  const internal = manager as any
  const ensureMessagesLoaded = internal.ensureMessagesLoaded
  internal.ensureMessagesLoaded = async (...args: unknown[]) => {
    await ensureMessagesLoaded.apply(manager, args)
    internal.ensureMessagesLoaded = ensureMessagesLoaded
    const snapshot = internal.chatWriteOf(internal.sessions.get(chat.id))
    sessionPersistenceQueue.enqueue(chat.id, () => ({ ...snapshot, writeNativeMessages: async (messages: any) => {
      await memory.deleteMessages([messageId])
      await snapshot.writeNativeMessages(messages)
    } }))
    replacing = sessionPersistenceQueue.flush(chat.id)
    await openedTransaction
    setTimeout(release, 20)
  }
  let failure: unknown
  try {
    await manager.sendMessage(chat.id, 'standalone-fixture-99: record a future task', undefined, undefined, { sender: actor })
  } catch (error) {
    failure = error
    const detail = error as { code?: string; stack?: string }
    console.error('Controlled admission failure', { code: detail.code, frames: detail.stack?.split('\n').filter((line) => /^\s*at /.test(line)) })
  } finally {
    release()
    internal.ensureMessagesLoaded = ensureMessagesLoaded
    await replacing
  }
  await manager.flushAllSessions()
  expect(failure).toBeUndefined()
  expect(getTasks(workspace.id)).toHaveLength(1)
  expect(getTasks(workspace.id)[0]!.projectId).toBeNull()
  expect(getChatMembers(workspace.id, chat.id).find((member) => member.actor === actor)!.readAt).not.toBeNull()
  await manager.markSessionUnread(chat.id, human)
  expect(getChatMembers(workspace.id, chat.id).find((member) => member.actor === actor)!.readAt).toBeNull()
  await manager.markSessionRead(chat.id, human)
  expect(getChatMembers(workspace.id, chat.id).find((member) => member.actor === actor)!.readAt).not.toBeNull()
}, 30000)
