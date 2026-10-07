import { sql } from 'drizzle-orm'
import { initDb, type Db, type Tx } from '../db/index.ts'
import { normalizePath } from '../utils/paths.ts'
import type { StoredMessage } from './types.ts'

/**
 * The rows of `messages` and their full-text index `messages_fts` (docs/messages-design.md, docs/schema.md). A row is
 * one stored message: `id`, `type` (its role) and `created_at` (its timestamp) are columns, every other field is the
 * `content` JSON, with the chat folder's absolute path written as `{{SESSION_PATH}}` so a chat survives a moved
 * folder and a branch's copied rows point at the branch's own folder. Only this module and ./chats.ts read these
 * tables; other domains go through ./storage.ts.
 */

const SESSION_PATH_TOKEN = '{{SESSION_PATH}}'

/** Absolute paths of the chat folder (anywhere in the JSON) become the portable token. */
export function makeSessionPathPortable(json: string, sessionDir: string): string {
  if (!sessionDir) return json
  const normalized = normalizePath(sessionDir)
  let result = json.replaceAll(normalized, SESSION_PATH_TOKEN)
  // Windows: JSON escapes `\` as `\\`, so C:\foo is C:\\foo inside a JSON string
  if (sessionDir !== normalized) result = result.replaceAll(sessionDir.replaceAll('\\', '\\\\'), SESSION_PATH_TOKEN)
  return result
}

/** The portable token back to this chat folder's absolute path (no folder: the token stays, e.g. for a bundle). */
export function expandSessionPath(json: string, sessionDir: string): string {
  if (!sessionDir || !json.includes(SESSION_PATH_TOKEN)) return json
  return json.replaceAll(SESSION_PATH_TOKEN, normalizePath(sessionDir))
}

/** A message as a row: what the write path compares and stores. */
export interface MessageRow {
  id: string
  type: string
  createdAt: number
  /** The JSON of every other field, paths made portable. */
  content: string
}

/** Above this a row is cut down (its largest string), so one row stays about 1 MB at most. */
export const MAX_ROW_BYTES = 1_000_000
const TRUNCATED = '\n\n[Truncated for storage]'

/** The largest string field (top level or one level down, e.g. inside `toolInput`), cut to fit the row limit. */
function capRow(fields: Record<string, unknown>, json: string): string {
  let largest: { holder: Record<string, unknown>; key: string; length: number } | undefined
  const visit = (holder: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(holder)) {
      if (typeof value === 'string' && value.length > (largest?.length ?? 0)) largest = { holder, key, length: value.length }
    }
  }
  visit(fields)
  for (const value of Object.values(fields)) if (value && typeof value === 'object' && !Array.isArray(value)) visit(value as Record<string, unknown>)
  if (!largest) return json
  const over = json.length - MAX_ROW_BYTES
  const keep = Math.max(0, largest.length - over - TRUNCATED.length - 1024)
  largest.holder[largest.key] = (largest.holder[largest.key] as string).slice(0, keep) + TRUNCATED
  console.warn(`[messages] a row of ${json.length} bytes was cut to fit (field ${largest.key})`)
  return JSON.stringify(fields)
}

export function toMessageRow(message: StoredMessage, sessionDir: string): MessageRow {
  const { id, type, timestamp, ...fields } = message
  let json = JSON.stringify(fields)
  if (json.length > MAX_ROW_BYTES) json = capRow(structuredClone(fields) as Record<string, unknown>, json)
  return { id, type, createdAt: timestamp ?? Date.now(), content: makeSessionPathPortable(json, sessionDir) }
}

export function fromMessageRow(row: { id: string; type: string; content: string; created_at: number }, sessionDir: string): StoredMessage {
  const fields = JSON.parse(expandSessionPath(row.content, sessionDir)) as Omit<StoredMessage, 'id' | 'type' | 'timestamp'>
  return { id: row.id, type: row.type as StoredMessage['type'], timestamp: row.created_at, ...fields } as StoredMessage
}

/** The only row types `getSearchText` may index (also the prefilter of the boot check and the rebuild). */
const SEARCHABLE_TYPES = ['user', 'assistant']
const searchableTypes = () => sql.join(SEARCHABLE_TYPES.map((type) => sql`${type}`), sql`, `)

