import { createTool } from '@mastra/core/tools'
import { isActor } from '@otto/shared/actors'
import { z } from 'zod'

export const CHAT_READ_TOOL_NAMES = new Set(['chat_list', 'chat_get', 'chat_members', 'chat_search'])
export const CHAT_WRITE_TOOL_NAMES = new Set(['chat_send', 'chat_update', 'chat_delete', 'chat_add_members', 'chat_remove_member'])
export const CHAT_DESTRUCTIVE_TOOL_NAMES = new Set(['chat_delete', 'chat_remove_member'])
export const CHAT_SENSITIVE_TOOL_NAMES = new Set([...CHAT_WRITE_TOOL_NAMES, 'chat_members'])
export const CHAT_NOTIFICATION_TOOL_NAMES = new Set(['chat_send', 'chat_delete', 'chat_add_members', 'chat_remove_member'])

export const CHAT_MANAGEMENT_CALLBACK_REQUIREMENTS = [
  'Native registration and explicit approval of every sensitive tool, even in Allow-all, belong to the parent policy. This includes all status updates, sends, member reads/changes and deletions; no allow flag is accepted here.',
  'assertAccess(chatIds?) must check the live initiating human, named workspace agent and complete receiving audience; every supplied chat ID must satisfy their current visibility intersection in one live check after any internal await, without revealing its existence or name on failure.',
  'Every callback must revalidate that intersection and current target ownership immediately before effects and after internal awaits. Writes must atomically compare the opaque expectedVersion with the current parent-owned revision; versions must cover membership and metadata changes.',
  'listChats and search must restrict eligible chat IDs before pagination, ranking and counts. Search uses the existing full-text domain, not title-only search or post-filtering private results.',
  'getChat returns only ordinary human/assistant text approved for this audience, never system/auth prompts, tool payloads, raw server paths, credentials or hidden runtime configuration. Member names and search snippets need the same audience-safe projection.',
  'Callbacks own existing domain mutations, durable message dispatch and publication. This factory neither retries nor creates an alternate history, bus, registry, branch or timestamp-derived version. A post-effect access failure must never trigger an automatic resend.',
  'deleteChat must revalidate target visibility and ownership before deletion and before completing; only source-scope access can be rechecked after the target no longer exists.',
] as const

const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
const version = z.string().min(1).max(256).regex(/^[^\u0000-\u001f\u007f]+$/)
const status = z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const label = z.string().min(1).max(500)
const labels = z.array(label).max(50).refine((values) => new Set(values).size === values.length, 'Duplicate labels')
const actor = z.string().max(135).refine(isActor, 'Use an existing user or agent actor')
const title = z.string().min(1).max(500)
const total = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const page = { limit: z.number().int().min(1).max(50).default(20), offset: z.number().int().min(0).max(10_000).default(0) }
const metadata = z.object({ id, title: title.nullable(), status, labels, projectId: id.nullable(), version })
const memberResult = z.object({ id, version, members: z.array(z.object({ actor, name: title })).max(100) })
const listInput = z.object({ ...page, status: status.optional(), label: label.optional(), projectId: id.optional(), search: z.string().trim().min(1).max(200).optional(), sortBy: z.enum(['name', 'status', 'lastUsed']).optional() }).strict()
const getOptions = z.object({ limit: z.number().int().min(1).max(40).default(20), beforeId: id.optional() }).strict()
const patch = z.object({ title: title.optional(), status: status.optional(), labels: labels.optional(), projectId: id.nullable().optional() }).strict().refine((value) => Object.keys(value).length > 0, 'Provide a field to update')
const searchOptions = z.object({ ...page, perChat: z.number().int().min(1).max(5).default(3) }).strict()
const listResult = z.object({ total, chats: z.array(metadata).max(50) })
const getResult = z.object({ chat: metadata, messages: z.array(z.object({ id, role: z.enum(['user', 'assistant']), content: z.string().max(8_000), author: actor.optional() })).max(40), hasMore: z.boolean() })
const sendResult = z.object({ chatId: id, messageId: id, version })
const deleteResult = z.object({ id, deleted: z.literal(true) })
const searchResult = z.array(z.object({ sessionId: id, title: title.nullable(), matchCount: total, matches: z.array(z.object({ sessionId: id, lineNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), snippet: z.string().max(1_000) })).max(5) })).max(50)

