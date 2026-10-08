import { afterAll, expect, it } from 'bun:test'
import { join } from 'node:path'
import { addWorkspace, saveConfig } from '@otto/shared/config'
import { CONFIG_DIR } from '@otto/shared/config/paths'
import { createAgent } from '@otto/shared/agents'
import { createConnection, userScope } from '@otto/shared/connections'
import { initDb } from '@otto/shared/db'
import { users } from '../../../shared/src/users/schema'
import { createWorkspaceMember } from '@otto/shared/workspaces'
import { createLibraryItem, deleteLibraryItem } from '@otto/shared/library'
import { loadSession } from '@otto/shared/sessions'
import { storedToMessage, type StoredAttachment } from '@otto/core/types'
import { SessionManager, createManagedSession } from './session-manager'
import sharp from 'sharp'

process.env.OTTO_MASTRA_CHAT = '1'
const requests: Record<string, unknown>[] = []
const endpoint = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(request) {
  requests.push(await request.json() as Record<string, unknown>)
  const parts = [
    { type: 'response.created', response: { id: 'response-fixture', created_at: 0, model: 'fixture' } },
    { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'message-fixture' } },
    { type: 'response.output_text.delta', item_id: 'message-fixture', delta: 'Read the fixture attachment.' },
    { type: 'response.completed', response: { usage: { input_tokens: 12, output_tokens: 5, total_tokens: 17 } } },
  ]
  return new Response(parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
} })
let manager = new SessionManager()
afterAll(() => { manager.cleanup(); endpoint.stop(true); delete process.env.OTTO_MASTRA_CHAT })

