import { afterAll, beforeAll, expect, it } from 'bun:test'
import { join } from 'node:path'
import { createAgent } from '@otto/shared/agents'
import { createConnection, userScope } from '@otto/shared/connections'
import { addWorkspace, saveConfig } from '@otto/shared/config'
import { initDb } from '@otto/shared/db'
import { getCredentialManager } from '@otto/shared/credentials'
import { loadSession } from '@otto/shared/sessions'
import { createWorkspaceMember } from '@otto/shared/workspaces'
import { users } from '../../../shared/src/users/schema.ts'
import { CONFIG_DIR } from '@otto/shared/config/paths'
import { storedToMessage } from '@otto/core/types'
import { SessionManager, createManagedSession } from './session-manager.ts'
import { assertOwnsSession } from './private-chats.ts'

process.env.OTTO_MASTRA_CHAT = '1'
const human = 'anaaaaaaaaaa'
const other = 'benbbbbbbbbb'
const actor = `user:${human}`
const requests: { authorization: string | null; body: Record<string, unknown> }[] = []
let endpoint: ReturnType<typeof Bun.serve>
let manager: SessionManager

beforeAll(() => {
  endpoint = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(request) {
    requests.push({ authorization: request.headers.get('authorization'), body: await request.json() as Record<string, unknown> })
    const parts = [
      { type: 'response.created', response: { id: 'response-fixture', created_at: 0, model: 'fixture' } },
      { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'message-fixture' } },
      { type: 'response.output_text.delta', item_id: 'message-fixture', delta: JSON.stringify(requests.at(-1)?.body.input).includes('Reply with ONLY') ? 'Launch Brief' : 'A brief for the launch.' },
      { type: 'response.completed', response: { usage: { input_tokens: 12, output_tokens: 5, total_tokens: 17 } } },
    ]
    return new Response(parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
  } })
  manager = new SessionManager()
})

afterAll(() => {
  manager.cleanup()
  endpoint.stop()
  delete process.env.OTTO_MASTRA_CHAT
})

