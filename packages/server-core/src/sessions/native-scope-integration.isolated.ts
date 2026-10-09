import { afterAll, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { createAgent } from '@otto/shared/agents'
import { createConnection, workspaceScope } from '@otto/shared/connections'
import { addWorkspace, saveConfig } from '@otto/shared/config'
import { CONFIG_DIR } from '@otto/shared/config/paths'
import { initDb } from '@otto/shared/db'
import { getLibraryItems } from '@otto/shared/library'
import { loadSession } from '@otto/shared/sessions'
import { getStatuses } from '@otto/shared/statuses'
import { getProjects } from '@otto/shared/projects'
import { updateSetting, userEntity } from '@otto/shared/settings'
import { createWorkspaceMember, deleteWorkspaceMember } from '@otto/shared/workspaces'
import { users } from '../../../shared/src/users/schema'
import { SessionManager } from './session-manager'
import type { Message } from '@otto/core/types'

const owner = 'anaaaaaaaaaa', member = 'benbbbbbbbbb'
const manager = new SessionManager()
let script: { name: string; args: Record<string, unknown> }[] = []
const wire: Record<string, any>[] = []
const keys: (string | null)[] = []
let hold: { ready: () => void; wait: Promise<void> } | undefined
const endpoint = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(request) {
  const body = await request.json() as Record<string, any>
  wire.push(body)
  keys.push(request.headers.get('authorization'))
  const action = script.shift()
  const held = hold
  hold = undefined
  if (held) { held.ready(); await held.wait }
  const item = action ? { type: 'function_call', id: crypto.randomUUID(), call_id: crypto.randomUUID(), name: action.name, arguments: JSON.stringify(action.args), status: 'completed' } : { type: 'message', id: crypto.randomUUID() }
  const events = [
    { type: 'response.created', response: { id: crypto.randomUUID(), created_at: 0, model: 'fixture' } },
    { type: 'response.output_item.added', output_index: 0, item },
    ...(action ? [{ type: 'response.function_call_arguments.delta', item_id: item.id, output_index: 0, delta: JSON.stringify(action.args) }, { type: 'response.function_call_arguments.done', item_id: item.id, output_index: 0, arguments: JSON.stringify(action.args) }, { type: 'response.output_item.done', output_index: 0, item }] : [{ type: 'response.output_text.delta', item_id: item.id, delta: 'Done.' }]),
    { type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
  ]
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
} })
afterAll(async () => { await manager.cleanup(); endpoint.stop(true) })

