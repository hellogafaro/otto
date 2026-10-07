import { afterAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createAgent } from '../packages/shared/src/agents/index.ts'
import { openDb } from '../packages/shared/src/db/index.ts'
import { pushSchema } from '../packages/shared/src/db/push.ts'
import { getChatMembers } from '../packages/shared/src/sessions/members.ts'
import { migrateChatMembers } from './db-chat-members.ts'

const dir = mkdtempSync(join(tmpdir(), 'otto-chat-members-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const W = 'wsaaaaaaaaaa'
const ME = 'user:aaaaaaaaaaaa'
const OTHER = 'user:bbbbbbbbbbbb'

/** A temp-file database shaped like one made before multiplayer: `chats.read_at`, no `chats_members`, no `dm_key`. */
async function oldDatabase(name: string) {
  const db = openDb(join(dir, name))
  await pushSchema(db)
  db.run(sql.raw('DROP TABLE chats_members'))
  db.run(sql.raw('DROP INDEX chats_workspace_dm_key'))
  db.run(sql.raw('ALTER TABLE chats DROP COLUMN dm_key'))
  db.run(sql.raw('ALTER TABLE chats ADD COLUMN read_at integer'))
  const agent = createAgent({ workspaceId: W, title: 'Otto', provider: 'anthropic', createdBy: ME }, db)
  const chat = (id: string, createdBy: string, agentId: string | null, readAt: number | null) =>
    db.run(sql`INSERT INTO chats (id, workspace_id, title, created_by, agent_id, read_at, metadata, created_at, updated_at) VALUES (${id}, ${W}, 't', ${createdBy}, ${agentId}, ${readAt}, '{}', 10, 20)`)
  chat('c1', ME, null, 15)
  chat('c2', OTHER, agent.id, null)
  db.run(sql`INSERT INTO messages (workspace_id, chat_id, id, position, type, content, created_at) VALUES (${W}, 'c1', 'm1', 1, 'user', ${JSON.stringify({ content: 'hi', sender: OTHER })}, 11)`)
  return { db, agentId: agent.id }
}

describe('scripts/db-chat-members.ts', () => {
  it('copies read_at to the members, gives agentless chats the default agent, drops the column; then the boot push loses nothing', async () => {
    const { db, agentId } = await oldDatabase('old.db')
    expect(migrateChatMembers(db)).toEqual({ createdTable: true, chatsWithMembers: 2, droppedReadAt: true })

    expect(getChatMembers(W, 'c1', db)).toEqual([{ actor: ME, readAt: 15 }, { actor: OTHER, readAt: 15 }, { actor: `agent:${agentId}`, readAt: null }])
    expect(getChatMembers(W, 'c2', db)).toEqual([{ actor: OTHER, readAt: null }, { actor: `agent:${agentId}`, readAt: null }])
    expect(db.all<{ agent_id: string }>(sql`SELECT agent_id FROM chats WHERE id = 'c1'`)[0]!.agent_id).toBe(agentId)
    expect(db.all<{ name: string }>(sql`SELECT name FROM pragma_table_info('chats')`).map((c) => c.name)).not.toContain('read_at')

    // idempotent
    expect(migrateChatMembers(db)).toEqual({ createdTable: false, chatsWithMembers: 0, droppedReadAt: false })
    expect(getChatMembers(W, 'c1', db)).toHaveLength(3)

    // the server's push at boot only adds dm_key and its index: chats_members is already what schema.ts declares
    const planned = await pushSchema(db)
    expect(planned.join('\n')).toContain('dm_key')
    expect(planned.join('\n')).not.toContain('chats_members')
    expect(await pushSchema(db)).toEqual([])
  })

  it('refuses a file that has no chats', () => {
    const db = openDb(join(dir, 'empty.db'))
    expect(() => migrateChatMembers(db)).toThrow('no chats table')
  })
})
