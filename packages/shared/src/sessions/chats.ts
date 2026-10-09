import { and, eq, inArray, sql } from 'drizzle-orm'
import { basename } from 'node:path'
import { ENTITY_TOKEN } from '../entities.ts'
import { initDb, type Db, type Tx } from '../db/index.ts'
import { getEntitiesLabels, removeEntityLabels, setEntityLabels } from '../labels/entities.ts'
import { getStatusRow, getStatusesById } from '../statuses/storage.ts'
import { expandPath, toPortablePath } from '../utils/paths.ts'
import { deleteMessages } from './messages.ts'
import { deleteChatMembers, updateMembersAgent } from './members.ts'
import type { PiSessionRef } from './pi-session-sync.ts'
import { chats, chatsMembers } from './schema.ts'
import { assertHistoryRuntime } from './native-messages.ts'
import type { SessionConfig, SessionMetadata, SessionTokenUsage } from './types.ts'

/**
 * The `chats` rows (docs/schema.md "Chats"): how a chat's fields map to columns, the list read with its derived
 * fields, and the notice other domains give when they change chats. A `SessionConfig` field is a column when SQL
 * filters or orders on it, otherwise it is in `metadata` (`ChatMetadata`):
 *
 *   name -> title, isFlagged -> pinned_at, sessionStatus -> status_id (a `statuses` row; archived = its category),
 *   lastMessageAt -> updated_at, labels -> `labels_entities` ('chat:<id>'), dmKey -> dm_key (set once, at creation),
 *   parentSessionId / a branch's parent -> origin 'chat:<id>', triggeredBy.automationId -> origin 'routine:<id>'.
 *
 * `hidden` and `archivedAt` are gone (no hidden chats; archived is the status). `lastUsedAt` reads as `updated_at`.
 * Members and their read state are `chats_members` rows (./members.ts); unread is per member, not on the chat.
 */

/**
 * Where one agent of a chat stands (docs/final-plan.md 2.3 "Multiplayer"): `seen` is the last message `position`
 * already given to it; `sdkSessionId` and `piSession` are its own Pi session (the primary agent keeps them in
 * `metadata.sdkSessionId` / `metadata.piSession` as before, so a one-agent chat is unchanged).
 */
export interface AgentCursor {
  seen?: number
  sdkSessionId?: string
  piSession?: PiSessionRef
}

/** What `metadata` holds: everything about a chat that no query filters on. */
export interface ChatMetadata {
  sdkSessionId?: string
  piSession?: SessionConfig['piSession']
  model?: string
  llmConnection?: string
  llmConnectionId?: string
  connectionLocked?: boolean
  thinkingLevel?: SessionConfig['thinkingLevel']
  permissionMode?: SessionConfig['permissionMode']
  previousPermissionMode?: SessionConfig['previousPermissionMode']
  workingDirectory?: string
  enabledSourceSlugs?: string[]
  sharedUrl?: string
  sharedId?: string
  /** Each agent's cursor and Pi session, by agent id. */
  agents?: Record<string, AgentCursor>
  pendingPlanExecution?: SessionConfig['pendingPlanExecution']
  lastReadMessageId?: string
  branchFromMessageId?: string
  branchFromSdkSessionId?: string
  branchFromSessionPath?: string
  branchFromSdkTurnId?: string
  transferredSessionSummary?: string
  transferredSessionSummaryApplied?: boolean
  contextSummary?: string
  contextThroughId?: string
  contextEntity?: string
  /** The automation run that made the chat, without its id (that is `origin`). */
  triggeredBy?: Omit<NonNullable<SessionConfig['triggeredBy']>, 'automationId'>
  tokenUsage?: SessionTokenUsage
}

const METADATA_KEYS = [
  'sdkSessionId', 'piSession', 'model', 'llmConnection', 'llmConnectionId', 'connectionLocked', 'thinkingLevel', 'permissionMode', 'previousPermissionMode',
  'workingDirectory', 'enabledSourceSlugs', 'sharedUrl', 'sharedId', 'agents', 'pendingPlanExecution', 'lastReadMessageId',
  'branchFromMessageId', 'branchFromSdkSessionId', 'branchFromSessionPath', 'branchFromSdkTurnId',
  'transferredSessionSummary', 'transferredSessionSummaryApplied',
  'contextSummary', 'contextThroughId', 'contextEntity',
] as const satisfies readonly (keyof ChatMetadata)[]

