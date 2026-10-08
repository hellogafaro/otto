import { sql } from 'drizzle-orm'
import { initDb, type Db, type Tx } from '../db/index.ts'
import type { StoredMessage } from './types.ts'

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
