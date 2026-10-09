import { expect, it } from 'bun:test'
import { z } from 'zod'
import { CHAT_DESTRUCTIVE_TOOL_NAMES, CHAT_NOTIFICATION_TOOL_NAMES, CHAT_READ_TOOL_NAMES, CHAT_SENSITIVE_TOOL_NAMES, CHAT_WRITE_TOOL_NAMES, createMastraChatManagementTools, type ChatManagementMetadata, type MastraChatManagementScope } from './mastra-chat-management-tools'

const human = 'aaaaaaaaaaaa'
const agentId = 'bbbbbbbbbbbb'
const otherHuman = 'cccccccccccc'
const version = 'opaque-parent-revision/7'
const metadata = (id = 'legacy-chat_1'): ChatManagementMetadata => ({ id, title: 'Visible chat', status: 'todo', labels: [], projectId: null, version })

function fixture() {
  let userId = human
  let humanActive = true
  let agentActive = true
  let audienceActive = true
  const visible = new Set(['legacy-chat_1', 'f2a34b98-08c4-4b35-97fa-54d6cd39afe9'])
  const calls: { name: string; args: unknown[] }[] = []
  const record = (name: string, ...args: unknown[]) => { calls.push({ name, args }) }
  const members = (id: string) => ({ id, version, members: [{ actor: `user:${human}`, name: 'Visible person' }, { actor: `agent:${agentId}`, name: 'Visible agent' }] })
  const scope: MastraChatManagementScope = {
    workspaceId: 'dddddddddddd', agentId,
    getUserId: () => userId,
    assertAccess: (ids) => {
      record('assertAccess', ids)
      if (!humanActive || !agentActive || !audienceActive || ids?.some((id) => !visible.has(id))) throw new Error('Private name and /private/server/path must stay hidden')
    },
    listChats: (options) => { record('listChats', options); return { total: 1, chats: [metadata()] } },
    getChat: (id, options) => { record('getChat', id, options); return { chat: metadata(id), messages: [{ id: 'message_1', role: 'user', content: 'Ordinary text', author: `user:${human}` }], hasMore: false } },
    sendMessage: (id, body, expectedVersion) => { record('sendMessage', id, body, expectedVersion); if (expectedVersion !== version) throw new Error('Private current revision'); return { chatId: id, messageId: 'message_2', version: 'next-opaque-revision' } },
    updateChat: (id, patch, expectedVersion) => { record('updateChat', id, patch, expectedVersion); return { ...metadata(id), ...patch, labels: [...(patch.labels ?? [])], version: 'next-opaque-revision' } },
    deleteChat: (id, expectedVersion) => { record('deleteChat', id, expectedVersion); visible.delete(id); return { id, deleted: true } },
    getMembers: (id) => { record('getMembers', id); return members(id) },
    addMembers: (id, actors, expectedVersion) => { record('addMembers', id, actors, expectedVersion); return members(id) },
    removeMember: (id, actor, expectedVersion) => { record('removeMember', id, actor, expectedVersion); return members(id) },
    search: (query, options) => { record('search', query, options); return [{ sessionId: 'legacy-chat_1', title: 'Visible chat', matchCount: 1, matches: [{ sessionId: 'legacy-chat_1', lineNumber: 2, snippet: 'Visible full-text hit' }] }] },
  }
  const tools = createMastraChatManagementTools(scope)
  return { scope, tools, visible, calls, setUser: (value: string) => { userId = value }, revokeHuman: () => { humanActive = false }, revokeAgent: () => { agentActive = false }, revokeAudience: () => { audienceActive = false } }
}

type Tools = ReturnType<typeof createMastraChatManagementTools>
const call = async (tools: Tools, name: keyof Tools, input: unknown): Promise<unknown> => tools[name].execute!(input as never, {} as never)
const rejection = async (pending: Promise<unknown>) => pending.then(() => { throw new Error('Expected rejection') }, (error: unknown) => error)

it('registers exactly the requested tools and classifies every write as sensitive without an allow bypass', () => {
  const { tools } = fixture()
  expect(Object.keys(tools)).toHaveLength(9)
  expect(new Set([...CHAT_READ_TOOL_NAMES, ...CHAT_WRITE_TOOL_NAMES])).toEqual(new Set(Object.keys(tools)))
  for (const name of CHAT_WRITE_TOOL_NAMES) expect(CHAT_SENSITIVE_TOOL_NAMES.has(name)).toBe(true)
  expect(CHAT_SENSITIVE_TOOL_NAMES.has('chat_members')).toBe(true)
  for (const name of [...CHAT_DESTRUCTIVE_TOOL_NAMES, ...CHAT_NOTIFICATION_TOOL_NAMES]) expect(CHAT_WRITE_TOOL_NAMES.has(name)).toBe(true)
  expect(CHAT_SENSITIVE_TOOL_NAMES.has('chat_update')).toBe(true)
  for (const tool of Object.values(tools)) expect((tool.inputSchema as z.ZodType).safeParse({ allow: true, workspaceId: 'foreign', provider: 'openai', apiKey: 'not-a-real-key' }).success).toBe(false)
})