/** A chat as the write path hands it over: its config fields plus what only the running server knows. */
export interface ChatSnapshot extends SessionConfig {
  workspaceId: string
  /** Each agent's cursor (`ChatMetadata.agents`). */
  agents?: Record<string, AgentCursor>
  tokenUsage?: SessionTokenUsage
  /** A turn is running: `run_started_at` stays set until a snapshot says it stopped. */
  running?: boolean
}

export function getLinkedPageChatId(workspaceId: string, contextEntity: string, db: Db = initDb()): string | undefined {
  return db.select({ id: chats.id, metadata: chats.metadata }).from(chats).where(eq(chats.workspaceId, workspaceId)).orderBy(chats.createdAt, chats.id).all()
    .find((row) => {
      try { return JSON.parse(row.metadata ?? '{}')?.contextEntity === contextEntity }
      catch { return false }
    })?.id
}

function toOrigin(chat: SessionConfig): string | null {
  if (chat.triggeredBy?.automationId) return `routine:${chat.triggeredBy.automationId}`
  if (chat.parentSessionId) return `chat:${chat.parentSessionId}`
  if (chat.branchFromSessionPath) return `chat:${basename(chat.branchFromSessionPath)}`
  return null
}

function toMetadata(chat: ChatSnapshot): string {
  const metadata: Record<string, unknown> = {}
  for (const key of METADATA_KEYS) if (chat[key] !== undefined) metadata[key] = chat[key]
  if (typeof metadata.workingDirectory === 'string') metadata.workingDirectory = toPortablePath(metadata.workingDirectory)
  if (chat.triggeredBy) {
    const { automationId: _id, ...triggeredBy } = chat.triggeredBy
    metadata.triggeredBy = triggeredBy
  }
  if (chat.tokenUsage) metadata.tokenUsage = chat.tokenUsage
  return JSON.stringify(metadata)
}

/** The status row id of a slug (null for none or an unknown slug). */
function statusIdOf(workspaceId: string, slug: string | undefined, db: Db | Tx): string | null {
  return slug ? (getStatusRow(workspaceId, slug, db)?.id ?? null) : null
}

/**
 * Inserts or updates a chat's row and, when `labels` is given, its labels, inside the caller's transaction.
 * `newestAt` is the newest user or final assistant message just written: `updated_at` never moves back.
 * `created_by` and `created_at` are set once. A row of another workspace with this id is left alone.
 */
export function writeChat(tx: Db | Tx, chat: ChatSnapshot, { newestAt = 0, labels }: { newestAt?: number; labels?: string[] } = {}): void {
  const now = Date.now()
  const updatedAt = Math.max(chat.lastMessageAt ?? 0, newestAt, chat.createdAt)
  const values = {
    id: chat.id,
    workspaceId: chat.workspaceId,
    title: chat.name ?? null,
    createdBy: chat.createdBy ?? '',
    agentId: chat.agentId ?? null,
    statusId: statusIdOf(chat.workspaceId, chat.sessionStatus, tx),
    projectId: chat.projectId ?? null,
    origin: toOrigin(chat),
    dmKey: chat.dmKey ?? null,
    pinnedAt: chat.isFlagged ? new Date(now) : null,
    runStartedAt: chat.running ? new Date(now) : null,
    metadata: toMetadata(chat),
    createdAt: new Date(chat.createdAt),
    updatedAt: new Date(updatedAt),
  }
  tx.insert(chats)
    .values(values)
    .onConflictDoUpdate({
      target: chats.id,
      set: {
        title: values.title,
        agentId: values.agentId,
        statusId: values.statusId,
        projectId: values.projectId,
        origin: values.origin,
        // a pin and a running turn keep the moment they began
        pinnedAt: values.pinnedAt ? sql`coalesce(${chats.pinnedAt}, ${now})` : null,
        runStartedAt: values.runStartedAt ? sql`coalesce(${chats.runStartedAt}, ${now})` : null,
        metadata: values.metadata,
        updatedAt: sql`max(${chats.updatedAt}, ${updatedAt})`,
      },
      setWhere: eq(chats.workspaceId, chat.workspaceId),
    })
    .run()
  if (labels) {
    const skipped = setEntityLabels(chat.workspaceId, `chat:${chat.id}`, labels, tx)
    if (skipped.length) console.warn(`[chats] ${chat.id}: labels the workspace does not have were not saved: ${skipped.join(', ')}`)
  }
}

