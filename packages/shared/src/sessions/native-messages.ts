import { sql } from 'drizzle-orm'
import { initDb, type Db, type Tx } from '../db/index.ts'
import type { StoredMessage } from './types.ts'
import { createHash } from 'node:crypto'

const searchInitialized = new WeakSet<object>()

function nativeSearchText(content: ReturnType<typeof sql>) {
  return sql`CASE WHEN json_extract(${content}, '$.metadata.otto.type') IN ('user', 'assistant')
    AND coalesce(json_extract(${content}, '$.metadata.otto.hidden'), 0) = 0
    AND coalesce(json_extract(${content}, '$.metadata.otto.isIntermediate'), 0) = 0
    AND coalesce(json_extract(${content}, '$.metadata.otto.partial'), 0) = 0
    AND json_type(${content}, '$.metadata.otto.content') = 'text'
    AND trim(json_extract(${content}, '$.metadata.otto.content')) != ''
    THEN json_extract(${content}, '$.metadata.otto.content') END`
}

export function initNativeMessagesSearch(db: Db = initDb()): void {
  if (searchInitialized.has(db)) return
  const text = nativeSearchText(sql`content`)
  const inserted = nativeSearchText(sql`NEW.content`)
  db.transaction((tx) => {
    tx.run(sql`CREATE VIRTUAL TABLE IF NOT EXISTS native_messages_fts USING fts5(
      text, tokenize='unicode61 remove_diacritics 2', prefix='2 3')`)
    tx.run(sql`CREATE TRIGGER IF NOT EXISTS native_messages_search_insert AFTER INSERT ON mastra_messages BEGIN
      INSERT INTO native_messages_fts(rowid, text) SELECT NEW.rowid, ${inserted} WHERE ${inserted} IS NOT NULL;
    END`)
    tx.run(sql`CREATE TRIGGER IF NOT EXISTS native_messages_search_delete AFTER DELETE ON mastra_messages BEGIN
      DELETE FROM native_messages_fts WHERE rowid = OLD.rowid;
    END`)
    tx.run(sql`CREATE TRIGGER IF NOT EXISTS native_messages_search_update AFTER UPDATE ON mastra_messages
      WHEN OLD.rowid != NEW.rowid OR OLD.content IS NOT NEW.content BEGIN
      DELETE FROM native_messages_fts WHERE rowid = OLD.rowid;
      INSERT INTO native_messages_fts(rowid, text) SELECT NEW.rowid, ${inserted} WHERE ${inserted} IS NOT NULL;
    END`)
    tx.run(sql`DELETE FROM native_messages_fts`)
    tx.run(sql`INSERT INTO native_messages_fts(rowid, text) SELECT rowid, ${text} FROM mastra_messages WHERE ${text} IS NOT NULL`)
  }, { behavior: 'immediate' })
  searchInitialized.add(db)
}

export function assertHistoryRuntime(_db: Db | Tx = initDb()) {}

export function getNativeMessageIdentities(workspaceId: string, chatId: string, db: Db | Tx = initDb()): { id: string; canonicalId: string | null; taggedId: string | null; fingerprint: string | null }[] {
  if (!db.all(sql`SELECT name FROM sqlite_master WHERE name='mastra_messages'`).length) return []
  const rows = db.all<{ id: string; canonical_id: string | null; tagged_id: string | null; projection: string | null }>(sql`SELECT id, json_extract(content,'$.metadata.otto.id') AS canonical_id, json_extract(content,'$.metadata.ottoId') AS tagged_id, CASE WHEN json_type(content,'$.metadata.otto')='object' AND json_type(content,'$.metadata.otto.id')='text' AND json_type(content,'$.metadata.otto.content')='text' AND json_extract(content,'$.metadata.otto.type') IN ('user','assistant','tool','info','error','warning','plan','auth-request') THEN json_extract(content,'$.metadata.otto') END AS projection FROM mastra_messages WHERE thread_id=${chatId} AND resourceId=${workspaceId} ORDER BY rowid`)
  return rows.map((row) => ({ id: row.id, canonicalId: row.canonical_id, taggedId: row.tagged_id, fingerprint: row.projection === null ? null : createHash('sha256').update(JSON.stringify(JSON.parse(row.projection), (_key, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])) : value)).digest('hex') }))
}

export function getNativeMessages(
  workspaceId: string,
  chatId: string,
  sessionDir: string,
  db: Db | Tx = initDb(),
): StoredMessage[] {
  const exists = db.all(
    sql`SELECT name FROM sqlite_master WHERE name='mastra_messages'`,
  )
  if (!exists.length) return []
  const rows = db.all<{ content: string }>(
    sql`SELECT content FROM mastra_messages WHERE thread_id=${chatId} AND resourceId=${workspaceId} ORDER BY CAST(json_extract(content,'$.metadata.position') AS INTEGER)`,
  )
  return rows.map((row) => {
    const content = JSON.parse(row.content) as {
      metadata?: { otto?: StoredMessage }
    }
    if (!content.metadata?.otto)
      throw new Error('Native message has no supported UI projection.')
    return JSON.parse(
      JSON.stringify(content.metadata.otto).replaceAll('{{SESSION_PATH}}',sessionDir.replaceAll('\\','/')),
    ) as StoredMessage
  })
}