it('validates inputs even when invoked directly and rejects path IDs, unsafe patches, unbounded pages and duplicates before callbacks', async () => {
  const f = fixture()
  for (const [name, input] of [
    ['chat_get', { id: '../private' }], ['chat_get', { id: '/server/private' }], ['chat_list', { limit: 51 }], ['chat_list', { offset: 10_001 }],
    ['chat_send', { id: 'legacy-chat_1', body: 'a'.repeat(8_001), expectedVersion: version }], ['chat_send', { id: 'legacy-chat_1', body: ' ', expectedVersion: version }],
    ['chat_update', { id: 'legacy-chat_1', patch: {}, expectedVersion: version }], ['chat_update', { id: 'legacy-chat_1', patch: { permissionMode: 'allow-all' }, expectedVersion: version }],
    ['chat_add_members', { id: 'legacy-chat_1', actors: [`user:${human}`, `user:${human}`], expectedVersion: version }],
    ['chat_remove_member', { id: 'legacy-chat_1', actor: 'user:arbitrary-owner', expectedVersion: version }],
    ['chat_search', { query: 'hit', perChat: 6 }], ['chat_search', { query: 'hit', eligibleIds: ['private-chat'] }],
  ] as const) await expect(call(f.tools, name, input)).rejects.toThrow('Chat operation')
  expect(f.calls).toHaveLength(0)
})

it('accepts UUID and legacy chat IDs while preserving opaque parent revisions and ordinary message text exactly', async () => {
  const f = fixture()
  const id = 'f2a34b98-08c4-4b35-97fa-54d6cd39afe9'
  await call(f.tools, 'chat_get', { id })
  await call(f.tools, 'chat_send', { id, body: '  Unchanged text\n', expectedVersion: version })
  expect(f.calls.find((entry) => entry.name === 'sendMessage')?.args).toEqual([id, '  Unchanged text\n', version])
})

it('denies revoked initiating humans, named agents and receiving audiences before invoking domain callbacks', async () => {
  for (const revoke of ['revokeHuman', 'revokeAgent', 'revokeAudience'] as const) {
    const f = fixture()
    f[revoke]()
    await expect(call(f.tools, 'chat_list', {})).rejects.toThrow('Chat operation')
    expect(f.calls.filter((entry) => entry.name !== 'assertAccess')).toHaveLength(0)
  }
  const f = fixture()
  f.setUser('')
  await expect(call(f.tools, 'chat_members', { id: 'legacy-chat_1' })).rejects.toThrow('Chat operation')
  expect(f.calls).toHaveLength(0)
})

it('rechecks target visibility after an awaited read and never returns a revoked private name', async () => {
  const f = fixture()
  f.scope.getChat = async (id) => {
    await Promise.resolve()
    f.visible.delete(id)
    return { chat: { ...metadata(id), title: 'Revoked private title' }, messages: [], hasMore: false }
  }
  const error = await rejection(call(f.tools, 'chat_get', { id: 'legacy-chat_1' }))
  expect(String(error)).toContain('Chat operation')
  expect(String(error)).not.toContain('Revoked private title')
  expect(String(error)).not.toContain('/private/server/path')
})

it('rejects a changed initiating human across callback and access-check awaits', async () => {
  const f = fixture()
  f.scope.getMembers = async (id) => {
    await Promise.resolve()
    f.setUser(otherHuman)
    return { id, version, members: [] }
  }
  await expect(call(f.tools, 'chat_members', { id: 'legacy-chat_1' })).rejects.toThrow('Chat operation')
  const g = fixture()
  g.scope.assertAccess = async () => { await Promise.resolve(); g.setUser(otherHuman) }
  await expect(call(g.tools, 'chat_list', {})).rejects.toThrow('Chat operation')
  expect(g.calls).toHaveLength(0)
})