type ChatRow = typeof chats.$inferSelect

interface ListRow {
  id: string
  message_count: number
  last_type: string | null
  first_user: string | null
  last_final_id: string | null
}

/** The first user message as the list shows it: special blocks, tags and mentions out, whitespace collapsed, 150 characters. */
export function toPreview(text: string | null | undefined): string | undefined {
  if (!text) return undefined
  const clean = text
    .replace(/<edit_request>[\s\S]*?<\/edit_request>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\[skill:(?:[\w-]+:)?[\w-]+\]/g, '')
    .replace(/\[source:[\w-]+\]/g, '')
    .replace(/\[file:[^\]]+\]/g, '')
    .replace(/\[folder:[^\]]+\]/g, '')
    .replace(ENTITY_TOKEN, '')
    .replace(/\s+/g, ' ')
    .trim()
  return clean.substring(0, 150) || undefined
}

const LIST_ROLES = new Set(['user', 'assistant', 'plan', 'tool', 'error'])

function toMetadataFields(row: ChatRow): Partial<SessionMetadata> & Record<string, unknown> {
  let metadata: ChatMetadata = {}
  try {
    metadata = row.metadata ? (JSON.parse(row.metadata) as ChatMetadata) : {}
  } catch {
    console.warn(`[chats] ${row.id}: unreadable metadata, read as empty`)
  }
  const { triggeredBy, workingDirectory, ...rest } = metadata
  const routine = row.origin?.startsWith('routine:') ? row.origin.slice('routine:'.length) : undefined
  const parent = row.origin?.startsWith('chat:') && !metadata.branchFromMessageId ? row.origin.slice('chat:'.length) : undefined
  return {
    ...rest,
    ...(workingDirectory && { workingDirectory: expandPath(workingDirectory) }),
    ...((triggeredBy || routine) && { triggeredBy: { ...triggeredBy, ...(routine && { automationId: routine }) } }),
    ...(parent && { parentSessionId: parent }),
  }
}

/**
 * The chats of a workspace as the list needs them, newest first, with the fields derived from their messages
 * (count, last role, first user message as the preview, last final assistant message), each a subquery on the
 * (chat_id, position) index. `actor` bounds it to the chats that actor is a member of; the server's own boot load
 * reads every chat of the workspace.
 */
