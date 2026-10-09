import { afterAll, expect, it } from 'bun:test'
import { join } from 'node:path'
import { addWorkspace, saveConfig } from '@otto/shared/config'
import { CONFIG_DIR } from '@otto/shared/config/paths'
import { initDb } from '@otto/shared/db'
import { createSession, getSessionPath } from '@otto/shared/sessions'
import { closeMastraHistory, deleteMastraHistory, initMastraHistory, recoverMastraHistory, writeMastraHistory } from './mastra-history'
import { getNativeMessageIdentities, getNativeMessages } from '../../../shared/src/sessions/native-messages'
import type { StoredMessage } from '@otto/core/types'

afterAll(() => closeMastraHistory())

it('retains distinct system/info identities through official storage reads and restart recovery', async () => {
  saveConfig({ workspaces: [] })
  const workspace = addWorkspace({ name: 'Identity fixture', rootPath: join(CONFIG_DIR, 'identity') })
  const chat = createSession(workspace, { name: 'Identity fixture', createdBy: `user:${crypto.randomUUID()}` })
  const messages = Array.from({ length: 16 }, (_, index) => ({ id: crypto.randomUUID(), type: 'info' as const, content: 'Fixture informational message.', timestamp: index + 1 }))
  const input = { workspaceId: workspace.id, chatId: chat.id, sessionDir: getSessionPath(workspace.rootPath, chat.id), messages }
  await writeMastraHistory(input)
  const identity = () => initDb().$client.query("SELECT id, json_extract(content,'$.metadata.otto.id') AS otto_id, json_extract(content,'$.metadata.otto.timestamp') AS time FROM mastra_messages WHERE thread_id=? AND resourceId=?").all(chat.id, workspace.id) as { id: string; otto_id: string; time: number }[]
  expect(new Set(identity().map((row) => row.otto_id)).size).toBe(16)
  const memory = (await (await initMastraHistory()).storage.getStore('memory'))!
  const loaded = await memory.listMessages({ threadId: chat.id, resourceId: workspace.id, perPage: false })
  expect(loaded.messages).toHaveLength(0)
  initDb().$client.query('UPDATE chats SET run_started_at=1 WHERE id=? AND workspace_id=?').run(chat.id, workspace.id)
  await recoverMastraHistory(input)
  expect(identity()).toHaveLength(17)
  expect(new Set(identity().map((row) => row.otto_id)).size).toBe(17)
  const recovered = identity()
  await recoverMastraHistory(input)
  expect(identity()).toEqual(recovered)
  await writeMastraHistory({ ...input, messages })
  expect(identity()).toHaveLength(16)
  expect(new Set(identity().map((row) => row.otto_id)).size).toBe(16)
})

it('preserves every canonical role and vendor ID through repeated writes, scoped removal and deletion', async () => {
  const workspace = addWorkspace({ name: 'All roles', rootPath: join(CONFIG_DIR, 'all-roles') })
  const foreign = addWorkspace({ name: 'Foreign roles', rootPath: join(CONFIG_DIR, 'foreign-roles') })
  const chat = createSession(workspace, { name: 'All roles', createdBy: `user:${crypto.randomUUID()}` })
  const other = createSession(foreign, { name: 'Foreign roles', createdBy: `user:${crypto.randomUUID()}` })
  const roles: StoredMessage['type'][] = ['user', 'assistant', 'tool', 'info', 'error', 'warning', 'plan', 'auth-request']
  const messages = roles.map((type, index) => ({ id: crypto.randomUUID(), type, content: 'Fixture data.', timestamp: index + 1 })) as StoredMessage[]
  const input = { workspaceId: workspace.id, chatId: chat.id, sessionDir: '', messages }
  await writeMastraHistory(input)
  const original = getNativeMessageIdentities(workspace.id, chat.id)
  await writeMastraHistory({ workspaceId: foreign.id, chatId: other.id, sessionDir: '', messages: [messages[0]!] })
  const foreignBefore = getNativeMessageIdentities(foreign.id, other.id)
  for (let count = 0; count < 5; count++) await writeMastraHistory(input)
  expect(getNativeMessageIdentities(workspace.id, chat.id)).toEqual(original)
  expect(getNativeMessages(workspace.id, chat.id, '')).toEqual(messages)
  expect(getNativeMessageIdentities(foreign.id, chat.id)).toEqual([])
  expect(getNativeMessageIdentities(foreign.id, other.id)).toEqual(foreignBefore)
  await writeMastraHistory({ ...input, messages: messages.slice(3) })
  expect(getNativeMessages(workspace.id, chat.id, '').map((message) => message.id)).toEqual(messages.slice(3).map((message) => message.id))
  await deleteMastraHistory(foreign.id, chat.id)
  expect(getNativeMessageIdentities(workspace.id, chat.id)).toHaveLength(5)
  await deleteMastraHistory(workspace.id, chat.id)
  expect(getNativeMessageIdentities(workspace.id, chat.id)).toEqual([])
  expect(getNativeMessageIdentities(foreign.id, other.id)).toEqual(foreignBefore)
})

