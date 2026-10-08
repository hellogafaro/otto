import { afterAll, expect, it } from 'bun:test'
import { join } from 'node:path'
import { addWorkspace, saveConfig } from '@otto/shared/config'
import { CONFIG_DIR } from '@otto/shared/config/paths'
import { createAgent } from '@otto/shared/agents'
import { createConnection, userScope } from '@otto/shared/connections'
import { createWorkspaceMember } from '@otto/shared/workspaces'
import { initDb } from '@otto/shared/db'
import { users } from '../../../shared/src/users/schema'
import { SessionManager } from './session-manager'
import { loadSession } from '@otto/shared/sessions'
import { getStatuses } from '@otto/shared/statuses'

process.env.OTTO_MASTRA_CHAT = '1'
let call: { name: string; args: unknown } | undefined
let approvals = 0, expose: string[] = []
const manager = new SessionManager()
const endpoint = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(request) {
  const body = await request.json() as { tools?: { name: string }[]; input?: unknown }
  if (body.tools) expose = body.tools.map((tool) => tool.name)
  const selected = call
  call = undefined
  const item = selected ? { type: 'function_call', id: 'fc', call_id: crypto.randomUUID(), name: selected.name, arguments: JSON.stringify(selected.args), status: 'completed' } : { type: 'message', id: 'msg' }
  const title = JSON.stringify(body.input).includes('Reply with ONLY')
  const parts = [{ type: 'response.created', response: { id: 'fixture', created_at: 0, model: 'fixture' } }, { type: 'response.output_item.added', output_index: 0, item },
    ...(selected ? [{ type: 'response.function_call_arguments.delta', item_id: 'fc', output_index: 0, delta: JSON.stringify(selected.args) }, { type: 'response.function_call_arguments.done', item_id: 'fc', output_index: 0, arguments: JSON.stringify(selected.args) }, { type: 'response.output_item.done', output_index: 0, item }] : [{ type: 'response.output_text.delta', item_id: 'msg', delta: title ? 'Session Tools' : 'Session action checked.' }]), { type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }]
  return new Response(parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
} })
afterAll(() => { manager.cleanup(); endpoint.stop(true); delete process.env.OTTO_MASTRA_CHAT })