export function getChats(
  workspaceId: string,
  workspaceRootPath: string,
  { actor, chatId }: { actor?: string; chatId?: string } = {},
  db: Db | Tx = initDb(),
): SessionMetadata[] {
  assertHistoryRuntime(db)
  const rows = db
    .select()
    .from(chats)
    .where(
      and(
        eq(chats.workspaceId, workspaceId),
        actor === undefined ? undefined : inArray(chats.id, db.select({ id: chatsMembers.chatId }).from(chatsMembers).where(and(eq(chatsMembers.workspaceId, workspaceId), eq(chatsMembers.actor, actor)))),
        chatId === undefined ? undefined : eq(chats.id, chatId),
      ),
    )
    .all()
  if (!rows.length) return []
  const derived = new Map(
    db
      .all<ListRow>(true && db.all(sql`SELECT name FROM sqlite_master WHERE name='mastra_messages'`).length ? sql`
        SELECT c.id,
          (SELECT count(*) FROM mastra_messages m WHERE m.thread_id=c.id AND m.resourceId=c.workspace_id) AS message_count,
          (SELECT json_extract(m.content,'$.metadata.otto.type') FROM mastra_messages m WHERE m.thread_id=c.id AND m.resourceId=c.workspace_id ORDER BY CAST(json_extract(m.content,'$.metadata.position') AS INTEGER) DESC LIMIT 1) AS last_type,
          (SELECT json_extract(m.content,'$.metadata.otto.content') FROM mastra_messages m WHERE m.thread_id=c.id AND m.resourceId=c.workspace_id AND json_extract(m.content,'$.metadata.otto.type')='user' ORDER BY CAST(json_extract(m.content,'$.metadata.position') AS INTEGER) LIMIT 1) AS first_user,
          (SELECT json_extract(m.content,'$.metadata.otto.id') FROM mastra_messages m WHERE m.thread_id=c.id AND m.resourceId=c.workspace_id AND json_extract(m.content,'$.metadata.otto.type')='assistant' AND coalesce(json_extract(m.content,'$.metadata.otto.isIntermediate'),0)=0 ORDER BY CAST(json_extract(m.content,'$.metadata.position') AS INTEGER) DESC LIMIT 1) AS last_final_id
        FROM chats c WHERE c.workspace_id=${workspaceId} ${chatId===undefined?sql``:sql`AND c.id=${chatId}`}` : sql`
        SELECT c.id,
          (SELECT count(*) FROM messages m WHERE m.chat_id = c.id) AS message_count,
          (SELECT m.type FROM messages m WHERE m.chat_id = c.id ORDER BY m.position DESC LIMIT 1) AS last_type,
          (SELECT json_extract(m.content, '$.content') FROM messages m WHERE m.chat_id = c.id AND m.type = 'user' ORDER BY m.position LIMIT 1) AS first_user,
          (SELECT m.id FROM messages m WHERE m.chat_id = c.id AND m.type = 'assistant' AND coalesce(json_extract(m.content, '$.isIntermediate'), 0) = 0 ORDER BY m.position DESC LIMIT 1) AS last_final_id
        FROM chats c WHERE c.workspace_id = ${workspaceId} ${chatId === undefined ? sql`` : sql`AND c.id = ${chatId}`}`)
      .map((row) => [row.id, row]),
  )
  const statuses = getStatusesById(workspaceId, db)
  const labels = getEntitiesLabels(workspaceId, 'chat', db)
  return rows
    .map((row) => toSessionMetadata(row, workspaceRootPath, statuses, labels.get(`chat:${row.id}`), derived.get(row.id)))
    .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
}

function toSessionMetadata(
  row: ChatRow,
  workspaceRootPath: string,
  statuses: Map<string, { slug: string; category: string }>,
  labels: string[] | undefined,
  derived: ListRow | undefined,
): SessionMetadata {
  const status = row.statusId ? statuses.get(row.statusId) : undefined
  const updatedAt = row.updatedAt.getTime()
  return {
    ...toMetadataFields(row),
    id: row.id,
    workspaceRootPath,
    ...(row.title != null && { name: row.title }),
    ...(row.createdBy && { createdBy: row.createdBy }),
    ...(row.agentId && { agentId: row.agentId }),
    ...(row.dmKey && { dmKey: row.dmKey }),
    ...(row.projectId && { projectId: row.projectId }),
    createdAt: row.createdAt.getTime(),
    lastUsedAt: updatedAt,
    lastMessageAt: updatedAt,
    isFlagged: row.pinnedAt != null,
    ...(status && { sessionStatus: status.slug }),
    isArchived: status?.category === 'archived',
    ...(labels?.length && { labels }),
    messageCount: derived?.message_count ?? 0,
    ...(derived?.last_type && LIST_ROLES.has(derived.last_type) && { lastMessageRole: derived.last_type as SessionMetadata['lastMessageRole'] }),
    ...(derived?.first_user && { preview: toPreview(derived.first_user) }),
    ...(derived?.last_final_id && { lastFinalMessageId: derived.last_final_id }),
  } as SessionMetadata
}

/** One chat of a workspace with its list fields, or null. */
export function getChat(workspaceId: string, workspaceRootPath: string, chatId: string, db: Db | Tx = initDb()): SessionMetadata | null {
  return getChats(workspaceId, workspaceRootPath, { chatId }, db)[0] ?? null
}