it('collapses identical canonical duplicates at persistence and refuses divergent stored or snapshot duplicates before mutation', async () => {
  const workspace = addWorkspace({ name: 'Duplicate identities', rootPath: join(CONFIG_DIR, 'duplicates') })
  const chat = createSession(workspace, { name: 'Duplicate identities', createdBy: `user:${crypto.randomUUID()}` })
  const message: StoredMessage = { id: crypto.randomUUID(), type: 'info', content: 'Fixture data.', timestamp: 1, toolInput: { nested: { first: 1, values: [1, 2], last: null }, flag: false } }
  const input = { workspaceId: workspace.id, chatId: chat.id, sessionDir: '', messages: [message] }
  await writeMastraHistory(input)
  const original = getNativeMessageIdentities(workspace.id, chat.id)[0]!
  const memory = (await (await initMastraHistory()).storage.getStore('memory'))!
  const duplicate = (fields: StoredMessage) => ({ id: crypto.randomUUID(), threadId: chat.id, resourceId: workspace.id, createdAt: new Date(1), role: 'system' as const, type: 'v2' as const, content: { format: 2 as const, parts: [{ type: 'text' as const, text: fields.content }], metadata: { ottoId: fields.id, position: 0, otto: fields } } })
  const reordered: StoredMessage = { toolInput: { flag: false, nested: { last: null, values: [1, 2], first: 1 } }, timestamp: 1, content: message.content, type: message.type, id: message.id }
  await memory.saveMessages({ messages: [duplicate(message), duplicate(reordered)] })
  expect(getNativeMessageIdentities(workspace.id, chat.id)).toHaveLength(3)
  await writeMastraHistory({ ...input, messages: [message, reordered] })
  expect(getNativeMessageIdentities(workspace.id, chat.id)).toEqual([original])
  const divergent = duplicate({ ...message, content: 'Divergent fixture data.' })
  await memory.saveMessages({ messages: [divergent] })
  const before = getNativeMessageIdentities(workspace.id, chat.id)
  await expect(writeMastraHistory(input)).rejects.toThrow('divergent projections')
  expect(getNativeMessageIdentities(workspace.id, chat.id)).toEqual(before)
  await memory.deleteMessages([divergent.id])
  const restored = getNativeMessageIdentities(workspace.id, chat.id)
  await expect(writeMastraHistory({ ...input, messages: [message, { ...message, content: 'Conflicting snapshot.' }] })).rejects.toThrow('divergent projections')
  expect(getNativeMessageIdentities(workspace.id, chat.id)).toEqual(restored)
  const reorderedArray = duplicate({ ...message, toolInput: { nested: { first: 1, values: [2, 1], last: null }, flag: false } })
  await memory.saveMessages({ messages: [reorderedArray] })
  const beforeArrayConflict = getNativeMessageIdentities(workspace.id, chat.id)
  await expect(writeMastraHistory(input)).rejects.toThrow('divergent projections')
  expect(getNativeMessageIdentities(workspace.id, chat.id)).toEqual(beforeArrayConflict)
  await memory.deleteMessages([reorderedArray.id])
  await expect(writeMastraHistory({ ...input, messages: [message, { ...message, toolInput: { nested: { first: 1, values: [2, 1], last: null }, flag: false } }] })).rejects.toThrow('divergent projections')
  expect(getNativeMessageIdentities(workspace.id, chat.id)).toEqual(restored)
})

it('refuses opaque native rows before any official mutation instead of purging them', async () => {
  const workspace = addWorkspace({ name: 'Opaque identity', rootPath: join(CONFIG_DIR, 'opaque-identity') })
  const chat = createSession(workspace, { name: 'Opaque identity', createdBy: `user:${crypto.randomUUID()}` })
  const message: StoredMessage = { id: crypto.randomUUID(), type: 'info', content: 'Fixture data.', timestamp: 1 }
  const input = { workspaceId: workspace.id, chatId: chat.id, sessionDir: '', messages: [message] }
  await writeMastraHistory(input)
  const memory = (await (await initMastraHistory()).storage.getStore('memory'))!
  const futureId = crypto.randomUUID()
  await memory.saveMessages({ messages: [{ id: crypto.randomUUID(), threadId: chat.id, resourceId: workspace.id, createdAt: new Date(2), role: 'system', type: 'v2', content: { format: 2, parts: [{ type: 'text', text: 'Opaque fixture data.' }] } }, { id: crypto.randomUUID(), threadId: chat.id, resourceId: workspace.id, createdAt: new Date(3), role: 'system', type: 'v2', content: { format: 2, parts: [{ type: 'text', text: 'Future fixture data.' }], metadata: { ottoId: futureId, otto: { id: futureId, type: 'unsupported-future-type', content: 'Future fixture data.' } } } }] })
  const before = getNativeMessageIdentities(workspace.id, chat.id)
  expect(before).toHaveLength(3)
  expect(before.find((row) => row.canonicalId === futureId)!.fingerprint).toBeNull()
  const save = memory.saveMessages.bind(memory), remove = memory.deleteMessages.bind(memory), thread = memory.saveThread.bind(memory)
  let mutations = 0
  memory.saveMessages = async (...args) => { mutations++; return save(...args) }
  memory.deleteMessages = async (...args) => { mutations++; return remove(...args) }
  memory.saveThread = async (...args) => { mutations++; return thread(...args) }
  try {
    await expect(writeMastraHistory(input)).rejects.toThrow('unsupported canonical identity or projection')
    expect(mutations).toBe(0)
    expect(getNativeMessageIdentities(workspace.id, chat.id)).toEqual(before)
  } finally { memory.saveMessages = save; memory.deleteMessages = remove; memory.saveThread = thread }
})
