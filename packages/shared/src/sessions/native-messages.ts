import { sql } from 'drizzle-orm'
import { initDb, type Db, type Tx } from '../db/index.ts'
import type { StoredMessage } from './types.ts'

export function assertHistoryRuntime(db:Db|Tx=initDb()){
  if(process.env.OTTO_MASTRA_CHAT==='1')return
  if(db.all(sql`SELECT name FROM sqlite_master WHERE name='mastra_threads'`).length&&db.all(sql`SELECT id FROM mastra_threads LIMIT 1`).length)throw new Error('Native conversation history exists. This install must keep the native runtime enabled; reverse import is not supported.')
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