/**
 * The text chat search indexes for a row: what a person reads in a user or final assistant message. Intermediate,
 * hidden and still-streaming (`partial`) rows are not searchable; a partial answer is indexed once recovery marks it
 * interrupted. The one place that rule lives: every writer (flush, branch copy, import, recovery) uses it.
 */
export function getSearchText(type: string, fields: Record<string, unknown>): string | null {
  if (!SEARCHABLE_TYPES.includes(type)) return null
  if (fields.isIntermediate || fields.hidden || fields.partial) return null
  return typeof fields.content === 'string' && fields.content.trim() ? fields.content : null
}

/** The first row of a raw query as an object (drizzle's raw `get` returns an array of values). */
function one<T>(db: Db | Tx, query: ReturnType<typeof sql>): T | undefined {
  return db.all<T>(query)[0]
}

const initialized = new WeakSet<object>()

/**
 * `messages_fts` stores its text (no `content=''`/`contentless_delete`, which need SQLite 3.43; this works from 3.35,
 * e.g. macOS 13's 3.39), so a row is deleted by rowid alone on any FTS5 and the boot check can read it back.
 */
const CREATE_SEARCH = `CREATE VIRTUAL TABLE messages_fts USING fts5(text, tokenize='unicode61 remove_diacritics 2', prefix='2 3')`

/**
 * Readies `messages_fts` once per database handle (at boot and on first use). It is keyed by the messages rows'
 * implicit rowid, which a `VACUUM` or a `db:push` table rebuild may renumber (`scripts/db-push.ts` rebuilds the index
 * after a push that touches `messages`), so this also rebuilds it when it is missing, still has the old contentless
 * definition, or fails `isSearchConsistent`.
 */
export function initMessages(db: Db = initDb()): void {
  if (initialized.has(db)) return
  const found = one<{ sql: string }>(db, sql`SELECT sql FROM sqlite_master WHERE name = 'messages_fts'`)
  // A contentless table only exists where SQLite >= 3.43 made it, so that SQLite can drop it
  const current = found && !/contentless_delete|content\s*=\s*''/.test(found.sql)
  if (!current || !db.transaction((tx) => isSearchConsistent(tx))) rebuildMessagesSearch(db)
  initialized.add(db)
}

/**
 * Cheap at boot, in one read snapshot: the index holds as many rows as `getSearchText` finds (a scan of the user and
 * assistant rows, the one full read), and a few searchable rows across the rowid range, plus the last, each have their
 * own text under their rowid. A renumbering that keeps the count is caught by the sample, not proven absent.
 */
function isSearchConsistent(tx: Tx): boolean {
  const types = searchableTypes()
  let searchable = 0
  for (const row of tx.all<{ type: string; content: string }>(sql`SELECT type, content FROM messages WHERE type IN (${types})`)) {
    if (getSearchText(row.type, JSON.parse(row.content) as Record<string, unknown>)) searchable++
  }
  if (one<{ n: number }>(tx, sql`SELECT count(*) AS n FROM messages_fts`)!.n !== searchable) return false
  if (!searchable) return true
  const { lo, hi } = one<{ lo: number; hi: number }>(tx, sql`SELECT min(rowid) AS lo, max(rowid) AS hi FROM messages`)!
  const sample = [0, 0.25, 0.5, 0.75].map((at) =>
    one<{ rowid: number; type: string; content: string }>(tx, sql`SELECT rowid, type, content FROM messages WHERE rowid >= ${Math.floor(lo + (hi - lo) * at)} AND type IN (${types}) ORDER BY rowid LIMIT 1`),
  )
  sample.push(one(tx, sql`SELECT rowid, type, content FROM messages WHERE type IN (${types}) ORDER BY rowid DESC LIMIT 1`))
  return sample.every((row) => {
    if (!row) return true
    const indexed = one<{ text: string }>(tx, sql`SELECT text FROM messages_fts WHERE rowid = ${row.rowid}`)?.text ?? null
    return indexed === getSearchText(row.type, JSON.parse(row.content) as Record<string, unknown>)
  })
}

