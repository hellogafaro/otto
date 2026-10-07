import { existsSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { getDefaultAgent } from '../packages/shared/src/agents/index.ts'
import { openDb, type Db } from '../packages/shared/src/db/index.ts'
import { initChatMembers } from '../packages/shared/src/sessions/members.ts'

/**
 * One-off: moves an otto.db made before multiplayer chats to `chats_members` (docs/schema.md "Chats", section 4), in
 * place and in one transaction. Run it once, with the server stopped and after a backup
 * (`sqlite3 otto.db ".backup otto-before-members.db"`):
 *
 *   bun run scripts/db-chat-members.ts <path-to-otto.db>
 *
 * It creates `chats_members` as `schema.ts` declares it, gives every chat without members its creator, its agent (the
 * workspace's default agent when `agent_id` was null, which then becomes its `agent_id`) and the senders of its user
 * messages, copying `chats.read_at` to the people (`initChatMembers`), then drops `chats.read_at`. The server's own push
 * at the next boot adds `chats.dm_key` and its unique index (no data to lose). A database already converted is left
 * as it is (idempotent). It prints counts, never data. Delete it once every database is converted.
 */

export type Summary = { createdTable: boolean; chatsWithMembers: number; droppedReadAt: boolean }

const CREATE_MEMBERS = [
  'CREATE TABLE IF NOT EXISTS `chats_members` (`workspace_id` text NOT NULL, `chat_id` text NOT NULL, `actor` text NOT NULL, `read_at` integer, `created_at` integer NOT NULL, PRIMARY KEY(`chat_id`, `actor`))',
  'CREATE INDEX IF NOT EXISTS `chats_members_workspace_actor` ON `chats_members` (`workspace_id`,`actor`)',
]

export function migrateChatMembers(db: Db): Summary {
  const names = (query: ReturnType<typeof sql>) => db.all<{ name: string }>(query).map((row) => row.name)
  const tables = names(sql`SELECT name FROM sqlite_master WHERE type = 'table'`)
  if (!tables.includes('chats')) throw new Error('This is not an otto.db with chats: there is no chats table')
  const hasReadAt = names(sql`SELECT name FROM pragma_table_info('chats')`).includes('read_at')
  const summary: Summary = { createdTable: !tables.includes('chats_members'), chatsWithMembers: 0, droppedReadAt: hasReadAt }
  db.transaction((tx) => {
    for (const statement of CREATE_MEMBERS) tx.run(sql.raw(statement))
    // while `read_at` exists it is copied to each chat's people
    summary.chatsWithMembers = initChatMembers((workspaceId) => getDefaultAgent(workspaceId, tx)?.id, tx)
    if (hasReadAt) tx.run(sql.raw('ALTER TABLE `chats` DROP COLUMN `read_at`'))
  })
  return summary
}

if (import.meta.main) {
  const path = process.argv[2]
  if (!path || !existsSync(path)) {
    console.error('Usage: bun run scripts/db-chat-members.ts <path-to-otto.db>  (stop the server and back the file up first)')
    process.exit(1)
  }
  const summary = migrateChatMembers(openDb(path))
  console.log(
    summary.createdTable || summary.chatsWithMembers || summary.droppedReadAt
      ? `chats_members ${summary.createdTable ? 'created' : 'already there'}; ${summary.chatsWithMembers} chats got members; chats.read_at ${summary.droppedReadAt ? 'copied and dropped' : 'already gone'}`
      : 'Already converted: nothing changed',
  )
}