/** The workspace a chat id belongs to, or null (chat ids are unique across workspaces). */
export function getChatWorkspaceId(chatId: string, db: Db | Tx = initDb()): string | null {
  return db.select({ workspaceId: chats.workspaceId }).from(chats).where(eq(chats.id, chatId)).get()?.workspaceId ?? null
}

/** Whether a chat id is taken in any workspace. */
export function hasChat(chatId: string, db: Db | Tx = initDb()): boolean {
  return getChatWorkspaceId(chatId, db) !== null
}

/** Deletes a chat: its messages and their index entries, its labels, its members, its row. The folder is the caller's. */
export function deleteChat(workspaceId: string, chatId: string, db: Db = initDb()): void {
  db.transaction(
    (tx) => {
      deleteMessages(tx, workspaceId, chatId)
      removeEntityLabels(workspaceId, `chat:${chatId}`, tx)
      deleteChatMembers(tx, workspaceId, chatId)
      tx.delete(chats).where(and(eq(chats.workspaceId, workspaceId), eq(chats.id, chatId))).run()
    },
    { behavior: 'immediate' },
  )
}

/** Moves every chat of a status to another (a status being deleted); returns the chats moved. */
export function updateChatsStatus(tx: Db | Tx, workspaceId: string, fromStatusId: string, toStatusId: string | null): string[] {
  return tx
    .update(chats)
    .set({ statusId: toStatusId })
    .where(and(eq(chats.workspaceId, workspaceId), eq(chats.statusId, fromStatusId)))
    .returning({ id: chats.id })
    .all()
    .map((row) => row.id)
}

/**
 * An agent is being deleted: the chats it was primary of move to `toAgentId` (the workspace's next default agent),
 * and it leaves every chat it was a member of. Returns the chats that changed.
 */
export function updateChatsAgent(tx: Db | Tx, workspaceId: string, agentId: string, toAgentId: string | null): string[] {
  const member = tx
    .select({ id: chatsMembers.chatId })
    .from(chatsMembers)
    .where(and(eq(chatsMembers.workspaceId, workspaceId), eq(chatsMembers.actor, `agent:${agentId}`)))
    .all()
    .map((row) => row.id)
  const primary = tx
    .update(chats)
    .set({ agentId: toAgentId })
    .where(and(eq(chats.workspaceId, workspaceId), eq(chats.agentId, agentId)))
    .returning({ id: chats.id })
    .all()
    .map((row) => row.id)
  updateMembersAgent(tx, workspaceId, agentId, toAgentId, primary)
  return [...new Set([...primary, ...member])]
}

/** The fields other domains change on chats, as the server reads them back after a notice. */
export function getChatsFields(workspaceId: string, chatIds: string[], db: Db | Tx = initDb()): Map<string, Pick<SessionMetadata, 'labels' | 'sessionStatus' | 'isArchived' | 'agentId'>> {
  if (!chatIds.length) return new Map()
  const rows = db.select({ id: chats.id, statusId: chats.statusId, agentId: chats.agentId }).from(chats).where(and(eq(chats.workspaceId, workspaceId), inArray(chats.id, chatIds))).all()
  const statuses = getStatusesById(workspaceId, db)
  const labels = getEntitiesLabels(workspaceId, 'chat', db)
  return new Map(
    rows.map((row) => {
      const status = row.statusId ? statuses.get(row.statusId) : undefined
      return [row.id, { labels: labels.get(`chat:${row.id}`) ?? [], sessionStatus: status?.slug, isArchived: status?.category === 'archived', agentId: row.agentId ?? undefined }]
    }),
  )
}

type ChatsListener = (workspaceId: string, chatIds: string[]) => void
const listeners = new Set<ChatsListener>()

/** Hears when another domain changed chats' rows (a label or status deleted, an agent deleted); returns an unsubscribe. */
export function onChatsChange(listener: ChatsListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Tells the listeners (the session manager) that these chats' rows changed outside it; call after the commit. */
export function notifyChatsChange(workspaceId: string, chatIds: string[]): void {
  if (!chatIds.length) return
  for (const listener of listeners) {
    try {
      listener(workspaceId, chatIds)
    } catch (error) {
      console.error('[chats] change listener failed:', error)
    }
  }
}