function indexRow(tx: Db | Tx, rowid: number, type: string, content: string): void {
  tx.run(sql`DELETE FROM messages_fts WHERE rowid = ${rowid}`)
  const text = getSearchText(type, JSON.parse(content) as Record<string, unknown>)
  if (text) tx.run(sql`INSERT INTO messages_fts (rowid, text) VALUES (${rowid}, ${text})`)
}

/**
 * Recreates the whole search index from the rows, in one transaction (also replacing an old contentless table): at
 * boot when `initMessages` finds it wrong, after a `db:push` that touched `messages`, after a `VACUUM`. Returns the
 * number of rows indexed.
 */
export function rebuildMessagesSearch(db: Db = initDb()): number {
  let count = 0
  db.transaction((tx) => {
    tx.run(sql`DROP TABLE IF EXISTS messages_fts`)
    tx.run(sql.raw(CREATE_SEARCH))
    for (const row of tx.all<{ rowid: number; type: string; content: string }>(sql`SELECT rowid, type, content FROM messages WHERE type IN (${searchableTypes()})`)) {
      const text = getSearchText(row.type, JSON.parse(row.content) as Record<string, unknown>)
      if (!text) continue
      tx.run(sql`INSERT INTO messages_fts (rowid, text) VALUES (${row.rowid}, ${text})`)
      count++
    }
  })
  return count
}

/** A row to write: `reposition` gives it the next position (a new row, or one whose timestamp moved). */
export interface MessageUpsert extends MessageRow {
  reposition: boolean
}

/**
 * Writes one chat's changed rows inside the caller's transaction: upserts by (chat_id, id), deletes `removed`, and
 * keeps `messages_fts` in step. New and re-stamped rows take positions after the chat's last one, in the order given
 * (callers sort them by timestamp).
 */
export function writeMessages(tx: Db | Tx, workspaceId: string, chatId: string, upserts: MessageUpsert[], removed: string[]): void {
  let next: number | undefined
  const nextPosition = () => {
    next ??= one<{ p: number }>(tx, sql`SELECT coalesce(max(position), 0) AS p FROM messages WHERE chat_id = ${chatId}`)!.p
    return ++next
  }
  for (const row of upserts) {
    let hit = row.reposition
      ? undefined
      : one<{ rowid: number }>(tx, sql`UPDATE messages SET type = ${row.type}, content = ${row.content} WHERE workspace_id = ${workspaceId} AND chat_id = ${chatId} AND id = ${row.id} RETURNING rowid`)
    if (!hit) {
      const position = nextPosition()
      hit = one<{ rowid: number }>(tx, sql`
        INSERT INTO messages (workspace_id, chat_id, id, position, type, content, created_at)
        VALUES (${workspaceId}, ${chatId}, ${row.id}, ${position}, ${row.type}, ${row.content}, ${row.createdAt})
        ON CONFLICT (chat_id, id) DO UPDATE SET
          type = excluded.type, content = excluded.content,
          position = CASE WHEN messages.created_at <> excluded.created_at THEN excluded.position ELSE messages.position END,
          created_at = excluded.created_at
        RETURNING rowid`)!
    }
    indexRow(tx, hit.rowid, row.type, row.content)
  }
  if (removed.length) {
    for (const { rowid } of tx.all<{ rowid: number }>(sql`DELETE FROM messages WHERE workspace_id = ${workspaceId} AND chat_id = ${chatId} AND id IN (${sql.join(removed.map((id) => sql`${id}`), sql`, `)}) RETURNING rowid`)) {
      tx.run(sql`DELETE FROM messages_fts WHERE rowid = ${rowid}`)
    }
  }
}

/** Every row of a chat, oldest first, as stored (the write path's baseline). */
export function getMessageRows(workspaceId: string, chatId: string, db: Db | Tx = initDb()): { id: string; type: string; content: string; created_at: number }[] {
  return db.all(sql`SELECT id, type, content, created_at FROM messages WHERE workspace_id = ${workspaceId} AND chat_id = ${chatId} ORDER BY position`)
}