type MaybePromise<T> = T | Promise<T>
export type ChatManagementMetadata = z.infer<typeof metadata>
export type ChatManagementMembers = z.infer<typeof memberResult>
export type ChatManagementListOptions = Readonly<z.infer<typeof listInput>>
export type ChatManagementGetOptions = Readonly<z.infer<typeof getOptions>>
export type ChatManagementPatch = Readonly<Omit<z.infer<typeof patch>, 'labels'> & { labels?: readonly string[] }>
export type ChatManagementSearchOptions = Readonly<z.infer<typeof searchOptions>>
export type ChatManagementSearchResults = z.infer<typeof searchResult>

export interface MastraChatManagementScope {
  workspaceId: string
  agentId: string
  assertAccess: (chatIds?: readonly string[]) => MaybePromise<void>
  getUserId: () => string
  listChats: (options: ChatManagementListOptions) => MaybePromise<z.infer<typeof listResult>>
  getChat: (id: string, options: ChatManagementGetOptions) => MaybePromise<z.infer<typeof getResult>>
  sendMessage: (id: string, body: string, expectedVersion: string) => MaybePromise<z.infer<typeof sendResult>>
  updateChat: (id: string, patch: ChatManagementPatch, expectedVersion: string) => MaybePromise<ChatManagementMetadata>
  deleteChat: (id: string, expectedVersion: string) => MaybePromise<z.infer<typeof deleteResult>>
  getMembers: (id: string) => MaybePromise<ChatManagementMembers>
  addMembers: (id: string, actors: readonly string[], expectedVersion: string) => MaybePromise<ChatManagementMembers>
  removeMember: (id: string, actor: string, expectedVersion: string) => MaybePromise<ChatManagementMembers>
  search: (query: string, options: ChatManagementSearchOptions) => MaybePromise<ChatManagementSearchResults>
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

function callbackTool<T extends z.ZodType, R>(options: { id: string; description: string; inputSchema: T; strict?: boolean; execute: (input: z.infer<T>) => Promise<R> }) {
  const tool = createTool({ ...options, execute: async (input) => options.execute(freeze(options.inputSchema.parse(input))) })
  const execute = tool.execute!
  tool.execute = async (input, context) => {
    try {
      const result = await execute(options.inputSchema.parse(input) as typeof input, context)
      if (result && typeof result === 'object' && 'error' in result && result.error === true) throw new Error('Native validation failed')
      return result
    } catch {
      throw new Error('Chat operation unavailable, denied or changed. Reload before any new write; do not automatically retry a send.')
    }
  }
  return tool
}

export function createMastraChatManagementTools(scope: MastraChatManagementScope) {
  id.parse(scope.workspaceId)
  id.parse(scope.agentId)
  const currentUser = () => id.parse(scope.getUserId())
  const access = async (userId: string, chatIds?: readonly string[]) => {
    if (currentUser() !== userId) throw new Error('Access changed')
    await scope.assertAccess(chatIds)
    if (currentUser() !== userId) throw new Error('Access changed')
  }
  const run = async <T>(chatId: string | undefined, output: z.ZodType<T>, callback: () => MaybePromise<T>, resultIds: (result: T) => string[] = () => [], deleted = false) => {
    try {
      const userId = currentUser()
      await access(userId, chatId ? freeze([chatId]) : undefined)
      const raw = await callback()
      const result = output.parse(raw)
      const ids = resultIds(result)
      if (new Set(ids).size !== ids.length) throw new Error('Duplicate chat results')
      const targets = [...new Set([...ids, ...(chatId && !deleted ? [chatId] : [])])]
      await access(userId, targets.length ? freeze(targets) : undefined)
      if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 65_536) throw new Error('Output exceeds budget')
      return result
    } catch {
      throw new Error('Chat operation unavailable, denied or changed. Reload before any new write; do not automatically retry a send.')
    }
  }
  const target = <T>(chatId: string, result: T, actualId: string) => {
    if (actualId !== chatId) throw new Error('Unexpected chat result')
    return result
  }