it('uses the creator-scoped key, native Responses stream, existing events and restartable chat rows', async () => {
  for (const [id, name] of [[human, 'Ana'], [other, 'Ben']]) {
    const now = new Date()
    initDb().insert(users).values({ id, name, email: `${name}@example.test`, createdAt: now, updatedAt: now }).run()
  }
  saveConfig({ workspaces: [] })
  const workspace = addWorkspace({ name: 'Mastra fixture', rootPath: join(CONFIG_DIR, 'mastra-fixture') })
  createWorkspaceMember(workspace.id, human, 'owner')
  createWorkspaceMember(workspace.id, other, 'member')
  const agent = createAgent({ workspaceId: workspace.id, title: 'Scout', provider: 'openai', model: 'pi/fixture', createdBy: actor })
  for (const id of [human, other]) createConnection({
    scope: userScope(id), slug: 'same-name', type: 'openai', authType: 'api_key', title: 'Fixture endpoint',
    baseUrl: endpoint.url.href + 'v1', defaultModel: 'pi/fixture', models: ['pi/fixture'],
  }, { apiKey: id === human ? 'fixture-owner' : 'fixture-other' })
  const stored = await manager.createSession(workspace.id, { agentId: agent.id, name: 'Fixture chat', llmConnection: 'same-name' }, { createdBy: actor })
  expect(() => assertOwnsSession(manager, { userId: other }, stored.id)).toThrow('Session not found')
  await manager.addSessionMembers(stored.id, human, [`user:${other}`])
  assertOwnsSession(manager, { userId: other }, stored.id)
  const events: { type: string; [key: string]: unknown }[] = []
  manager.setEventSink((_channel, _target, event) => { if (event) events.push(event as typeof events[number]) })
  let persistedAtAck = false
  await manager.sendMessage(stored.id, `agent:${agent.id} Draft a launch brief.`, undefined, undefined, { sender: `user:${other}` }, undefined, undefined, (id) => {
    persistedAtAck = loadSession(workspace, stored.id)!.messages.some((message) => message.id === id)
  })
  expect(persistedAtAck).toBe(true)
  expect(requests).toHaveLength(1)
  expect(requests[0].authorization).toBe('Bearer fixture-owner')
  expect(requests[0].body).toMatchObject({ model: 'fixture', stream: true, store: false })
  expect(events.some((event) => event.type === 'text_delta')).toBe(true)
  expect(events.find((event) => event.type === 'text_complete')).toMatchObject({ text: 'A brief for the launch.', author: `agent:${agent.id}` })
  const persisted = loadSession(workspace, stored.id)!
  expect(persisted.messages.filter((message) => message.type === 'assistant').map((message) => message.content)).toEqual(['A brief for the launch.'])
  expect(manager.getSessions(workspace.id, 'unknownuser1')).toEqual([])
  manager.cleanup()
  manager = new SessionManager()
  const recovered = createManagedSession({ ...persisted, messages: persisted.messages.map(storedToMessage) }, workspace, { messagesLoaded: true, messages: persisted.messages.map(storedToMessage), members: [{ actor, readAt: null }, { actor: `agent:${agent.id}`, readAt: null }] })
  ;(manager as unknown as { sessions: Map<string, typeof recovered> }).sessions.set(stored.id, recovered)
  await manager.sendMessage(stored.id, 'Make it shorter.', undefined, undefined, { sender: actor })
  expect(requests).toHaveLength(2)
  expect(JSON.stringify(requests[1].body.input)).toContain('A brief for the launch.')
  expect(JSON.stringify(requests[1].body.input)).toContain('Make it shorter.')
  expect(await manager.refreshTitle(stored.id)).toMatchObject({success:true,title:'Launch Brief'})
  expect(requests).toHaveLength(3)
  const flushAdmission=manager.flushSession.bind(manager)
  const idleAdmission={followUp:async()=>{throw new Error('Old native session must not receive late admission')}} as never
  recovered.isProcessing=true;recovered.turnAgentId=agent.id;recovered.mastraSession=idleAdmission
  let admissionWaiting!:()=>void,releaseAdmission!:()=>void
  const admissionReady=new Promise<void>((resolve)=>{admissionWaiting=resolve})
  let delayOnce=true
  manager.flushSession=async(id)=>{
    if(delayOnce){delayOnce=false;admissionWaiting();await new Promise<void>((resolve)=>{releaseAdmission=resolve})}
    await flushAdmission(id)
  }
  const admitted=manager.sendMessage(stored.id,'Accepted while old run ends.',undefined,undefined,{sender:actor})
  await admissionReady
  recovered.isProcessing=false;recovered.mastraSession=undefined;recovered.processingGeneration++
  releaseAdmission();await admitted
  manager.flushSession=flushAdmission
  expect(requests).toHaveLength(4)
  expect(JSON.stringify(requests.at(-1)!.body.input)).toContain('Accepted while old run ends.')
  let stopWaiting!:()=>void,releaseStopped!:()=>void
  const stopReady=new Promise<void>((resolve)=>{stopWaiting=resolve})
  recovered.isProcessing=true;recovered.mastraSession=idleAdmission;delayOnce=true
  manager.flushSession=async(id)=>{
    if(delayOnce){delayOnce=false;stopWaiting();await new Promise<void>((resolve)=>{releaseStopped=resolve})}
    await flushAdmission(id)
  }
  const stoppedAdmission=manager.sendMessage(stored.id,'Never admit after Stop.',undefined,undefined,{sender:actor})
  await stopReady;await manager.cancelProcessing(stored.id);releaseStopped();await stoppedAdmission
  manager.flushSession=flushAdmission;recovered.isProcessing=false;recovered.mastraSession=undefined
  expect(requests).toHaveLength(4)
  const credentials = getCredentialManager()
  const getKey = credentials.getLlmApiKey.bind(credentials)
  credentials.getLlmApiKey = async (...args) => {
    await manager.cancelProcessing(stored.id)
    return getKey(...args)
  }
  await manager.sendMessage(stored.id, 'Stop before inference.', undefined, undefined, { sender: actor })
  credentials.getLlmApiKey = getKey
  expect(requests).toHaveLength(4)
  let release!: () => void
  let started!: () => void
  const preparing = new Promise<void>((resolve) => { started = resolve })
  credentials.getLlmApiKey = async () => {
    started()
    await new Promise<void>((resolve) => { release = resolve })
    throw new Error('Late abort failure')
  }
  const stale = manager.sendMessage(stored.id, 'Delayed old turn.', undefined, undefined, { sender: actor })
  await preparing
  recovered.mastraAbort?.abort()
  recovered.processingGeneration++
  const newerSession={respondToToolApproval:()=>({accepted:true})} as never
  const newerStop=()=>{}
  recovered.mastraSession=newerSession
  recovered.mastraStop=newerStop
  recovered.mastraApprovalId='new-approval'
  recovered.streamingTurnId = 'newerturn001'
  recovered.streamingText = 'New turn answer'
  recovered.isProcessing = true
  release()
  await stale
  credentials.getLlmApiKey = getKey
  expect(recovered.streamingTurnId).toBe('newerturn001')
  expect(recovered.streamingText).toBe('New turn answer')
  expect(recovered.isProcessing).toBe(true)
  expect(recovered.mastraSession).toBe(newerSession)
  expect(recovered.mastraStop).toBe(newerStop)
  expect(recovered.mastraApprovalId).toBe('new-approval')
  recovered.isProcessing = false
  recovered.streamingText = ''
  recovered.streamingTurnId = undefined
  recovered.members = recovered.members.filter((member) => member.actor !== actor)
  await manager.sendMessage(stored.id, `agent:${agent.id} blocked`, undefined, undefined, { sender: `user:${other}` })
  expect(requests).toHaveLength(4)
  recovered.members = [{ actor, readAt: null }, { actor: `agent:${agent.id}`, readAt: null }]
  let releaseDeleted!: () => void
  let deletionStarted!: () => void
  const deletionPreparing = new Promise<void>((resolve) => { deletionStarted = resolve })
  credentials.getLlmApiKey = async () => {
    deletionStarted()
    await new Promise<void>((resolve) => { releaseDeleted = resolve })
    throw new Error('Delayed deleted run')
  }
  const deletingRun = manager.sendMessage(stored.id, 'Delete while preparing.', undefined, undefined, { sender: actor })
  await deletionPreparing
  let releasePersistence!: () => void
  let persistenceStarted!: () => void
  const persistencePreparing = new Promise<void>((resolve) => { persistenceStarted = resolve })
  const flush = manager.flushSession.bind(manager)
  manager.flushSession = async (id) => {
    persistenceStarted()
    await new Promise<void>((resolve) => { releasePersistence = resolve })
    await flush(id)
  }
  const deleted = manager.deleteSession(stored.id, human)
  await persistencePreparing
  await expect(manager.sendMessage(stored.id, 'New send while deleting.', undefined, undefined, { sender: actor })).rejects.toThrow('not found')
  releasePersistence()
  releaseDeleted()
  await Promise.all([deleted, deletingRun])
  manager.flushSession = flush
  credentials.getLlmApiKey = getKey
  await manager.flushAllSessions()
  expect(initDb().$client.query('SELECT count(*) n FROM chats WHERE id=?').get(stored.id)).toEqual({n:0})
  expect(initDb().$client.query('SELECT count(*) n FROM mastra_threads WHERE id=?').get(stored.id)).toEqual({n:0})
  expect(initDb().$client.query('SELECT count(*) n FROM mastra_messages WHERE thread_id=?').get(stored.id)).toEqual({n:0})
})