/**
 * A page of a chat's messages, oldest first: the newest `limit` rows, or the newest `limit` older than `beforeId`
 * (an id of this chat; an unknown one reads as the end). `olderCount` is how many rows come before the page.
 */
export function getMessagesPage(
  workspaceId: string,
  chatId: string,
  sessionDir: string,
  { beforeId, limit = 50 }: { beforeId?: string; limit?: number } = {},
  db: Db | Tx = initDb(),
): { messages: StoredMessage[]; olderCount: number } {
  const before = beforeId
    ? sql`AND position < coalesce((SELECT position FROM messages WHERE workspace_id = ${workspaceId} AND chat_id = ${chatId} AND id = ${beforeId}), 0)`
    : sql``
  const rows = db.all<{ id: string; type: string; content: string; created_at: number; position: number }>(sql`
    SELECT id, type, content, created_at, position FROM messages
    WHERE workspace_id = ${workspaceId} AND chat_id = ${chatId} ${before}
    ORDER BY position DESC LIMIT ${limit + 1}`)
  const page = rows.slice(0, limit).reverse()
  const olderCount = rows.length > limit
    ? one<{ n: number }>(db, sql`SELECT count(*) AS n FROM messages WHERE workspace_id = ${workspaceId} AND chat_id = ${chatId} AND position < ${page[0]!.position}`)!.n
    : 0
  return { messages: page.map((row) => fromMessageRow(row, sessionDir)), olderCount }
}

/**
 * Copies a chat's rows up to and including `throughId` into another chat (a branch), with the same ids, positions
 * and timestamps, and indexes the copies. Rows keep `{{SESSION_PATH}}`, so they point at the new chat's folder.
 * Returns the number of rows copied (0 when `throughId` is not a message of the source).
 */
export function copyMessages(tx: Db | Tx, workspaceId: string, fromChatId: string, toChatId: string, throughId: string): number {
  const copied = tx.all<{ rowid: number; type: string; content: string }>(sql`
    INSERT INTO messages (workspace_id, chat_id, id, position, parent_id, type, content, created_at)
    SELECT workspace_id, ${toChatId}, id, position, parent_id, type, content, created_at FROM messages
    WHERE workspace_id = ${workspaceId} AND chat_id = ${fromChatId}
      AND position <= (SELECT position FROM messages WHERE workspace_id = ${workspaceId} AND chat_id = ${fromChatId} AND id = ${throughId})
    RETURNING rowid, type, content`)
  for (const row of copied) indexRow(tx, row.rowid, row.type, row.content)
  return copied.length
}

/** Deletes every row of a chat and its index entries. */
export function deleteMessages(tx: Db | Tx, workspaceId: string, chatId: string): number {
  const rows = tx.all<{ rowid: number }>(sql`DELETE FROM messages WHERE workspace_id = ${workspaceId} AND chat_id = ${chatId} RETURNING rowid`)
  for (const { rowid } of rows) tx.run(sql`DELETE FROM messages_fts WHERE rowid = ${rowid}`)
  return rows.length
}

/** Each word of the query as a quoted prefix term (`"tok"*`), all required. Empty when the query has no word. */
export function toSearchQuery(query: string): string {
  return query
    .split(/\s+/)
    .map((word) => word.replace(/"/g, '').trim())
    .filter(Boolean)
    .map((word) => `"${word}"*`)
    .join(' ')
}

/** A window of `text` around the first query word it contains, about `max` characters, newlines flattened. */
function snippetOf(text: string, query: string, max = 150): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const lower = flat.toLowerCase()
  const at = query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => lower.indexOf(word))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0
  const start = Math.max(0, at - Math.floor(max / 2))
  const end = Math.min(flat.length, start + max)
  return `${start > 0 ? '...' : ''}${flat.slice(start, end)}${end < flat.length ? '...' : ''}`
}

export interface ChatSearchResult {
  sessionId: string
  matchCount: number
  matches: { sessionId: string; lineNumber: number; snippet: string }[]
}

/**
 * Full-text search over the chats `actor` may see in a workspace (the private rule is the join: `created_by =
 * :actor`). Per chat: the number of matching messages and snippets of the newest `perChat`; chats with the most
 * matches first, at most `limit`. `lineNumber` is the matching message's position in its chat.
 */
