import { afterAll, expect, it } from 'bun:test'
import { join } from 'node:path'
import { addWorkspace, saveConfig } from '@otto/shared/config'
import { CONFIG_DIR } from '@otto/shared/config/paths'
import { createAgent, getAgents, updateAgent } from '@otto/shared/agents'
import { createConnection, userScope } from '@otto/shared/connections'
import { createWorkspaceMember } from '@otto/shared/workspaces'
import { initDb } from '@otto/shared/db'
import { getProjects } from '@otto/shared/projects'
import { getLibraryItems } from '@otto/shared/library'
import { getRoutines } from '@otto/shared/automations/routines'
import { users } from '../../../shared/src/users/schema'
import { loadSession, sessionPersistenceQueue } from '@otto/shared/sessions'
import { SessionManager } from './session-manager'

let call: { name: string; args: unknown } | undefined
let approve = false
let createSameTurn = false
let storageFailurePrefix = false
const approvals: { toolName: string; command: string }[] = []
const manager = new SessionManager()
const endpoint = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(request) {
  const body = await request.json() as { tools?: unknown[]; input?: unknown }
  const title = JSON.stringify(body.input).includes('Reply with ONLY')
  let selected = title ? undefined : call
  if (!title) call = undefined
  if (!selected && !title && createSameTurn) {
    const findDraft = (value: unknown): { creationId: string } | undefined => {
      if (typeof value === 'string') { try { return findDraft(JSON.parse(value)) } catch { return } }
      if (!value || typeof value !== 'object') return
      const data = value as { title?: string; creationId?: string }
      if (data.title === 'Race reviewed' && typeof data.creationId === 'string') return { creationId: data.creationId }
      for (const child of Object.values(value).toReversed()) { const draft = findDraft(child); if (draft) return draft }
    }
    const draft = findDraft(body.input)
    if (draft) { selected = { name: 'create_project', args: draft }; createSameTurn = false }
  }
  const item = selected ? { type: 'function_call', id: 'fc', call_id: crypto.randomUUID(), name: selected.name, arguments: JSON.stringify(selected.args), status: 'completed' } : { type: 'message', id: 'msg' }
  const prefix = selected?.name === 'create_project' && storageFailurePrefix
  const index = prefix ? 1 : 0
  const events = [{ type: 'response.created', response: { id: 'fixture', created_at: 0, model: 'fixture' } },
    ...(prefix ? [{ type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg' } }, { type: 'response.output_text.delta', item_id: 'msg', delta: 'Storage failure fixture' }] : []),
    { type: 'response.output_item.added', output_index: index, item },
    ...(selected ? [{ type: 'response.function_call_arguments.delta', item_id: 'fc', output_index: index, delta: JSON.stringify(selected.args) }, { type: 'response.function_call_arguments.done', item_id: 'fc', output_index: index, arguments: JSON.stringify(selected.args) }, { type: 'response.output_item.done', output_index: index, item }] : [{ type: 'response.output_text.delta', item_id: 'msg', delta: title ? 'Project creation' : 'Review this foundation before creating it.' }]), { type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }]
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
} })
afterAll(() => { manager.cleanup(); endpoint.stop(true) })

it('creates only reviewed same-chat project drafts with explicit approval even in Allow-all and idempotent retries', async () => {
  saveConfig({ workspaces: [] })
  const workspace = addWorkspace({ name: 'Chat creation', rootPath: join(CONFIG_DIR, 'chat-creation') })
  const human = 'anaaaaaaaaaa', actor = `user:${human}`
  const now = new Date()
  initDb().insert(users).values({ id: human, name: 'Ana', email: 'ana@example.test', createdAt: now, updatedAt: now }).run()
  createWorkspaceMember(workspace.id, human, 'owner')
  const agent = createAgent({ workspaceId: workspace.id, title: 'Scout', provider: 'openai', model: 'fixture', createdBy: actor, skills: ['bounded-skill'], sources: ['bounded-source'] })
  createConnection({ scope: userScope(human), slug: 'creation', type: 'openai', authType: 'api_key', title: 'Fixture', baseUrl: endpoint.url.href + 'v1', defaultModel: 'fixture', models: ['fixture'] }, { apiKey: 'controlled-key' })
  const chat = await manager.createSession(workspace.id, { name: 'Project review', agentId: agent.id, llmConnection: 'creation', permissionMode: 'allow-all' }, { createdBy: actor })
  manager.setEventSink((_channel, _target, event: any) => {
    if (event?.type !== 'permission_request') return
    approvals.push(event.request)
    manager.respondToPermission(chat.id, event.request.requestId, approve, false)
  })
  const run = async (name: string, args: unknown, chatId = chat.id, sender = actor) => {
    call = { name, args }
    await manager.sendMessage(chatId, `agent:${agent.id} Review the requested creation.`, undefined, undefined, { sender })
    return loadSession(workspace, chatId)!.messages.filter((message) => message.type === 'tool').at(-1)!.toolResult!
  }
  const description = '## Purpose\nA reviewed launch\n\n## Scope\nPlanning only\n\n## Open questions\nWho reviews it?'
  const draft = JSON.parse(await run('prepare_project', { title: 'Launch', description }))
  expect(draft).toMatchObject({ title: 'Launch', description })
  expect(draft.creationId).toMatch(/^[0-9a-f-]{36}$/)
  expect(getProjects(workspace.id)).toEqual([])
  await run('create_project', { creationId: draft.creationId })
  expect(approvals.at(-1)!.command).toContain(description.replaceAll('\n', '\\n'))
  expect(getProjects(workspace.id)).toEqual([])
  approve = true
  const result = JSON.parse(await run('create_project', { creationId: draft.creationId }))
  expect(result.id).toBe(draft.creationId)
  expect(result.members).toEqual([`agent:${agent.id}`])
  await run('create_project', { creationId: draft.creationId })
  expect(getProjects(workspace.id)).toHaveLength(1)
  expect(approvals.filter((entry) => entry.toolName === 'create_project')).toHaveLength(3)
  const other = await manager.createSession(workspace.id, { name: 'Other chat', agentId: agent.id, llmConnection: 'creation', permissionMode: 'allow-all' }, { createdBy: actor })
  manager.setEventSink((_channel, _target, event: any) => { if (event?.type === 'permission_request') manager.respondToPermission(other.id, event.request.requestId, true, false) })
  expect(await run('create_project', { creationId: draft.creationId }, other.id)).toContain('not approved')
  expect(getProjects(workspace.id)).toHaveLength(1)
  manager.setEventSink((_channel, _target, event: any) => { if (event?.type === 'permission_request') {
    approvals.push(event.request)
    if (event.request.toolName === 'create_agent') updateAgent(workspace.id, agent.id, { skills: ['narrowed-skill'], sources: ['narrowed-source'] })
    manager.respondToPermission(chat.id, event.request.requestId, true, false)
  } })
  const processEvent = (manager as any).processEvent.bind(manager)
  ;(manager as any).processEvent = async (managed: unknown, event: any) => {
    if (event.type === 'tool_result' && event.result?.includes('Race reviewed')) await Bun.sleep(80)
    return processEvent(managed, event)
  }
  createSameTurn = true
  await run('prepare_project', { title: 'Race reviewed', description: '# Exact reviewed foundation' })
  expect(createSameTurn).toBe(false)
  expect(approvals.at(-1)!.command).toContain('# Exact reviewed foundation')
  expect(approvals.at(-1)!.command).toContain('Race reviewed')
  expect(getProjects(workspace.id)).toHaveLength(2)
  const folder = JSON.parse(await run('create_folder', { title: 'Briefs' }))
  expect(getLibraryItems(workspace.id).find((item) => item.id === folder.id)?.type).toBe('folder')
  const document = JSON.parse(await run('create_document', { title: 'Draft', content: '# Foundation', parentId: folder.id }))
  expect(document.parentId).toBe(folder.id)
  const createdAgent = JSON.parse(await run('create_agent', { title: 'Writer', instructions: 'Write reviewed briefs.' }))
  expect(createdAgent.createdBy).toBe(actor)
  expect(createdAgent.sources).toEqual(['narrowed-source'])
  expect(createdAgent.skills).toEqual(['narrowed-skill'])
  expect(getAgents(workspace.id)).toHaveLength(2)
  const routine = JSON.parse(await run('create_routine', { title: 'Daily brief', cron: '0 9 * * *', timezone: 'Europe/Madrid', prompt: 'Review the brief' }))
  expect(routine.pausedAt).not.toBeNull()
  expect(routine.createdBy).toBe(actor)
  expect(routine.config.permissionMode).toBe('safe')
  expect(routine.agentId).toBe(agent.id)
  expect(getRoutines(workspace.id)).toHaveLength(1)
  expect(routine.runs).toEqual([])
  expect(approvals.some((entry) => entry.toolName === 'create_agent')).toBe(true)
  expect(approvals.some((entry) => entry.toolName === 'create_routine')).toBe(true)
  const otherHuman = 'benbbbbbbbbb'
  initDb().insert(users).values({ id: otherHuman, name: 'Ben', email: 'ben@example.test', createdAt: now, updatedAt: now }).run()
  createWorkspaceMember(workspace.id, otherHuman, 'member')
  await manager.addSessionMembers(chat.id, human, [`user:${otherHuman}`])
  const memberAgent = JSON.parse(await run('create_agent', { title: 'Member writer', instructions: 'Write reviewed notes.' }, chat.id, `user:${otherHuman}`))
  expect(memberAgent.createdBy).toBe(`user:${otherHuman}`)
  const memberRoutine = JSON.parse(await run('create_routine', { title: 'Member brief', cron: '0 10 * * *', timezone: 'Europe/Madrid', prompt: 'Review notes' }, chat.id, `user:${otherHuman}`))
  expect(memberRoutine.createdBy).toBe(`user:${otherHuman}`)
  expect(memberRoutine.pausedAt).not.toBeNull()
  let retained = false, injected = false
  const approvalCount = approvals.length
  ;(manager as any).processEvent = async (managed: any, event: any) => {
    await processEvent(managed, event)
    if (event.type !== 'text_complete' || event.text !== 'Storage failure fixture') return
    injected = true
    sessionPersistenceQueue.enqueue(managed.id, () => ({ ...(manager as any).chatWriteOf(managed), writeNativeMessages: async () => { throw Object.assign(new Error('controlled storage failure'), { code: 'SQLITE_BUSY' }) } }))
    try { await manager.flushSession(managed.id) }
    finally { retained = sessionPersistenceQueue.hasPending(managed.id) }
  }
  storageFailurePrefix = true
  const started = performance.now()
  await run('create_project', { creationId: draft.creationId })
  expect(performance.now() - started).toBeLessThan(5000)
  expect(injected).toBe(true)
  expect(retained).toBe(true)
  expect(approvals).toHaveLength(approvalCount)
  expect(getProjects(workspace.id)).toHaveLength(2)
  ;(manager as any).processEvent = processEvent
  storageFailurePrefix = false
  await manager.flushAllSessions()
  expect(sessionPersistenceQueue.pendingCount).toBe(0)
}, 20000)