it('integrates native discovery, audience-safe chat reads, real-human approvals, stop and no effect replay', async () => {
  saveConfig({ workspaces: [] })
  const newMember = 'caracccccccc'
  for (const [id, name] of [[owner, 'Ana'], [member, 'Ben'], [newMember, 'Cara']]) {
    const now = new Date()
    initDb().insert(users).values({ id, name, email: `${id}@example.test`, createdAt: now, updatedAt: now }).run()
  }
  const workspace = addWorkspace({ name: 'Native integration', rootPath: join(CONFIG_DIR, 'native-integration') })
  createWorkspaceMember(workspace.id, owner, 'owner')
  createWorkspaceMember(workspace.id, member, 'member')
  createWorkspaceMember(workspace.id, newMember, 'member')
  const agent = createAgent({ workspaceId: workspace.id, title: 'Scout', provider: 'openai', model: 'fixture', createdBy: `user:${owner}` })
  const otherAgent = createAgent({ workspaceId: workspace.id, title: 'Writer', provider: 'openai', model: 'fixture', createdBy: `user:${owner}` })
  const connection = createConnection({ scope: workspaceScope(workspace.id), slug: 'shared', type: 'openai', authType: 'api_key', title: 'Fixture', baseUrl: endpoint.url.href + 'v1', defaultModel: 'fixture', models: ['fixture'] }, { apiKey: 'fixture-key' })
  const chat = await manager.createSession(workspace.id, { agentId: agent.id, name: 'Shared source', llmConnection: connection.slug, permissionMode: 'allow-all' }, { createdBy: `user:${owner}` })
  await manager.addSessionMembers(chat.id, owner, [`user:${member}`])
  const shared = await manager.createSession(workspace.id, { agentId: agent.id, name: 'Visible target', llmConnection: connection.slug }, { createdBy: `user:${owner}` })
  await manager.addSessionMembers(shared.id, owner, [`user:${member}`])
  const privateChat = await manager.createSession(workspace.id, { agentId: agent.id, name: 'Secret target', llmConnection: connection.slug }, { createdBy: `user:${owner}` })
  const otherAgentChat = await manager.createSession(workspace.id, { agentId: otherAgent.id, name: 'Other agent', llmConnection: connection.slug }, { createdBy: `user:${owner}` })
  await manager.addSessionMembers(otherAgentChat.id, owner, [`user:${member}`])
  await manager.sendMessage(shared.id, 'visible-needle', undefined, undefined, { sender: `user:${owner}`, recipientAgentId: null })
  await manager.sendMessage(privateChat.id, 'private-needle', undefined, undefined, { sender: `user:${owner}`, recipientAgentId: null })
  const sharedState = await manager.getSession(shared.id)
  sharedState!.messages.push({ id: crypto.randomUUID(), role: 'user', content: 'visible-needle hidden-payload', timestamp: Date.now(), hidden: true, sender: `user:${owner}` }, { id: crypto.randomUUID(), role: 'tool', content: 'visible-needle tool-payload', timestamp: Date.now(), toolName: 'fixture_private_tool', toolStatus: 'completed', toolResult: 'private tool data' })
  await manager.setSessionLabels(shared.id, [])
  createConnection({ scope: `user:${owner}`, slug: connection.slug, type: 'openai', authType: 'api_key', title: 'Owner-only shadow', baseUrl: endpoint.url.href + 'v1', defaultModel: 'fixture', models: ['fixture'] }, { apiKey: 'fixture-private-owner-key' })
  const events: any[] = []
  let resolution: ((event: any) => void) | undefined
  let questionResponse: ((event: any) => void) | undefined
  let completed: (() => void) | undefined
  manager.setEventSink((_channel, _target, event: any) => { if (event) { events.push(event); if (event.type === 'complete') completed?.(); if (event.type === 'permission_request') resolution?.(event); if (event.type === 'message_updated' && event.message.nativeAction?.kind === 'question' && event.message.nativeAction.status === 'pending') questionResponse?.(event) } })
  const run = async (actions: typeof script) => {
    script = [...actions]
    const start = wire.length
    await manager.sendMessage(chat.id, 'Execute the fixture action.', undefined, undefined, { sender: `user:${member}`, recipientAgentId: agent.id })
    await manager.flushSession(chat.id)
    return wire.slice(start)
  }
  const discover = (name: string) => ({ name: 'search_tools', args: { query: name } })
  const listCalls = await run([discover('chat_list'), { name: 'chat_list', args: {} }])
  expect(events.filter((event) => event.type === 'error')).toEqual([])
  expect(listCalls[0].tools.some((tool: any) => tool.name === 'search_tools')).toBe(true)
  expect(listCalls[0].tools.some((tool: any) => tool.name === 'chat_list')).toBe(false)
  expect(listCalls[1].tools.some((tool: any) => tool.name === 'chat_list')).toBe(true)
  const result = (name: string) => loadSession(workspace, chat.id)!.messages.findLast((message) => message.toolName === name)!
  const listed = JSON.parse(result('chat_list').toolResult!)
  expect(listed.total).toBe(2)
  expect(listed.chats.map((value: any) => value.id).sort()).toEqual([chat.id, shared.id].sort())
  await run([discover('mcp__session__call_llm'), { name: 'mcp__session__call_llm', args: { prompt: 'Return the fixture completion.' } }])
  expect(JSON.parse(result('mcp__session__call_llm').toolResult!)).toBe('Done.')
  expect(keys.every((key) => key === 'Bearer fixture-key')).toBe(true)
  await run([discover('chat_search'), { name: 'chat_search', args: { query: 'needle' } }])
  const searched = JSON.parse(result('chat_search').toolResult!)
  expect(searched.map((value: any) => value.sessionId)).toEqual([shared.id])
  expect(searched[0].matchCount).toBe(1)
  expect(JSON.stringify(searched)).not.toContain('hidden-payload')
  expect(JSON.stringify(searched)).not.toContain('tool-payload')
  expect(JSON.stringify(searched)).not.toContain('private-needle')
  await run([discover('chat_get'), { name: 'chat_get', args: { id: privateChat.id } }])
  expect(result('chat_get').toolStatus).toBe('error')
  await expect(manager.addSessionMembers(chat.id, owner, [`user:${newMember}`])).rejects.toThrow('cannot access')
  await expect(manager.addSessionMembers(chat.id, owner, [`agent:${otherAgent.id}`])).rejects.toThrow('cannot access')
  expect(result('chat_get').toolResult).not.toContain('Secret target')
  await run([discover('chat_get'), { name: 'chat_get', args: { id: otherAgentChat.id } }])
  expect(result('chat_get').toolStatus).toBe('error')
  let accepted: Promise<boolean> | undefined
  resolution = (event) => {
    const persisted = loadSession(workspace, chat.id)!.messages.find((message) => message.toolUseId === event.request.requestId)!
    expect(persisted.nativeAction?.status).toBe('pending')
    expect(persisted.toolInput).toEqual({})
    expect(persisted.nativeAction?.eligibleActors).toEqual([`user:${owner}`])
    expect(manager.canResolveNativeRequest(event.request.requestId, member)).toBe(false)
    expect(manager.canResolveNativeRequest(event.request.requestId, owner)).toBe(true)
    accepted = manager.respondToPermission(chat.id, event.request.requestId, true, false, undefined, owner)
  }
  const version = () => createHash('sha256').update(JSON.stringify(getStatuses(workspace.id))).digest('hex')
  await run([discover('status_create'), { name: 'status_create', args: { label: 'Reviewed', category: 'open', expectedVersion: version() } }])
  expect(await accepted).toBe(true)
  expect(getStatuses(workspace.id).some((status) => status.label === 'Reviewed')).toBe(true)
  expect(result('status_create').nativeAction?.status).toBe('approved')
  expect(result('status_create').nativeAction?.actorId).toBe(`user:${owner}`)
  expect(loadSession(workspace, chat.id)!.messages.filter((message) => message.toolUseId === result('status_create').toolUseId)).toHaveLength(1)
  await run([discover('chat_get'), { name: 'chat_get', args: { id: shared.id } }])
  const targetVersion = JSON.parse(result('chat_get').toolResult!).chat.version
  expect(JSON.stringify(JSON.parse(result('chat_get').toolResult!).messages)).not.toContain('hidden-payload')
  expect(JSON.stringify(JSON.parse(result('chat_get').toolResult!).messages)).not.toContain('tool-payload')
  resolution = (event) => {
    accepted = manager.respondToPermission(chat.id, event.request.requestId, true, false, undefined, owner)
    void manager.renameSession(shared.id, 'Concurrent title')
  }
  await run([discover('chat_update'), { name: 'chat_update', args: { id: shared.id, expectedVersion: targetVersion, patch: { title: 'Stale title' } } }])
  expect(await accepted).toBe(false)
  expect((await manager.getSession(shared.id))!.name).toBe('Concurrent title')
  const flush = manager.flushSession.bind(manager)
  let failApproved = true
  manager.flushSession = async (id) => {
    const live = (manager as unknown as { sessions: Map<string, { messages: Message[] }> }).sessions.get(chat.id)!
    const action = live.messages.findLast((message) => message.toolName === 'status_create')
    if (id === chat.id && failApproved && action?.nativeAction?.status === 'approved' && ['pending', 'executing'].includes(action.toolStatus ?? '')) { failApproved = false; throw new Error('Fixture approved write failed.') }
    await flush(id)
  }
  resolution = (event) => { accepted = manager.respondToPermission(chat.id, event.request.requestId, true, false, undefined, owner) }
  await run([discover('status_create'), { name: 'status_create', args: { label: 'Storage blocked', category: 'open', expectedVersion: version() } }])
  manager.flushSession = flush
  expect(await accepted).toBe(false)
  expect(getStatuses(workspace.id).some((status) => status.label === 'Storage blocked')).toBe(false)
  expect(result('status_create').nativeAction?.status).toBe('failed')
  resolution = (event) => {
    accepted = manager.respondToPermission(chat.id, event.request.requestId, true, false, undefined, owner)
    deleteWorkspaceMember(workspace.id, owner)
  }
  await run([discover('status_create'), { name: 'status_create', args: { label: 'Revoked owner', category: 'open', expectedVersion: version() } }])
  expect(await accepted).toBe(false)
  expect(getStatuses(workspace.id).some((status) => status.label === 'Revoked owner')).toBe(false)
  createWorkspaceMember(workspace.id, owner, 'owner')
  const oldRun = result('status_create').nativeAction!.runId!
  let stopped: Promise<void> | undefined
  resolution = (event) => {
    stopped = (async () => {
      await manager.cancelProcessing(chat.id, false, oldRun)
      expect(manager.canResolveNativeRequest(event.request.requestId, owner)).toBe(true)
      await manager.cancelProcessing(chat.id, false, loadSession(workspace, chat.id)!.messages.find((message) => message.toolUseId === event.request.requestId)!.nativeAction!.runId)
    })()
  }
  await run([discover('status_create'), { name: 'status_create', args: { label: 'Stopped', category: 'open', expectedVersion: version() } }])
  await stopped
  expect(getStatuses(workspace.id).some((status) => status.label === 'Stopped')).toBe(false)
  expect(['canceled', 'expired', 'failed']).toContain(result('status_create').nativeAction?.status ?? '')
  resolution = undefined
  await run([{ name: 'prepare_project', args: { title: 'Reviewed foundation', description: '# Purpose\nOnly the reviewed scope.' } }])
  const draft = JSON.parse(result('prepare_project').toolResult!)
  expect(draft.creationId).toMatch(/^[0-9a-f-]{36}$/)
  resolution = (event) => { accepted = manager.respondToPermission(chat.id, event.request.requestId, true, false, undefined, owner) }
  await run([{ name: 'create_project', args: { creationId: draft.creationId } }])
  expect(await accepted).toBe(true)
  const projectId = JSON.parse(result('create_project').toolResult!).id
  expect(result('create_project').nativeAction?.artifact).toMatchObject({ type: 'project', id: projectId, title: draft.title })
  await run([{ name: 'create_project', args: { creationId: draft.creationId } }])
  expect(await accepted).toBe(true)
  expect(JSON.parse(result('create_project').toolResult!).id).toBe(projectId)
  expect(getProjects(workspace.id).filter((project) => project.title === draft.title)).toHaveLength(1)
  resolution = undefined
  let answered: Promise<boolean[]> | undefined
  questionResponse = (event) => {
    const id = event.message.nativeAction.id
    expect(loadSession(workspace, chat.id)!.messages.find((message) => message.toolUseId === id)?.nativeAction?.status).toBe('pending')
    expect(event.message.nativeAction.eligibleActors.sort()).toEqual([`user:${owner}`, `user:${member}`].sort())
    answered = Promise.all([manager.respondToNativeQuestion(chat.id, id, 'A', member), manager.respondToNativeQuestion(chat.id, id, 'B', owner)])
  }
  await run([{ name: 'ask_user', args: { question: 'Choose a direction.', options: [{ label: 'A' }, { label: 'B' }] } }])
  expect(await answered).toEqual([true, false])
  expect(result('ask_user').nativeAction).toMatchObject({ kind: 'question', status: 'approved', actorId: `user:${member}` })
  expect(result('ask_user').toolStatus).toBe('completed')
  expect(result('ask_user').toolResult).toContain('User answered: A')
  questionResponse = undefined
  await run([{ name: 'ask_user', args: { question: 'Enter your API key.' } }])
  expect(result('ask_user').nativeAction).toBeUndefined()
  expect(result('ask_user').toolInput).toEqual({})
  await run([{ name: 'create_document', args: { title: 'Once', content: 'One durable effect.' } }])
  await run([])
  expect(getLibraryItems(workspace.id).filter((item) => item.title === 'Once')).toHaveLength(1)
  updateSetting(userEntity(member), 'midStreamBehavior', 'queue')
  const queueStarted = Promise.withResolvers<void>(), queueRelease = Promise.withResolvers<void>(), queueDone = Promise.withResolvers<void>()
  const queueBase = wire.length
  hold = { ready: queueStarted.resolve, wait: queueRelease.promise }
  completed = () => { if (wire.length === queueBase + 2 && !manager.getSessions(workspace.id, member).find((session) => session.id === chat.id)?.isProcessing) queueDone.resolve() }
  const queueFirst = manager.sendMessage(chat.id, 'Held queue request.', undefined, undefined, { sender: `user:${member}`, recipientAgentId: agent.id })
  await queueStarted.promise
  const queueRunId = (await manager.getSession(chat.id))!.currentRunId
  await manager.sendMessage(chat.id, 'Queued follow-up.', undefined, undefined, { sender: `user:${member}`, recipientAgentId: agent.id })
  expect(wire).toHaveLength(queueBase + 1)
  expect((await manager.getSession(chat.id))!.currentRunId).toBe(queueRunId)
  queueRelease.resolve()
  await queueFirst
  await queueDone.promise
  expect(JSON.stringify(wire[queueBase + 1].input.findLast((message: any) => message.role === 'user'))).toContain('Queued follow-up.')
  const steerStarted = Promise.withResolvers<void>(), steerRelease = Promise.withResolvers<void>(), steerDone = Promise.withResolvers<void>()
  const steerBase = wire.length
  hold = { ready: steerStarted.resolve, wait: steerRelease.promise }
  completed = () => { if (wire.length === steerBase + 3 && !manager.getSessions(workspace.id, member).find((session) => session.id === chat.id)?.isProcessing) steerDone.resolve() }
  const steerFirst = manager.sendMessage(chat.id, 'Held request to interrupt.', undefined, undefined, { sender: `user:${member}`, recipientAgentId: agent.id })
  await steerStarted.promise
  await manager.sendMessage(chat.id, 'Retained queued request.', undefined, undefined, { sender: `user:${member}`, recipientAgentId: agent.id })
  updateSetting(userEntity(member), 'midStreamBehavior', 'steer')
  await manager.sendMessage(chat.id, 'Steering correction.', undefined, undefined, { sender: `user:${member}`, recipientAgentId: agent.id })
  await steerFirst
  steerRelease.resolve()
  await steerDone.promise
  expect(JSON.stringify(wire[steerBase + 1].input.findLast((message: any) => message.role === 'user'))).toContain('Steering correction.')
  expect(JSON.stringify(wire[steerBase + 2].input.findLast((message: any) => message.role === 'user'))).toContain('Retained queued request.')
  expect(loadSession(workspace, chat.id)!.messages.filter((message) => message.content === 'Retained queued request.')).toHaveLength(1)
  completed = undefined
  const requestsBeforeOtherAgent = wire.length
  const historyBeforeOtherAgent = loadSession(workspace, chat.id)!.messages
  const membersBeforeOtherAgent = (await manager.getSession(chat.id))!.members
  let recipientAcknowledged = false
  await expect(manager.sendMessage(chat.id, 'Do not inherit inaccessible chat history.', undefined, undefined, { sender: `user:${member}`, recipientAgentId: otherAgent.id }, undefined, undefined, () => { recipientAcknowledged = true })).rejects.toThrow('no longer a member')
  expect(recipientAcknowledged).toBe(false)
  expect(loadSession(workspace, chat.id)!.messages).toEqual(historyBeforeOtherAgent)
  expect((await manager.getSession(chat.id))!.members).toEqual(membersBeforeOtherAgent)
  const errorsBeforeOtherAgent = events.filter((event) => event.type === 'error').length
  await manager.sendMessage(chat.id, `agent:${otherAgent.id} Do not inherit inaccessible chat history.`, undefined, undefined, { sender: `user:${member}` })
  expect((await manager.getSession(chat.id))!.members).toContain(`agent:${otherAgent.id}`)
  expect(events.filter((event) => event.type === 'error').length).toBeGreaterThan(errorsBeforeOtherAgent)
  expect(wire).toHaveLength(requestsBeforeOtherAgent)
  await expect(manager.createSession(workspace.id, { branchFromSessionId: chat.id } as never, { createdBy: `user:${owner}` })).rejects.toThrow('branching is unavailable')
  const requestsBeforeRevocation = wire.length
  deleteWorkspaceMember(workspace.id, member)
  await expect(run([])).rejects.toThrow('Session not found')
  expect(wire).toHaveLength(requestsBeforeRevocation)
}, 30_000)