it('does not reveal private counts, names or snippets from incorrect trusted callback results', async () => {
  const f = fixture()
  f.scope.listChats = () => ({ total: 99, chats: [{ ...metadata('private-chat'), title: 'Private list name' }] })
  f.scope.search = () => [{ sessionId: 'private-chat', title: 'Private search name', matchCount: 99, matches: [{ sessionId: 'private-chat', lineNumber: 1, snippet: 'Private snippet' }] }]
  for (const [name, input] of [['chat_list', {}], ['chat_search', { query: 'needle' }]] as const) {
    const error = await rejection(call(f.tools, name, input))
    expect(String(error)).toContain('Chat operation')
    for (const hidden of ['99', 'Private', 'private-chat', '/private/server/path']) expect(String(error)).not.toContain(hidden)
  }
})

it('passes full-text queries and bounded options to the trusted existing-history search once', async () => {
  const f = fixture()
  const result = await call(f.tools, 'chat_search', { query: '  phrase inside messages  ', limit: 1, offset: 3, perChat: 2 })
  expect(f.calls.filter((entry) => entry.name === 'search')).toEqual([{ name: 'search', args: ['phrase inside messages', { limit: 1, offset: 3, perChat: 2 }] }])
  expect(result).toEqual([{ sessionId: 'legacy-chat_1', title: 'Visible chat', matchCount: 1, matches: [{ sessionId: 'legacy-chat_1', lineNumber: 2, snippet: 'Visible full-text hit' }] }])
})

it('rechecks an entire result page in one immutable live access call after the search await', async () => {
  const f = fixture()
  const secondId = 'f2a34b98-08c4-4b35-97fa-54d6cd39afe9'
  f.scope.search = async () => {
    await Promise.resolve()
    return ['legacy-chat_1', secondId].map((sessionId) => ({ sessionId, title: 'Visible chat', matchCount: 1, matches: [] }))
  }
  await call(f.tools, 'chat_search', { query: 'history' })
  expect(f.calls.filter((entry) => entry.name === 'assertAccess').map((entry) => entry.args)).toEqual([[undefined], [['legacy-chat_1', secondId]]])
  expect(Object.isFrozen(f.calls.at(-1)!.args[0])).toBe(true)
  const check = f.scope.assertAccess
  f.scope.assertAccess = async (ids) => {
    await Promise.resolve()
    if (ids?.length) f.visible.delete(ids[0]!)
    await check(ids)
  }
  await expect(call(f.tools, 'chat_search', { query: 'history' })).rejects.toThrow('Chat operation')
})

it('strips non-DTO paths, provider credentials, branch config and hidden prompt fields from results', async () => {
  const f = fixture()
  f.scope.getChat = () => ({ chat: { ...metadata(), workspaceRootPath: '/server/private', permissionMode: 'allow-all', branchFromMessageId: 'ordinary-legacy-branch', credentials: 'private-value' }, messages: [{ id: 'message_1', role: 'assistant', content: 'Ordinary answer', systemPrompt: 'private-prompt', toolResult: 'private-tool-result' }], hasMore: false, rawRuntime: 'private-runtime' })
  const result = await call(f.tools, 'chat_get', { id: 'legacy-chat_1' })
  expect(result).toEqual({ chat: metadata(), messages: [{ id: 'message_1', role: 'assistant', content: 'Ordinary answer' }], hasMore: false })
})

it('rejects system/auth/tool rows and oversized outputs instead of leaking an unsafe projection', async () => {
  const f = fixture()
  for (const role of ['system', 'auth-request', 'tool']) {
    f.scope.getChat = () => ({ chat: metadata(), messages: [{ id: 'message_1', role, content: 'Private payload' }], hasMore: false }) as unknown as Awaited<ReturnType<MastraChatManagementScope['getChat']>>
    await expect(call(f.tools, 'chat_get', { id: 'legacy-chat_1' })).rejects.toThrow('Chat operation')
  }
  f.scope.getChat = () => ({ chat: metadata(), messages: Array.from({ length: 20 }, (_, i) => ({ id: `message_${i}`, role: 'assistant', content: 'x'.repeat(8_000) })), hasMore: false })
  await expect(call(f.tools, 'chat_get', { id: 'legacy-chat_1' })).rejects.toThrow('Chat operation')
})

it('rejects mismatched targets, malformed search snippets and callback pages beyond requested limits', async () => {
  const f = fixture()
  f.scope.getChat = () => ({ chat: metadata('private-chat'), messages: [], hasMore: false })
  await expect(call(f.tools, 'chat_get', { id: 'legacy-chat_1' })).rejects.toThrow('Chat operation')
  f.scope.search = () => [{ sessionId: 'legacy-chat_1', title: 'Visible', matchCount: 1, matches: [{ sessionId: 'private-chat', lineNumber: 1, snippet: 'Hidden' }] }]
  await expect(call(f.tools, 'chat_search', { query: 'hit' })).rejects.toThrow('Chat operation')
  f.scope.listChats = () => ({ total: 2, chats: [metadata(), metadata('f2a34b98-08c4-4b35-97fa-54d6cd39afe9')] })
  await expect(call(f.tools, 'chat_list', { limit: 1 })).rejects.toThrow('Chat operation')
})