it('native canonical session callbacks preserve creator audience, human closure and approval policy', async () => {
  saveConfig({ workspaces: [] })
  const workspace = addWorkspace({ name: 'Session tools', rootPath: join(CONFIG_DIR, 'native-session-tools') })
  const human = 'anaaaaaaaaaa', other = 'benbbbbbbbbb', actor = `user:${human}`
  for (const id of [human, other]) {
    const now = new Date()
    initDb().insert(users).values({ id, name: id, email: id + '@example.test', createdAt: now, updatedAt: now }).run()
    createWorkspaceMember(workspace.id, id, 'owner')
  }
  const agent = createAgent({ workspaceId: workspace.id, title: 'Scout', provider: 'openai', model: 'pi/fixture', createdBy: actor })
  createConnection({ scope: userScope(human), slug: 'fixture', type: 'openai', authType: 'api_key', title: 'Fixture', baseUrl: endpoint.url.href + 'v1', defaultModel: 'pi/fixture', models: ['pi/fixture'] }, { apiKey: 'controlled-key' })
  const chat = await manager.createSession(workspace.id, { name: 'Owned', agentId: agent.id, llmConnection: 'fixture', permissionMode: 'ask' }, { createdBy: actor })
  const foreign = await manager.createSession(workspace.id, { name: 'OTHER_PRIVATE_CHAT', agentId: agent.id }, { createdBy: `user:${other}` })
  manager.setEventSink((_channel, _target, event: any) => { if (event?.type === 'permission_request') { approvals++; manager.respondToPermission(chat.id, event.request.requestId, true, false) } })
  const run = async (name: string, args: unknown) => {
    call = { name: 'mcp__session__' + name, args }
    await manager.sendMessage(chat.id, 'Check session action.', undefined, undefined, { sender: actor })
    return loadSession(workspace, chat.id)!.messages.filter((entry) => entry.type === 'tool').at(-1)!.toolResult!
  }
  expect(await run('list_sessions', {})).not.toContain('OTHER_PRIVATE_CHAT')
  expect(await run('get_session_info', { sessionId: foreign.id })).toContain('not found')
  const open = getStatuses(workspace.id).find((status) => status.category === 'open' && status.id !== 'todo')!
  expect(await run('set_session_status', { status: open.id })).toContain('Status set')
  expect(manager.getSessions(workspace.id, human).find((entry) => entry.id === chat.id)!.sessionStatus).toBe(open.id)
  expect(await run('set_session_status', { status: 'done' })).toContain('Refusing')
  expect(await run('set_session_status', { sessionId: foreign.id, status: open.id })).toContain('not found')
  expect(approvals).toBe(3)
  expect(await run('mermaid_validate', { code: 'flowchart LR\nA-->B' })).toContain('valid')
  manager.setSessionPermissionMode(chat.id, 'safe')
  call = { name: 'list_work', args: {} }
  await manager.sendMessage(chat.id, 'Read only.', undefined, undefined, { sender: actor })
  const listed = loadSession(workspace, chat.id)!.messages.filter((message) => message.type === 'tool' && message.toolName === 'list_work').at(-1)!
  expect(listed.toolStatus).toBe('completed')
  expect(JSON.parse(listed.toolResult!)).toMatchObject({ projects: [], tasks: [], documents: [] })
  call = { name: 'list_work', args: { _intent: 'controlled invalid argument' } }
  await manager.sendMessage(chat.id, 'Reject unadvertised input.', undefined, undefined, { sender: actor })
  const invalid = loadSession(workspace, chat.id)!.messages.filter((message) => message.type === 'tool' && message.toolName === 'list_work').at(-1)!
  expect(invalid.toolStatus).toBe('error')
  expect(invalid.isError).toBe(true)
  expect(invalid.toolResult).toContain('Tool input validation failed')
  expect(invalid.toolResult).not.toContain('controlled invalid argument')
  expect(expose).toContain('mcp__session__get_session_info')
  expect(expose).not.toContain('mcp__session__set_session_status')
  expect(expose).not.toContain('mcp__session__source_credential_prompt')
  expect(expose).not.toContain('mcp__session__decide')
  manager.setSessionPermissionMode(chat.id, 'ask')
  manager.setSessionPermissionMode(chat.id, 'guarded')
  const guardedBefore = approvals
  expect(await run('set_session_status', { status: open.id })).toContain('Status set')
  expect(approvals).toBe(guardedBefore + 1)
  manager.setSessionPermissionMode(chat.id, 'ask')
  const parentMessages = loadSession(workspace, chat.id)!.messages
  const branch = await manager.createSession(workspace.id, { name: 'Branch', agentId: agent.id, llmConnection: 'fixture', branchFromSessionId: chat.id, branchFromMessageId: parentMessages[0]!.id }, { createdBy: actor })
  expect(loadSession(workspace, branch.id)!.messages.map((message) => message.id)).toEqual([parentMessages[0]!.id])
  expect(loadSession(workspace, chat.id)!.messages.length).toBe(parentMessages.length)
  const stored = (manager as unknown as { sessions: Map<string, any> }).sessions.get(chat.id)!
  stored.messages.unshift(...Array.from({ length: 600 }, (_entry, index) => ({ id: crypto.randomUUID(), role: 'user', content: `Unicode${index} ${'漢'.repeat(80)}`, timestamp: index + 1 })))
  stored.messages.push({ id: crypto.randomUUID(), role: 'tool', content: '', toolName: 'publish_file', toolStatus: 'completed', toolResult: 'RECENT_ARTIFACT_MUST_REMAIN', timestamp: Date.now() })
  let compactPrompt = ''
  const complete = (manager as any).nativeCompletion
  ;(manager as any).nativeCompletion = async (_managed: unknown, prompt: string) => { compactPrompt = prompt; return 'Summary of earlier context' }
  await manager.sendMessage(chat.id, '/compact', undefined, undefined, { sender: actor })
  expect(Buffer.byteLength(compactPrompt)).toBeLessThanOrEqual(48000)
  expect(compactPrompt).not.toContain('RECENT_ARTIFACT_MUST_REMAIN')
  expect(stored.contextThroughId).not.toBe(stored.messages.find((message: any) => message.toolResult === 'RECENT_ARTIFACT_MUST_REMAIN').id)
  ;(manager as any).nativeCompletion = complete
  await manager.sendMessage(chat.id, 'Continue with recent artifact.', undefined, undefined, { sender: actor })
  expect(loadSession(workspace, chat.id)!.messages.some((message) => message.toolResult === 'RECENT_ARTIFACT_MUST_REMAIN')).toBe(true)
})