export function searchChats(workspaceId: string, actor: string, query: string, { limit = 50, perChat = 3 } = {}, db: Db = initDb()): ChatSearchResult[] {
  const match = toSearchQuery(query)
  if (!match) return []
  initMessages(db)
  const hits = db.all<{ chat_id: string; position: number; content: string }>(sql`
    SELECT m.chat_id, m.position, m.content FROM messages_fts f
    JOIN messages m ON m.rowid = f.rowid
    JOIN chats c ON c.id = m.chat_id AND c.workspace_id = m.workspace_id
    WHERE messages_fts MATCH ${match} AND m.workspace_id = ${workspaceId} AND c.created_by = ${actor}
    ORDER BY m.chat_id, m.position DESC`)
  const results = new Map<string, ChatSearchResult>()
  for (const hit of hits) {
    let result = results.get(hit.chat_id)
    if (!result) results.set(hit.chat_id, (result = { sessionId: hit.chat_id, matchCount: 0, matches: [] }))
    result.matchCount++
    if (result.matches.length < perChat) {
      const text = (JSON.parse(hit.content) as { content?: unknown }).content
      result.matches.push({ sessionId: hit.chat_id, lineNumber: hit.position, snippet: typeof text === 'string' ? snippetOf(text, query) : '' })
    }
  }
  return [...results.values()].sort((a, b) => b.matchCount - a.matchCount).slice(0, limit)
}

/** What boot recovery left behind: chats it closed, partial answers and tool calls it marked interrupted. */
export interface RecoveryReport {
  chats: number
  partial: number
  tools: number
}

const INTERRUPTED_RESULT = 'Interrupted by a restart; the action may have run.'

/**
 * Boot recovery (docs/data-architecture.md "Durability"): for each chat whose `run_started_at` is set (a turn was
 * running when the server stopped; no scan of `messages`), in one transaction per chat: a partial answer loses
 * `partial`, gains `interrupted` and enters the search index; a tool call still pending or executing becomes an
 * error with an interrupted result (never a spinner); an `info` row "Response interrupted" ends the turn; then
 * `run_started_at` is cleared. Runs once at boot, before chats load.
 */
export function runChatsRecovery(db: Db = initDb()): RecoveryReport {
  initMessages(db)
  const report: RecoveryReport = { chats: 0, partial: 0, tools: 0 }
  const running = db.all<{ id: string; workspace_id: string }>(sql`SELECT id, workspace_id FROM chats WHERE run_started_at IS NOT NULL`)
  for (const chat of running) {
    db.transaction(
      (tx) => {
        const rows = tx.all<{ rowid: number; id: string; type: string; content: string }>(sql`
          SELECT rowid, id, type, content FROM messages
          WHERE workspace_id = ${chat.workspace_id} AND chat_id = ${chat.id}
            AND (json_extract(content, '$.partial') = 1 OR (type = 'tool' AND json_extract(content, '$.toolStatus') IN ('pending', 'executing')))`)
        for (const row of rows) {
          const fields = JSON.parse(row.content) as Record<string, unknown>
          if (fields.partial) {
            delete fields.partial
            fields.interrupted = true
            report.partial++
          } else {
            fields.toolStatus = 'error'
            fields.isError = true
            fields.interrupted = true
            fields.toolResult ??= INTERRUPTED_RESULT
            report.tools++
          }
          const content = JSON.stringify(fields)
          tx.run(sql`UPDATE messages SET content = ${content} WHERE rowid = ${row.rowid}`)
          indexRow(tx, row.rowid, row.type, content)
        }
        const now = Date.now()
        writeMessages(tx, chat.workspace_id, chat.id, [{ id: `interrupted-${now}`, type: 'info', createdAt: now, content: JSON.stringify({ content: 'Response interrupted' }), reposition: true }], [])
        tx.run(sql`UPDATE chats SET run_started_at = NULL WHERE id = ${chat.id}`)
      },
      { behavior: 'immediate' },
    )
    report.chats++
  }
  return report
}
