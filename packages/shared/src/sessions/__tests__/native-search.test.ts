import { afterEach, describe, expect, it } from 'bun:test'
import { createClient } from '@libsql/client'
import type { MastraDBMessage } from '@mastra/core/agent'
import { MemoryLibSQL } from '@mastra/libsql'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { openDb, type Db } from '../../db/index.ts'
import { pushSchema } from '../../db/push.ts'
import { snippetOf } from '../../utils/snippet.ts'
import { searchChats } from '../messages.ts'
import { chats, chatsMembers } from '../schema.ts'

const W = 'workspace-search'
const ME = 'user:member'
const previousFlag = process.env.OTTO_MASTRA_CHAT
const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  if (previousFlag === undefined) delete process.env.OTTO_MASTRA_CHAT
  else process.env.OTTO_MASTRA_CHAT = previousFlag
})

async function fixture() {
  process.env.OTTO_MASTRA_CHAT = '1'
  const dir = mkdtempSync(join(tmpdir(), 'otto-native-search-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'search.db')
  const db = openDb(path)
  cleanups.push(() => db.$client.close())
  await pushSchema(db)
  const client = createClient({ url: `file:${path}` })
  cleanups.push(() => client.close())
  const memory = new MemoryLibSQL({ client })
  await memory.init()
  const chat = (id: string, workspaceId = W, actor = ME) => {
    db.insert(chats).values({ id, workspaceId, title: id, createdBy: actor, createdAt: new Date(0), updatedAt: new Date(0) }).run()
    db.insert(chatsMembers).values({ chatId: id, workspaceId, actor, createdAt: new Date(0) }).run()
  }
  return { db, memory, chat, path }
}

function message(chatId: string, position: number, text: unknown, fields: Record<string, unknown> = {}, workspaceId = W): MastraDBMessage {
  return {
    id: crypto.randomUUID(), threadId: chatId, resourceId: workspaceId,
    role: 'user', type: 'v2', createdAt: new Date(position),
    content: { format: 2, parts: [{ type: 'text', text: typeof text === 'string' ? text : '' }], metadata: {
      position, otto: { id: crypto.randomUUID(), type: 'user', content: text, ...fields },
    } },
  } as MastraDBMessage
}

describe('native full-history scoped search', () => {
  it('finds the oldest row beyond 2000, counts the entire history and returns only bounded newest snippets', async () => {
    const { db, memory, chat } = await fixture()
    chat('long')
    const rows = Array.from({ length: 6000 }, (_, i) => message('long', i, i === 0 ? 'oldestneedle budget' : `budget ${i}`))
    await memory.saveMessages({ messages: rows })
    const before = db.all(sql`SELECT id, content FROM mastra_messages ORDER BY rowid`)
    const cold = performance.now()
    const hits = searchChats(W, ME, 'budget', {}, db)
    const coldMs = performance.now() - cold
    const warm = performance.now()
    expect(searchChats(W, ME, 'oldestneed', {}, db)[0]?.matches[0]?.lineNumber).toBe(1)
    const warmMs = performance.now() - warm
    expect(hits[0]?.matchCount).toBe(6000)
    expect(hits[0]?.matches.map((hit) => hit.lineNumber)).toEqual([6000, 5999, 5998])
    expect(db.all(sql`SELECT id, content FROM mastra_messages ORDER BY rowid`)).toEqual(before)
    expect(db.all(sql`SELECT id FROM messages`)).toEqual([])
    console.log(`[native-search] 6000 official rows: cold index/search ${coldMs.toFixed(2)} ms, warm oldest prefix ${warmMs.toFixed(2)} ms`)
    expect(coldMs).toBeLessThan(3000)
    expect(warmMs).toBeLessThan(1000)
  }, 30_000)

  it('preserves FTS terms, diacritics, prefix matching, literal operators and snippet windows', async () => {
    const { db, memory, chat } = await fixture()
    chat('terms')
    const text = `${'Beginning '.repeat(20)}Le café est prêt pour Zoë\n${'ending '.repeat(30)}`
    await memory.saveMessages({ messages: [message('terms', 0, text), message('terms', 1, 'decaf OR operation')] })
    expect(searchChats(W, ME, 'pre zoe', {}, db)[0]?.matchCount).toBe(1)
    expect(searchChats(W, ME, 'cafe "', {}, db)[0]?.matchCount).toBe(1)
    expect(searchChats(W, ME, 'café', {}, db)[0]?.matches[0]?.snippet).toBe(snippetOf(text, 'café'))
    expect(searchChats(W, ME, 'caf', {}, db)[0]?.matchCount).toBe(1)
    expect(searchChats(W, ME, 'OR', {}, db)[0]?.matches[0]?.lineNumber).toBe(2)
    expect(searchChats(W, ME, 'missing cafe', {}, db)).toEqual([])
    expect(searchChats(W, ME, ' "  ', {}, db)).toEqual([])
  })

  it('requires matching workspace, chat and current membership even after indexing', async () => {
    const { db, memory, chat } = await fixture()
    chat('mine')
    chat('private', W, 'user:other')
    chat('foreign', 'another-workspace')
    chat('wrong-membership')
    db.run(sql`UPDATE chats_members SET workspace_id='another-workspace' WHERE chat_id='wrong-membership'`)
    await memory.saveMessages({ messages: [
      message('mine', 0, 'needle'), message('private', 0, 'needle'),
      message('foreign', 0, 'needle', {}, 'another-workspace'),
      message('wrong-membership', 0, 'needle'), message('mine', 1, 'resource mismatch needle', {}, 'another-workspace'),
      message('orphan', 0, 'needle'),
    ] })
    expect(searchChats(W, ME, 'needle', {}, db).map((hit) => [hit.sessionId, hit.matchCount])).toEqual([['mine', 1]])
    expect(searchChats(W, 'user:workspace-owner', 'needle', {}, db)).toEqual([])
    db.run(sql`DELETE FROM chats_members WHERE chat_id='mine'`)
    expect(searchChats(W, ME, 'needle', {}, db)).toEqual([])
    db.run(sql`INSERT INTO chats_members(workspace_id,chat_id,actor,created_at) VALUES(${W},'private',${ME},0)`)
    expect(searchChats(W, ME, 'needle', {}, db).map((hit) => hit.sessionId)).toEqual(['private'])
    db.run(sql`DELETE FROM chats WHERE id='private'`)
    expect(searchChats(W, ME, 'needle', {}, db)).toEqual([])
  })

  it('indexes only visible final text, and tracks official updates, inserts and deletes', async () => {
    const { db, memory, chat } = await fixture()
    chat('changes')
    const partial = message('changes', 5, 'needle partial', { type: 'assistant', partial: true })
    const visible = message('changes', 7, 'needle visible')
    await memory.saveMessages({ messages: [
      message('changes', 0, 'needle tool', { type: 'tool' }),
      message('changes', 1, 'needle hidden', { hidden: true }),
      message('changes', 2, 'needle intermediate', { type: 'assistant', isIntermediate: true }),
      message('changes', 3, 123), message('changes', 4, '  '), partial,
      message('changes', 6, 'needle interrupted', { type: 'assistant', interrupted: true }), visible,
    ] })
    expect(searchChats(W, ME, 'needle', {}, db)[0]?.matchCount).toBe(2)
    partial.content.metadata!.otto = { type: 'assistant', content: 'needle recovered', interrupted: true }
    await memory.saveMessages({ messages: [partial, message('changes', 8, 'needle appended')] })
    expect(searchChats(W, ME, 'needle', {}, db)[0]?.matchCount).toBe(4)
    await memory.saveMessages({ messages: [partial] })
    expect(searchChats(W, ME, 'needle', {}, db)[0]?.matchCount).toBe(4)
    visible.content.metadata!.otto = { type: 'user', content: 'replacement' }
    await memory.saveMessages({ messages: [visible] })
    expect(searchChats(W, ME, 'needle', {}, db)[0]?.matchCount).toBe(3)
    expect(searchChats(W, ME, 'replacement', {}, db)[0]?.matches[0]?.lineNumber).toBe(8)
    await memory.deleteMessages([visible.id, partial.id])
    expect(searchChats(W, ME, 'replacement', {}, db)).toEqual([])
    expect(searchChats(W, ME, 'needle', {}, db)[0]?.matchCount).toBe(2)
  })

  it('does not rely on pre-authorization baked into the index when native resources move', async () => {
    const { db, memory, chat } = await fixture()
    chat('moving')
    const row = message('moving', 0, 'needle')
    await memory.saveMessages({ messages: [row] })
    expect(searchChats(W, ME, 'needle', {}, db)[0]?.matchCount).toBe(1)
    row.resourceId = 'another-workspace'
    await memory.saveMessages({ messages: [row] })
    expect(searchChats(W, ME, 'needle', {}, db)).toEqual([])
    row.resourceId = W
    await memory.saveMessages({ messages: [row] })
    expect(searchChats(W, ME, 'needle', {}, db)[0]?.matchCount).toBe(1)
  })

  it('ranks deterministically, pages all matching chats and clamps result and snippet bounds', async () => {
    const { db, memory, chat } = await fixture()
    for (let i = 0; i < 105; i++) {
      const id = `chat-${String(i).padStart(3, '0')}`
      chat(id)
      await memory.saveMessages({ messages: Array.from({ length: i === 104 ? 25 : 1 }, (_, p) => message(id, p, 'needle')) })
    }
    const first = searchChats(W, ME, 'needle', { limit: 1000, perChat: 1000 }, db)
    expect(first).toHaveLength(100)
    expect(first[0]?.sessionId).toBe('chat-104')
    expect(first[0]?.matchCount).toBe(25)
    expect(first[0]?.matches).toHaveLength(20)
    const rest = searchChats(W, ME, 'needle', { limit: 100, offset: 100 }, db)
    expect(rest).toHaveLength(5)
    expect(new Set([...first, ...rest].map((hit) => hit.sessionId)).size).toBe(105)
    expect(searchChats(W, ME, 'needle', { limit: 1, perChat: 0 }, db)[0]).toEqual({ sessionId: 'chat-104', title: 'chat-104', matchCount: 25, matches: [] })
    expect(searchChats(W, ME, 'needle', { limit: -1 }, db)).toEqual([])
    expect(searchChats(W, ME, 'needle', { limit: NaN, perChat: Infinity, offset: NaN }, db)).toHaveLength(50)
  })

  it('rebuilds on a fresh handle after rowid renumbering and survives app schema push', async () => {
    const { db, memory, chat, path } = await fixture()
    chat('vacuum')
    const removed = message('vacuum', 0, 'discard')
    await memory.saveMessages({ messages: [removed, message('vacuum', 1, 'retained needle')] })
    expect(searchChats(W, ME, 'needle', {}, db)[0]?.matchCount).toBe(1)
    await memory.deleteMessages([removed.id])
    db.run(sql`VACUUM`)
    const reopened: Db = openDb(path)
    cleanups.push(() => reopened.$client.close())
    expect(searchChats(W, ME, 'needle', {}, reopened)[0]?.matches[0]?.lineNumber).toBe(2)
    expect(await pushSchema(reopened)).toEqual([])
    await memory.saveMessages({ messages: [message('vacuum', 2, 'needle added')] })
    expect(searchChats(W, ME, 'needle', {}, reopened)[0]?.matchCount).toBe(2)
  })
})