  return {
    chat_list: callbackTool({ id: 'chat_list', description: 'List audience-visible internal chat metadata with an opaque write version. Counts and pagination include only eligible chats.', inputSchema: listInput, execute: async (input) => {
      const options = freeze(listInput.parse(input))
      return run(undefined, listResult, async () => {
        const result = await scope.listChats(options)
        if (result.chats.length > options.limit || result.total < result.chats.length) throw new Error('Invalid page')
        return result
      }, (result) => result.chats.map((chat) => chat.id))
    } }),
    chat_get: callbackTool({ id: 'chat_get', description: 'Read a bounded page of audience-safe human/assistant text and metadata. No system prompts, tool payloads or runtime configuration.', inputSchema: getOptions.extend({ id }).strict(), execute: async (input) => {
      const { id: chatId, ...options } = getOptions.extend({ id }).strict().parse(input)
      return run(chatId, getResult, async () => {
        const result = await scope.getChat(chatId, freeze(options))
        if (result.messages.length > options.limit) throw new Error('Invalid page')
        return target(chatId, result, result.chat.id)
      })
    } }),
    chat_send: callbackTool({ id: 'chat_send', description: 'Send one ordinary text message through the existing server-owned dispatcher after explicit approval, even in Allow-all. Requires the opaque read version; never automatically retry.', inputSchema: z.object({ id, body: z.string().min(1).max(8_000).refine((value) => value.trim().length > 0), expectedVersion: version }).strict(), execute: async (input) => run(input.id, sendResult, async () => {
      const result = await scope.sendMessage(input.id, input.body, input.expectedVersion)
      return target(input.id, result, result.chatId)
    }) }),
    chat_update: callbackTool({ id: 'chat_update', strict: false, description: 'Update only title, status, labels or project association after explicit approval, even in Allow-all (including closed statuses). Requires the opaque read version; cannot promote permissions or edit providers.', inputSchema: z.object({ id, patch, expectedVersion: version }).strict(), execute: async (input) => {
      const change = freeze(patch.parse(input.patch))
      return run(input.id, metadata, async () => {
        const result = await scope.updateChat(input.id, change, input.expectedVersion)
        return target(input.id, result, result.id)
      })
    } }),
    chat_delete: callbackTool({ id: 'chat_delete', description: 'Delete an owned audience-visible chat through its existing domain after explicit approval, even in Allow-all. Requires the opaque read version.', inputSchema: z.object({ id, expectedVersion: version }).strict(), execute: async (input) => run(input.id, deleteResult, async () => {
      const result = await scope.deleteChat(input.id, input.expectedVersion)
      return target(input.id, result, result.id)
    }, undefined, true) }),
    chat_members: callbackTool({ id: 'chat_members', description: 'Read audience-visible member actors and display names after explicit approval, even in Allow-all, with the opaque membership write version.', inputSchema: z.object({ id }).strict(), execute: async (input) => run(input.id, memberResult, async () => {
      const result = await scope.getMembers(input.id)
      return target(input.id, result, result.id)
    }) }),
    chat_add_members: callbackTool({ id: 'chat_add_members', description: 'Add existing workspace people or agents after explicit approval, even in Allow-all. The server must authorize ownership and existing history disclosure to the new audience.', inputSchema: z.object({ id, actors: z.array(actor).min(1).max(20).refine((values) => new Set(values).size === values.length, 'Duplicate actors'), expectedVersion: version }).strict(), execute: async (input) => run(input.id, memberResult, async () => {
      const result = await scope.addMembers(input.id, freeze([...input.actors]), input.expectedVersion)
      return target(input.id, result, result.id)
    }) }),
    chat_remove_member: callbackTool({ id: 'chat_remove_member', description: 'Remove a removable member after explicit approval, even in Allow-all. The existing creator, primary-agent and direct-message protections remain enforced by the server.', inputSchema: z.object({ id, actor, expectedVersion: version }).strict(), execute: async (input) => run(input.id, memberResult, async () => {
      const result = await scope.removeMember(input.id, input.actor, input.expectedVersion)
      return target(input.id, result, result.id)
    }) }),
    chat_search: callbackTool({ id: 'chat_search', description: 'Full-text search ordinary eligible chat history with bounded snippets. The server must intersect human, named agent and receiving-audience visibility before ranking, pagination or match counts.', inputSchema: searchOptions.extend({ query: z.string().trim().min(1).max(500) }).strict(), execute: async (input) => {
      const { query, ...options } = searchOptions.extend({ query: z.string().trim().min(1).max(500) }).strict().parse(input)
      return run(undefined, searchResult, async () => {
        const result = await scope.search(query, freeze(options))
        if (result.length > options.limit || result.some((chat) => chat.matches.length > options.perChat || chat.matches.some((match) => match.sessionId !== chat.sessionId) || chat.matchCount < chat.matches.length)) throw new Error('Invalid search page')
        return result
      }, (result) => result.map((chat) => chat.sessionId))
    } }),
  }
}