it('freezes callback arguments without freezing or mutating caller-owned input', async () => {
  const f = fixture()
  f.scope.updateChat = (id, patch) => {
    expect(Object.isFrozen(patch)).toBe(true)
    expect(Object.isFrozen(patch.labels)).toBe(true)
    expect(() => (patch.labels as string[]).push('mutated')).toThrow()
    return { ...metadata(id), labels: [...(patch.labels ?? [])] }
  }
  const input = { id: 'legacy-chat_1', patch: { labels: ['approved'] }, expectedVersion: version }
  await call(f.tools, 'chat_update', input)
  expect(Object.isFrozen(input.patch.labels)).toBe(false)
  expect(input.patch.labels).toEqual(['approved'])
  f.scope.addMembers = (id, actors) => { expect(Object.isFrozen(actors)).toBe(true); return { id, version, members: [] } }
  await call(f.tools, 'chat_add_members', { id: 'legacy-chat_1', actors: [`user:${otherHuman}`], expectedVersion: version })
  f.scope.listChats = (options) => { expect(Object.isFrozen(options)).toBe(true); return { total: 0, chats: [] } }
  await call(f.tools, 'chat_list', {})
})

it('delegates every mutation exactly once with the original version and no provider or ownership promotion', async () => {
  const f = fixture()
  await call(f.tools, 'chat_update', { id: 'legacy-chat_1', patch: { title: 'Updated', status: 'done', labels: ['label::value'], projectId: null }, expectedVersion: version })
  await call(f.tools, 'chat_add_members', { id: 'legacy-chat_1', actors: [`user:${otherHuman}`], expectedVersion: version })
  await call(f.tools, 'chat_remove_member', { id: 'legacy-chat_1', actor: `user:${otherHuman}`, expectedVersion: version })
  await call(f.tools, 'chat_delete', { id: 'legacy-chat_1', expectedVersion: version })
  for (const name of ['updateChat', 'addMembers', 'removeMember', 'deleteChat']) {
    const entries = f.calls.filter((entry) => entry.name === name)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.args.at(-1)).toBe(version)
  }
})

it('leaves expectedVersion comparison with the trusted callback and never sends on a stale revision', async () => {
  const f = fixture()
  const error = await rejection(call(f.tools, 'chat_send', { id: 'legacy-chat_1', body: 'Hello', expectedVersion: 'stale-parent-revision' }))
  expect(String(error)).toContain('Chat operation')
  expect(String(error)).not.toContain('Private current revision')
  expect(f.calls.filter((entry) => entry.name === 'sendMessage')).toHaveLength(1)
})

it('lets the trusted callback reject ownership or version changes at the effect boundary after an await', async () => {
  for (const change of ['owner', 'version'] as const) {
    const f = fixture()
    let owner = human
    let currentVersion = version
    let effects = 0
    f.scope.updateChat = async (id, _patch, expectedVersion) => {
      await Promise.resolve()
      if (change === 'owner') owner = otherHuman
      else currentVersion = 'new-parent-revision'
      if (owner !== f.scope.getUserId() || currentVersion !== expectedVersion) throw new Error('Private current ownership or revision')
      effects++
      return metadata(id)
    }
    await expect(call(f.tools, 'chat_update', { id: 'legacy-chat_1', patch: { status: 'done' }, expectedVersion: version })).rejects.toThrow('Chat operation')
    expect(effects).toBe(0)
  }
})

it('never double-sends when access is revoked after dispatch and redacts callback exceptions', async () => {
  const f = fixture()
  let sends = 0
  f.scope.sendMessage = async (id) => {
    sends++
    await Promise.resolve()
    f.revokeAudience()
    return { chatId: id, messageId: 'sent-message', version: 'next' }
  }
  await expect(call(f.tools, 'chat_send', { id: 'legacy-chat_1', body: 'Hello', expectedVersion: version })).rejects.toThrow('do not automatically retry a send')
  expect(sends).toBe(1)
  const g = fixture()
  g.scope.getMembers = () => { throw new Error('Credentials and /private/path and private-name') }
  const error = await rejection(call(g.tools, 'chat_members', { id: 'legacy-chat_1' }))
  for (const hidden of ['Credentials', '/private/path', 'private-name']) expect(String(error)).not.toContain(hidden)
})