it('native chat admission ignores client paths/content, persists Library refs, reloads files and keeps deleted history visible', async () => {
  const human = 'anaaaaaaaaaa', actor = `user:${human}`
  const now = new Date()
  initDb().insert(users).values({ id: human, name: 'Ana', email: 'ana@example.test', createdAt: now, updatedAt: now }).run()
  saveConfig({ workspaces: [] })
  const workspace = addWorkspace({ name: 'Chat attachment', rootPath: join(CONFIG_DIR, 'chat-attachment') })
  const foreign = addWorkspace({ name: 'Foreign', rootPath: join(CONFIG_DIR, 'foreign-chat-attachment') })
  createWorkspaceMember(workspace.id, human, 'owner')
  const agent = createAgent({ workspaceId: workspace.id, title: 'Scout', provider: 'openai', model: 'pi/fixture', createdBy: actor })
  createConnection({ scope: userScope(human), slug: 'fixture', type: 'openai', authType: 'api_key', title: 'Fixture', baseUrl: endpoint.url.href + 'v1', defaultModel: 'pi/fixture', models: ['pi/fixture'] }, { apiKey: 'controlled-fixture-key' })
  const chat = await manager.createSession(workspace.id, { agentId: agent.id, name: 'File chat', llmConnection: 'fixture' }, { createdBy: actor })
  const item = await createLibraryItem({ workspaceId: workspace.id, title: 'brief.txt', mime: 'text/plain', bytes: new TextEncoder().encode('LIBRARY_TEXT_BODY'), createdBy: actor })
  const ref: StoredAttachment = { id: item.id, type: 'image', name: 'forged name', mimeType: 'wrong/type', size: 1, storedPath: '/private/forged.txt' }
  const raw = { type: 'text' as const, path: '/private/forged.txt', name: 'bad', mimeType: 'text/plain', size: 1, text: 'CLIENT_CONTENT_MUST_NOT_REACH_PROVIDER' }
  await manager.sendMessage(chat.id, 'Read the attached brief.', [raw], [ref], { sender: actor })
  expect(requests.length).toBe(1)
  expect(JSON.stringify(requests[0])).toContain('LIBRARY_TEXT_BODY')
  expect(JSON.stringify(requests[0])).not.toContain('CLIENT_CONTENT_MUST_NOT_REACH_PROVIDER')
  const saved = loadSession(workspace, chat.id)!
  expect(saved.messages[0]!.attachments?.[0]).toMatchObject({ id: item.id, type: 'text', name: 'brief.txt', updatedAt: item.updatedAt })
  expect(JSON.stringify(saved.messages)).not.toContain('/private/forged')
  const foreignItem = await createLibraryItem({ workspaceId: foreign.id, title: 'foreign.txt', mime: 'text/plain', bytes: new TextEncoder().encode('PRIVATE_FOREIGN_CONTENT'), createdBy: actor })
  await expect(manager.sendMessage(chat.id, 'Read foreign.', undefined, [{ ...ref, id: foreignItem.id }], { sender: actor })).rejects.toThrow('unavailable')
  expect(requests.length).toBe(1)
  manager.cleanup()
  manager = new SessionManager()
  const recovered = createManagedSession({ ...saved, messages: saved.messages.map(storedToMessage) }, workspace, { messagesLoaded: true, messages: saved.messages.map(storedToMessage), members: [{ actor, readAt: null }, { actor: `agent:${agent.id}`, readAt: null }] })
  ;(manager as unknown as { sessions: Map<string, typeof recovered> }).sessions.set(chat.id, recovered)
  await manager.sendMessage(chat.id, 'Use the uploaded brief again.', undefined, undefined, { sender: actor })
  expect(JSON.stringify(requests.at(-1))).toContain('LIBRARY_TEXT_BODY')
  await deleteLibraryItem(workspace.id, item.id)
  await manager.sendMessage(chat.id, 'What can you still verify?', undefined, undefined, { sender: actor })
  expect(JSON.stringify(requests.at(-1))).toContain('Historical attachment content is unavailable')
  expect(JSON.stringify(requests.at(-1))).not.toContain('LIBRARY_TEXT_BODY')
  expect(loadSession(workspace, chat.id)!.messages[0]!.attachments?.[0]?.id).toBe(item.id)
  const small = await createLibraryItem({ workspaceId: workspace.id, title: 'small.txt', mime: 'text/plain', bytes: new TextEncoder().encode('CURRENT_SMALL_FILE'), createdBy: actor })
  const oversizedHistory = await createLibraryItem({ workspaceId: workspace.id, title: 'historical.txt', mime: 'text/plain', bytes: new TextEncoder().encode('L'.repeat(32768)), createdBy: actor })
  recovered.messages.unshift({ id: crypto.randomUUID(), role: 'user', content: 'Oversized prior file', timestamp: now.getTime(), attachments: [{ ...ref, id: oversizedHistory.id }] })
  await manager.sendMessage(chat.id, 'Read this current file.', undefined, [{ ...ref, id: small.id }], { sender: actor })
  expect(JSON.stringify(requests.at(-1))).toContain('CURRENT_SMALL_FILE')
  expect(JSON.stringify(requests.at(-1))).toContain('Historical attachment content is unavailable')
  expect(JSON.stringify(requests.at(-1))).not.toContain('L'.repeat(32768))
  const image = await createLibraryItem({ workspaceId: workspace.id, title: 'image.png', mime: 'image/png', bytes: await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ff0000' } }).png().toBuffer(), createdBy: actor })
  const pdf = await createLibraryItem({ workspaceId: workspace.id, title: 'page.pdf', mime: 'application/pdf', bytes: Buffer.from('JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAxMDAgMTAwXSAvUmVzb3VyY2VzIDw8ID4+ID4+CmVuZG9iagp4cmVmCjAgNAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNCAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKMjAzCiUlRU9G', 'base64'), createdBy: actor })
  const before = requests.length
  await manager.sendMessage(chat.id, 'Inspect this image.', undefined, [{ ...ref, id: image.id }, { ...ref, id: pdf.id }], { sender: actor })
  expect(requests.length).toBe(before + 1)
  expect(JSON.stringify(requests.at(-1))).toContain('input_image')
})
