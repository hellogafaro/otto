import { afterAll, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { openDb, type Db } from '../../db/index.ts'
import { pushSchema } from '../../db/push.ts'
import { initWorkspaceLabels } from '../../labels/storage.ts'
import { INSTALL, getSetting, updateSetting } from '../../settings/index.ts'
import { initWorkspaceStatuses } from '../../statuses/storage.ts'
import { setDefaultStatus } from '../../statuses/crud.ts'
import { users } from '../../users/schema.ts'
import { createWorkspaceMember } from '../../workspaces/members.ts'
import { deleteChat, getChat, getChats, type ChatSnapshot } from '../chats.ts'
import { addChatMembers, getChatMembers, getDmChatId, initChatMembers, removeChatMember, toDmKey, updateChatMemberRead } from '../members.ts'
import { initChatsImport, parseMessageLines } from '../import.ts'
import { getMessageRows, getMessagesPage, initMessages, runChatsRecovery, searchChats } from '../messages.ts'
import { ChatPersistenceQueue, type ChatWrite } from '../persistence-queue.ts'
import { createSession, getSessionPath, loadSession } from '../storage.ts'
import type { SessionConfig, StoredMessage } from '../types.ts'

// docs/messages-design.md section 8: the importer, the write path, paging, search, privacy, boot recovery, crashes,
// concurrent writers and a performance sanity check, on `:memory:` and temp-file databases (never ~/.otto).

const ROOT = join(import.meta.dir, '..', '..', '..', '..', '..')
const W = 'wsaaaaaaaaaa'
const OWNER = 'aaaaaaaaaaaa'
const ME = `user:${OWNER}`
const OTHER = 'user:bbbbbbbbbbbb'

const dirs: string[] = []
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })))
const tempDir = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

async function setup(db: Db = openDb(':memory:')) {
  await pushSchema(db)
  initMessages(db)
  initWorkspaceLabels(W, db)
  initWorkspaceStatuses(W, db)
  const now = new Date()
  db.insert(users).values({ id: OWNER, name: 'a', email: 'a@x.test', createdAt: now, updatedAt: now }).run()
  db.insert(users).values({ id: 'bbbbbbbbbbbb', name: 'b', email: 'b@x.test', createdAt: new Date(now.getTime() + 1), updatedAt: now }).run()
  createWorkspaceMember(W, OWNER, 'owner', db)
  return db
}

const msg = (id: string, type: string, timestamp: number, fields: Record<string, unknown> = {}) => ({ id, type, timestamp, ...fields }) as unknown as StoredMessage

function chatOf(id: string, extra: Partial<ChatSnapshot> = {}): ChatSnapshot {
  return { id, workspaceId: W, workspaceRootPath: '/tmp/w', createdBy: ME, createdAt: 1, lastUsedAt: 1, ...extra }
}

/** A queue on this database, flushing one chat with the given messages; its creator is a member (as `createSession` makes it) unless `members` is false. */
function writer(db: Db, { members = true } = {}) {
  const queue = new ChatPersistenceQueue({ db: () => db })
  return {
    queue,
    async write(chat: ChatSnapshot, messages?: StoredMessage[]) {
      queue.enqueue(chat.id, () => ({ chat, sessionDir: `/tmp/w/sessions/${chat.id}`, messages }) satisfies ChatWrite)
      await queue.flush(chat.id)
      if (members && chat.createdBy) addChatMembers(chat.workspaceId, chat.id, [chat.createdBy], {}, db)
    },
  }
}

const count = (db: Db, query: ReturnType<typeof sql>) => (db.all<{ n: number }>(query)[0]?.n ?? 0)
const positions = (db: Db, chatId: string) => db.all<{ id: string; position: number; rowid: number }>(sql`SELECT id, position, rowid FROM messages WHERE chat_id = ${chatId} ORDER BY position`)

// ---------------------------------------------------------------------------------------------------------------
// The importer
// ---------------------------------------------------------------------------------------------------------------

describe('initChatsImport', () => {
  /** A workspace folder with the given chats (folder name -> file text), shaped like the real session.jsonl. */
  function legacyWorkspace(chats: Record<string, string | null>) {
    const rootPath = tempDir('otto-chats-import-')
    for (const [id, text] of Object.entries(chats)) {
      mkdirSync(join(rootPath, 'sessions', id, 'plans'), { recursive: true })
      if (text !== null) writeFileSync(join(rootPath, 'sessions', id, 'session.jsonl'), text)
    }
    return { id: W, rootPath }
  }
  const jsonl = (header: object, lines: Array<object | string>) => [JSON.stringify(header), ...lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line)))].join('\n') + '\n'
  const header = (id: string, extra: object = {}) => ({ id, workspaceRootPath: '~/.otto/workspaces/test', createdAt: 1000, lastUsedAt: 5000, messageCount: 0, tokenUsage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, contextTokens: 0, costUsd: 0 }, ...extra })

  async function fixture() {
    const db = await setup()
    const ws = legacyWorkspace({})
    const dirOf = (id: string) => join(ws.rootPath, 'sessions', id)
    const write = (id: string, text: string | null) => {
      mkdirSync(dirOf(id), { recursive: true })
      if (text !== null) writeFileSync(join(dirOf(id), 'session.jsonl'), text)
    }
    write('260105-vital-zenith', jsonl(header('260105-vital-zenith', { name: 'Main', lastMessageAt: 4000, isFlagged: true, sessionStatus: 'needs-review', labels: ['bug', 'priority::3', 'no-such-label'], permissionMode: 'execute', previousPermissionMode: 'explore', hasUnread: true, sdkSessionId: 'pi-1' }), [
      msg('m1', 'user', 1000, { content: 'Héllo café, what is the plan?' }),
      msg('m2', 'assistant', 2000, { content: 'old answer' }),
      msg('m3', 'assistant', 2500, { content: 'thinking out loud', isIntermediate: true }),
      msg('m4', 'tool', 3000, { toolName: 'Write', toolUseId: 't1', toolStatus: 'completed', toolResult: `Wrote ${join(ws.rootPath, 'sessions', '260105-vital-zenith')}/plans/a.md` }),
      { id: 's1', type: 'status', content: 'Compacting...', timestamp: 3100 },
      { id: 'm5', type: 'info', content: 'no timestamp here' },
      msg('m2', 'assistant', 2000, { content: 'final answer about {{SESSION_PATH}}/plans/a.md' }),
      '{"id":"m6","type":"user","content":"trunc',
    ]))
    write('261006-polished-oasis', jsonl(header('261006-polished-oasis', { name: 'Branch', createdBy: OTHER, branchFromMessageId: 'm2' }), [
      msg('m1', 'user', 1000, { content: 'Héllo café, what is the plan?' }),
      msg('m2', 'assistant', 2000, { content: 'final answer' }),
    ]))
    write('260101-old-archive', jsonl(header('260101-old-archive', { name: 'Archived', isArchived: true, archivedAt: 9, sessionStatus: 'done' }), [msg('a1', 'user', 1, { content: 'archived chat' })]))
    write('260101-mini-edit', jsonl(header('260101-mini-edit', { hidden: true }), [msg('h1', 'user', 1, { content: 'hidden' })]))
    write('260102-routine-run', jsonl(header('260102-routine-run', { triggeredBy: { automationName: 'Digest', automationId: 'aaaaaa', depth: 1, timestamp: 7 } }), [msg('r1', 'user', 1, { content: 'run it' })]))
    write('260103-corrupt', 'not json at all\n')
    write('260104-empty-folder', null)
    return { db, ws, dirOf, write }
  }

  it('imports every chat of a workspace once, as its rows, and leaves the files alone', async () => {
    const { db, ws, dirOf } = await fixture()
    const file = join(dirOf('260105-vital-zenith'), 'session.jsonl')
    const before = { hash: createHash('sha256').update(readFileSync(file)).digest('hex'), mtime: statSync(file).mtimeMs }

    const report = initChatsImport(db, [ws])

    expect(report).toMatchObject({ workspaces: 1, chats: 4, hidden: 1, unreadable: 1, failed: 0, skippedLines: 1 })
    expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(before.hash)
    expect(statSync(file).mtimeMs).toBe(before.mtime)

    const chats = Object.fromEntries(getChats(W, ws.rootPath, {}, db).map((chat) => [chat.id, chat]))
    expect(Object.keys(chats).sort()).toEqual(['260101-old-archive', '260102-routine-run', '260105-vital-zenith', '261006-polished-oasis'])

    // header fields: no creator -> the first owner; flag -> pinned; canonical modes normalized; unknown labels left out
    expect(chats['260105-vital-zenith']).toMatchObject({
      name: 'Main', createdBy: ME, isFlagged: true, sessionStatus: 'needs-review', permissionMode: 'allow-all', previousPermissionMode: 'safe',
      sdkSessionId: 'pi-1', lastMessageAt: 4000, messageCount: 5, preview: 'Héllo café, what is the plan?', lastFinalMessageId: 'm2',
      tokenUsage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, contextTokens: 0, costUsd: 0 },
    })
    expect(chats['260105-vital-zenith']!.labels?.sort()).toEqual(['bug', 'priority::3'])
    // the creator is a member; the header's unread is theirs (no agent in this workspace, so none joins)
    expect(getChatMembers(W, '260105-vital-zenith', db)).toEqual([{ actor: ME, readAt: null }])
    expect(getChatMembers(W, '261006-polished-oasis', db).map((m) => m.actor)).toEqual([OTHER])
    expect(chats['261006-polished-oasis']).toMatchObject({ createdBy: OTHER, branchFromMessageId: 'm2' })
    expect(chats['261006-polished-oasis']!.parentSessionId).toBeUndefined()
    expect(chats['260101-old-archive']).toMatchObject({ isArchived: true, sessionStatus: 'archived' })
    expect((chats['260102-routine-run'] as SessionConfig).triggeredBy).toMatchObject({ automationName: 'Digest', automationId: 'aaaaaa', depth: 1 })

    // messages: status dropped, missing timestamp inherited, the last line of a duplicate id wins, truncated line skipped
    const stored = getMessagesPage(W, '260105-vital-zenith', getSessionPath(ws.rootPath, '260105-vital-zenith'), {}, db)
    expect(stored.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5'])
    expect(stored.messages[4]!.timestamp).toBe(3000)
    // paths: the chat folder is stored as the token and read back as this folder
    const dir = getSessionPath(ws.rootPath, '260105-vital-zenith')
    expect(stored.messages[1]!.content).toBe(`final answer about ${dir}/plans/a.md`)
    expect((stored.messages[3] as { toolResult?: string }).toolResult).toBe(`Wrote ${dir}/plans/a.md`)
    const raw = getMessageRows(W, '260105-vital-zenith', db).map((row) => row.content).join('\n')
    expect(raw).toContain('{{SESSION_PATH}}/plans/a.md')
    expect(raw).not.toContain(dir)

    // a branch keeps the same message ids in its own chat
    expect(getMessageRows(W, '261006-polished-oasis', db).map((row) => row.id)).toEqual(['m1', 'm2'])

    // search: indexed in the same transaction; intermediate rows are not
    expect(searchChats(W, ME, 'cafe', {}, db).map((r) => r.sessionId)).toEqual(['260105-vital-zenith'])
    expect(searchChats(W, ME, 'thinking', {}, db)).toEqual([])
  })

  it('is idempotent: a second run imports nothing, and a chat deleted after the import stays deleted', async () => {
    const { db, ws } = await fixture()
    initChatsImport(db, [ws])
    const rowsBefore = count(db, sql`SELECT count(*) AS n FROM messages`)
    const ftsBefore = count(db, sql`SELECT count(*) AS n FROM messages_fts`)

    expect(initChatsImport(db, [ws])).toMatchObject({ workspaces: 0, chats: 0 })
    expect(count(db, sql`SELECT count(*) AS n FROM messages`)).toBe(rowsBefore)
    expect(count(db, sql`SELECT count(*) AS n FROM messages_fts`)).toBe(ftsBefore)

    deleteChat(W, '260105-vital-zenith', db)
    initChatsImport(db, [ws])
    expect(getChat(W, ws.rootPath, '260105-vital-zenith', db)).toBeNull()
  })

  it('resumes a pass cut short: chats already imported are skipped, the rest come in, nothing twice', async () => {
    const { db, ws, write } = await fixture()
    initChatsImport(db, [ws])
    // as if the process died before the workspace was recorded, with one more chat on disk
    const imports = getSetting(INSTALL, 'imports', db)
    delete imports[`chats:${W}`]
    updateSetting(INSTALL, 'imports', imports, db)
    write('260107-late-chat', jsonl(header('260107-late-chat'), [msg('l1', 'user', 1, { content: 'late' })]))
    const mainRows = positions(db, '260105-vital-zenith')

    expect(initChatsImport(db, [ws])).toMatchObject({ chats: 1, workspaces: 1 })
    expect(positions(db, '260105-vital-zenith')).toEqual(mainRows)
    expect(getMessageRows(W, '260107-late-chat', db).map((row) => row.id)).toEqual(['l1'])
  })

  it('leaves a workspace whose chat could not be written for the next boot, which brings that chat in', async () => {
    const { db, ws } = await fixture()
    db.run(sql.raw(`CREATE TRIGGER fail_one BEFORE INSERT ON chats WHEN NEW.id = '260102-routine-run' BEGIN SELECT RAISE(ABORT, 'disk full'); END`))
    expect(initChatsImport(db, [ws])).toMatchObject({ workspaces: 0, chats: 3, failed: 1, unreadable: 1 })
    expect(getSetting(INSTALL, 'imports', db)[`chats:${W}`]).toBeUndefined()

    db.run(sql.raw('DROP TRIGGER fail_one'))
    expect(initChatsImport(db, [ws])).toMatchObject({ workspaces: 1, chats: 1, failed: 0 })
    expect(getSetting(INSTALL, 'imports', db)[`chats:${W}`]).toBeGreaterThan(0)
    expect(getMessageRows(W, '260102-routine-run', db).map((row) => row.id)).toEqual(['r1'])
  })

  it('leaves a workspace with nobody to own its chats for the next boot', async () => {
    const db = openDb(':memory:')
    await pushSchema(db)
    const ws = legacyWorkspace({ c1: jsonl(header('c1'), []) })
    expect(initChatsImport(db, [ws])).toMatchObject({ workspaces: 0, chats: 0 })
    expect(getSetting(INSTALL, 'imports', db)[`chats:${W}`]).toBeUndefined()
  })

  it('orders lines by timestamp then line, keeping the last copy of an id', () => {
    const { messages, skipped } = parseMessageLines([
      JSON.stringify(msg('b', 'user', 20)),
      JSON.stringify(msg('a', 'user', 10)),
      '{broken',
      JSON.stringify(msg('c', 'user', 10)),
      JSON.stringify(msg('a', 'user', 10, { content: 'last' })),
    ])
    expect(skipped).toBe(1)
    expect(messages.map((m) => [m.id, m.content as string | undefined])).toEqual([['c', undefined], ['a', 'last'], ['b', undefined]])
  })
})

// ---------------------------------------------------------------------------------------------------------------
// The write path
// ---------------------------------------------------------------------------------------------------------------

describe('write path', () => {
  it('writes only what changed, by (chat_id, id); positions follow timestamps; a re-stamp moves a row last', async () => {
    const db = await setup()
    const { write } = writer(db)
    const chat = chatOf('w1')
    const messages = [msg('u1', 'user', 10, { content: 'one' }), msg('a1', 'assistant', 20, { content: 'two' }), msg('q1', 'user', 15, { content: 'queued', isQueued: true })]
    await write(chat, messages)
    expect(positions(db, 'w1').map((row) => row.id)).toEqual(['u1', 'q1', 'a1'])
    const before = positions(db, 'w1')

    messages[1] = { ...messages[1]!, content: 'two, edited' }
    await write(chat, messages)
    expect(positions(db, 'w1')).toEqual(before) // same rows, same rowids and positions

    messages[2] = { ...messages[2]!, timestamp: 30, isQueued: false } // replayed: re-stamped
    await write(chat, messages)
    expect(positions(db, 'w1').map((row) => row.id)).toEqual(['u1', 'a1', 'q1'])
    expect(getMessagesPage(W, 'w1', getSessionPath('/tmp/w', 'w1'), {}, db).messages.find((m) => m.id === 'a1')!.content).toBe('two, edited')
  })

  it('deletes rows that left, with their search entries; a header-only write keeps every message', async () => {
    const db = await setup()
    const { write } = writer(db)
    const chat = chatOf('w2')
    await write(chat, [msg('u1', 'user', 10, { content: 'keep me' }), msg('u2', 'user', 11, { content: 'remove zebra' })])
    expect(searchChats(W, ME, 'zebra', {}, db)).toHaveLength(1)

    await write(chat, [msg('u1', 'user', 10, { content: 'keep me' })])
    expect(getMessageRows(W, 'w2', db).map((row) => row.id)).toEqual(['u1'])
    expect(searchChats(W, ME, 'zebra', {}, db)).toEqual([])

    await write({ ...chat, name: 'renamed' })
    expect(getMessageRows(W, 'w2', db).map((row) => row.id)).toEqual(['u1'])
    expect(getChat(W, '/tmp/w', 'w2', db)!.name).toBe('renamed')
  })

  it('keeps the chat row: pinned, status, labels, a running turn; updated_at moves on messages only', async () => {
    const db = await setup()
    const { write } = writer(db)
    const chat = chatOf('w3', { lastMessageAt: 100 })
    await write({ ...chat, isFlagged: true, sessionStatus: 'done', labels: ['bug'], running: true }, [msg('u1', 'user', 100, { content: 'hi' })])
    const row = () => db.all<{ pinned_at: number | null; run_started_at: number | null; updated_at: number }>(sql`SELECT pinned_at, run_started_at, updated_at FROM chats WHERE id = 'w3'`)[0]!
    expect(row().pinned_at).not.toBeNull()
    expect(row().run_started_at).not.toBeNull()
    expect(getChat(W, '/tmp/w', 'w3', db)).toMatchObject({ isFlagged: true, sessionStatus: 'done', labels: ['bug'] })
    const pinnedAt = row().pinned_at

    await write({ ...chat, name: 'renamed', isFlagged: true, sessionStatus: 'archived', labels: ['code'], running: false })
    expect(row()).toMatchObject({ pinned_at: pinnedAt, run_started_at: null, updated_at: 100 })
    expect(getChat(W, '/tmp/w', 'w3', db)).toMatchObject({ isArchived: true, labels: ['code'] })

    await write({ ...chat, lastMessageAt: 100 }, [msg('u1', 'user', 100, { content: 'hi' }), msg('a1', 'assistant', 250, { content: 'answer' })])
    expect(row().updated_at).toBe(250)
  })

  it('never drops a failed write: it stays pending, the flush rejects, and the retry lands', async () => {
    const db = await setup()
    let fail = true
    const flaky = new Proxy(db, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target)
        if (prop === 'transaction' && fail) {
          return () => {
            fail = false
            throw new Error('SQLITE_BUSY: database is locked')
          }
        }
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const queue = new ChatPersistenceQueue({ db: () => flaky as Db, retryMs: 60_000 })
    const chat = chatOf('w4')
    queue.enqueue('w4', () => ({ chat, sessionDir: '/tmp/w/sessions/w4', messages: [msg('u1', 'user', 1, { content: 'durable' })] }))
    await expect(queue.flush('w4')).rejects.toThrow('locked')
    expect(queue.hasPending('w4')).toBe(true)
    await queue.flush('w4')
    expect(queue.hasPending('w4')).toBe(false)
    expect(getMessageRows(W, 'w4', db).map((row) => row.id)).toEqual(['u1'])
  })

  it('stores a streaming answer as a partial row that search skips, replaced by the finished message', async () => {
    const db = await setup()
    const { write } = writer(db)
    const chat = chatOf('w5')
    const user = msg('u1', 'user', 1, { content: 'question' })
    await write({ ...chat, running: true }, [user, msg('partial-t1', 'assistant', 2, { content: 'half an elephant', partial: true })])
    expect(searchChats(W, ME, 'elephant', {}, db)).toEqual([])
    await write({ ...chat, running: false }, [user, msg('a1', 'assistant', 3, { content: 'a whole elephant' })])
    expect(getMessageRows(W, 'w5', db).map((row) => row.id)).toEqual(['u1', 'a1'])
    expect(searchChats(W, ME, 'elephant', {}, db).map((r) => r.matchCount)).toEqual([1])
  })

  it('creates a branch with its parent rows copied up to the branch point in the same transaction', async () => {
    const db = await setup()
    const { write } = writer(db)
    const root = tempDir('otto-branch-')
    const ws = { id: W, rootPath: root }
    const parent = createSession(ws, { createdBy: ME, name: 'parent' }, db)
    await write(chatOf(parent.id, { workspaceRootPath: root }), [msg('m1', 'user', 1, { content: 'alpha' }), msg('m2', 'assistant', 2, { content: 'beta' }), msg('m3', 'user', 3, { content: 'gamma' })])
    const branch = createSession(ws, { createdBy: ME, branch: { fromSessionId: parent.id, throughMessageId: 'm2', branchFromMessageId: 'm2' } }, db)
    expect(getMessageRows(W, branch.id, db).map((row) => row.id)).toEqual(['m1', 'm2'])
    expect(searchChats(W, ME, 'beta', {}, db).map((r) => r.sessionId).sort()).toEqual([branch.id, parent.id].sort())
    expect(getChat(W, root, branch.id, db)).toMatchObject({ branchFromMessageId: 'm2' })
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Reads: pages, search, privacy
// ---------------------------------------------------------------------------------------------------------------

describe('members', () => {
  const actors = (db: Db, id: string) => getChatMembers(W, id, db).map((m) => m.actor)
  const AGENT = 'agentaaaaaaa'

  it('snapshots the default status for new chats without overriding explicit choices or earlier chats', async () => {
    const db = await setup()
    const ws = { id: W, rootPath: tempDir('otto-default-status-') }
    const initial = createSession(ws, { createdBy: ME }, db)
    expect(initial.sessionStatus).toBe('todo')
    expect(getChat(W, ws.rootPath, initial.id, db)!.sessionStatus).toBe('todo')
    setDefaultStatus(W, 'done', db)
    const reviewed = createSession(ws, { createdBy: ME }, db)
    const explicit = createSession(ws, { createdBy: ME, sessionStatus: 'todo' }, db)
    expect(reviewed.sessionStatus).toBe('done')
    expect(getChat(W, ws.rootPath, reviewed.id, db)!.sessionStatus).toBe('done')
    expect(explicit.sessionStatus).toBe('todo')
    setDefaultStatus(W, 'todo', db)
    expect(getChat(W, ws.rootPath, initial.id, db)!.sessionStatus).toBe('todo')
    expect(getChat(W, ws.rootPath, reviewed.id, db)!.sessionStatus).toBe('done')
    expect(getChat(W, ws.rootPath, explicit.id, db)!.sessionStatus).toBe('todo')
  })

  it('a new chat has its creator (read) and its agent; a DM has its pair, unique per workspace', async () => {
    const db = await setup()
    const ws = { id: W, rootPath: tempDir('otto-members-') }
    const chat = createSession(ws, { createdBy: ME, agentId: AGENT }, db)
    expect(getChatMembers(W, chat.id, db)).toEqual([{ actor: ME, readAt: expect.any(Number) }, { actor: `agent:${AGENT}`, readAt: null }])

    const dmKey = toDmKey(OTHER, ME)
    expect(dmKey).toBe(`${ME}|${OTHER}`)
    const dm = createSession(ws, { createdBy: ME, dmKey, people: [OTHER] }, db)
    expect(getChatMembers(W, dm.id, db)).toEqual([{ actor: ME, readAt: expect.any(Number) }, { actor: OTHER, readAt: null }])
    expect(getDmChatId(W, dmKey, db)).toBe(dm.id)
    expect(getChat(W, ws.rootPath, dm.id, db)).toMatchObject({ dmKey })
    expect(getChat(W, ws.rootPath, dm.id, db)!.agentId).toBeUndefined()
    // the pair's second DM is refused by the database (the server opens the first instead)
    expect(() => createSession(ws, { createdBy: OTHER, dmKey, people: [ME] }, db)).toThrow()
    // chats without a key never collide
    createSession(ws, { createdBy: ME }, db)
    createSession(ws, { createdBy: ME }, db)

    // read state per person; removing a member; deleting the chat deletes its members
    updateChatMemberRead(W, dm.id, OTHER, 500, db)
    expect(getChatMembers(W, dm.id, db)[1]).toEqual({ actor: OTHER, readAt: 500 })
    expect(addChatMembers(W, dm.id, [OTHER, `agent:${AGENT}`], {}, db)).toEqual([`agent:${AGENT}`])
    expect(removeChatMember(W, dm.id, OTHER, db)).toBe(true)
    expect(removeChatMember(W, dm.id, OTHER, db)).toBe(false)
    deleteChat(W, dm.id, db)
    expect(getChatMembers(W, dm.id, db)).toEqual([])
  })

  it('initChatMembers: once per chat without members: creator, agent (the default one for none), senders; read_at copied while it exists', async () => {
    const db = await setup()
    const { write } = writer(db, { members: false })
    // as before members: chats written without member rows, the old read_at column still there
    db.run(sql.raw('ALTER TABLE chats ADD COLUMN read_at integer'))
    await write(chatOf('pb1', { agentId: AGENT }), [msg('u1', 'user', 100, { content: 'a', sender: OTHER }), msg('u2', 'user', 200, { content: 'b', sender: OTHER }), msg('x1', 'assistant', 300, { content: 'c', sender: 'user:ignored' })])
    await write(chatOf('pb2', { createdBy: OTHER }))
    db.run(sql`UPDATE chats SET read_at = 777 WHERE id = 'pb1'`)
    db.run(sql`INSERT INTO chats (id, workspace_id, created_by, metadata, created_at, updated_at) VALUES ('pb3', ${W}, ${ME}, 'not json', 1, 1)`)

    expect(initChatMembers((ws) => (ws === W ? 'defaultagent' : undefined), db)).toBe(3)
    expect(getChatMembers(W, 'pb1', db)).toEqual([{ actor: ME, readAt: 777 }, { actor: OTHER, readAt: 777 }, { actor: `agent:${AGENT}`, readAt: null }])
    expect(actors(db, 'pb2')).toEqual([OTHER, 'agent:defaultagent'])
    expect(getChat(W, '/tmp/w', 'pb2', db)!.agentId).toBe('defaultagent')
    expect(actors(db, 'pb3')).toEqual([ME, 'agent:defaultagent'])

    // idempotent: nothing left to do, nothing changes, and an unreadable metadata is left alone
    expect(initChatMembers(() => 'other', db)).toBe(0)
    expect(actors(db, 'pb2')).toEqual([OTHER, 'agent:defaultagent'])
    expect(db.all<{ metadata: string }>(sql`SELECT metadata FROM chats WHERE id = 'pb3'`)[0]!.metadata).toBe('not json')
  })

  it('without the old column, people start read at the chat updated_at', async () => {
    const db = await setup()
    await writer(db, { members: false }).write(chatOf('pc1', { lastMessageAt: 4242 }))
    expect(initChatMembers(() => undefined, db)).toBe(1)
    expect(getChatMembers(W, 'pc1', db)).toEqual([{ actor: ME, readAt: 4242 }])
  })
})

// ---------------------------------------------------------------------------------------------------------------

describe('reads', () => {
  it('pages the newest 50 first and older pages by message id', async () => {
    const db = await setup()
    const { write } = writer(db)
    await write(chatOf('p1'), Array.from({ length: 120 }, (_, i) => msg(`m${i}`, i % 2 ? 'assistant' : 'user', 1000 + i, { content: `message ${i}` })))
    const first = getMessagesPage(W, 'p1', '/tmp/w/sessions/p1', {}, db)
    expect(first.messages.map((m) => m.id)).toEqual(Array.from({ length: 50 }, (_, i) => `m${70 + i}`))
    expect(first.olderCount).toBe(70)
    const second = getMessagesPage(W, 'p1', '/tmp/w/sessions/p1', { beforeId: 'm70' }, db)
    expect(second.messages[0]!.id).toBe('m20')
    expect(second.olderCount).toBe(20)
    const last = getMessagesPage(W, 'p1', '/tmp/w/sessions/p1', { beforeId: 'm20' }, db)
    expect(last.messages.map((m) => m.id)).toEqual(Array.from({ length: 20 }, (_, i) => `m${i}`))
    expect(last.olderCount).toBe(0)
  })

  it('searches with diacritics folded, prefixes, several words, and only the chats of the workspace the caller is a member of', async () => {
    const db = await setup()
    const { write } = writer(db)
    await write(chatOf('s1'), [msg('u1', 'user', 1, { content: 'Le café est prêt pour Zoë' }), msg('h1', 'user', 2, { content: 'secret café', hidden: true })])
    await write(chatOf('s2', { createdBy: OTHER }), [msg('u1', 'user', 1, { content: 'café of somebody else' })])
    await write(chatOf('s3', { workspaceId: 'wsotherother' }), [msg('u1', 'user', 1, { content: 'café in another workspace' })])
    addChatMembers(W, 's1', [ME], {}, db)
    addChatMembers(W, 's2', [OTHER], {}, db)
    addChatMembers('wsotherother', 's3', [ME], {}, db)

    expect(searchChats(W, ME, 'cafe', {}, db)).toEqual([{ sessionId: 's1', title: null, matchCount: 1, matches: [{ sessionId: 's1', lineNumber: 1, snippet: 'Le café est prêt pour Zoë' }] }])
    expect(searchChats(W, ME, 'pre zoe', {}, db).map((r) => r.sessionId)).toEqual(['s1'])
    expect(searchChats(W, ME, 'cafe "', {}, db).map((r) => r.sessionId)).toEqual(['s1'])
    expect(searchChats(W, ME, 'missing', {}, db)).toEqual([])
    expect(searchChats(W, OTHER, 'cafe', {}, db).map((r) => r.sessionId)).toEqual(['s2'])
    expect(searchChats(W, 'user:cccccccccccc', 'cafe', {}, db)).toEqual([])
    expect(getChats(W, '/tmp/w', { actor: OTHER }, db).map((c) => c.id)).toEqual(['s2'])

    // shared: once a member, the other person finds it too; the workspace owner who is not a member never does
    addChatMembers(W, 's1', [OTHER], {}, db)
    expect(searchChats(W, OTHER, 'cafe', {}, db).map((r) => r.sessionId).sort()).toEqual(['s1', 's2'])
    expect(getChats(W, '/tmp/w', { actor: OTHER }, db).map((c) => c.id).sort()).toEqual(['s1', 's2'])
    expect(searchChats(W, ME, 'somebody', {}, db)).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------------------------
// The search index: deletes, renumbered rowids, the old contentless table
// ---------------------------------------------------------------------------------------------------------------

describe('search index', () => {
  /** Two chats with their own words, on a file database, closed so a fresh handle runs `initMessages` again. */
  async function indexed() {
    const { path, db } = await fileDb()
    const { write } = writer(db)
    await write(chatOf('x1'), [msg('u1', 'user', 1, { content: 'apple pie' }), msg('a1', 'assistant', 2, { content: 'apple crumble' }), msg('t1', 'tool', 3, { toolName: 'Bash' })])
    await write(chatOf('x2'), [msg('u1', 'user', 1, { content: 'banana bread' }), msg('a1', 'assistant', 2, { content: 'banana split' })])
    db.$client.close()
    return path
  }
  const hits = (db: Db, query: string) => searchChats(W, ME, query, {}, db).map((r) => [r.sessionId, r.matchCount, r.matches.map((m) => m.snippet)])

  it('a renumbering of the messages rowids (a db:push table rebuild) is found at the next init and rebuilt', async () => {
    const path = await indexed()
    const raw = openDb(path)
    raw.$client.exec('CREATE TABLE tmp AS SELECT * FROM messages; DELETE FROM messages; INSERT INTO messages SELECT * FROM tmp ORDER BY rowid DESC; DROP TABLE tmp')
    expect(raw.all(sql`SELECT f.text FROM messages_fts f JOIN messages m ON m.rowid = f.rowid WHERE m.chat_id = 'x1'`)).not.toContainEqual({ text: 'apple pie' })
    raw.$client.close()

    const db = openDb(path)
    initMessages(db)
    expect(hits(db, 'apple')).toEqual([['x1', 2, ['apple crumble', 'apple pie']]])
    expect(hits(db, 'banana')).toEqual([['x2', 2, ['banana split', 'banana bread']]])
    expect(count(db, sql`SELECT count(*) AS n FROM messages_fts`)).toBe(4)
    db.$client.close()
  })

  it('deleting a chat removes its messages from search', async () => {
    const db = openDb(await indexed())
    expect(hits(db, 'banana')).toHaveLength(1)
    deleteChat(W, 'x2', db)
    expect(hits(db, 'banana')).toEqual([])
    expect(hits(db, 'apple')).toHaveLength(1)
    expect(count(db, sql`SELECT count(*) AS n FROM messages_fts`)).toBe(2)
    db.$client.close()
  })

  it('replaces an old contentless index with one that stores its text, and rebuilds it', async () => {
    const path = await indexed()
    const raw = openDb(path)
    raw.$client.exec(`DROP TABLE messages_fts; CREATE VIRTUAL TABLE messages_fts USING fts5(text, content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2', prefix='2 3')`)
    raw.$client.close()

    const db = openDb(path)
    initMessages(db)
    expect(db.all<{ sql: string }>(sql`SELECT sql FROM sqlite_master WHERE name = 'messages_fts'`)[0]!.sql).not.toContain('content')
    expect(hits(db, 'apple')).toEqual([['x1', 2, ['apple crumble', 'apple pie']]])
    deleteChat(W, 'x1', db)
    expect(hits(db, 'apple')).toEqual([])
    db.$client.close()
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Durability: boot recovery, crashes, concurrent writers
// ---------------------------------------------------------------------------------------------------------------

/** Runs a child Bun process on a file database (the crash and concurrency cases need a real process to kill). */
function child(script: string, args: string[]) {
  const dir = tempDir('otto-chats-child-')
  const file = join(dir, 'child.ts')
  writeFileSync(file, `
import { sql } from 'drizzle-orm'
import { openDb } from '${join(ROOT, 'packages/shared/src/db/index.ts')}'
import { initMessages, toMessageRow, writeMessages } from '${join(ROOT, 'packages/shared/src/sessions/messages.ts')}'
import { writeChat } from '${join(ROOT, 'packages/shared/src/sessions/chats.ts')}'
import { ChatPersistenceQueue } from '${join(ROOT, 'packages/shared/src/sessions/persistence-queue.ts')}'
const [dbPath, ...rest] = process.argv.slice(2)
const db = openDb(dbPath)
initMessages(db)
const chat = (id: string) => ({ id, workspaceId: '${W}', workspaceRootPath: '/tmp/w', createdBy: '${ME}', createdAt: 1, lastUsedAt: 1 })
const msg = (id: string, timestamp: number) => ({ id, type: 'user', content: 'row ' + id, timestamp })
${script}
`)
  return Bun.spawn([process.execPath, file, ...args], { cwd: dir, env: { ...process.env, OTTO_CONFIG_DIR: dir }, stdout: 'pipe', stderr: 'pipe' })
}

async function fileDb() {
  const path = join(tempDir('otto-chats-file-'), 'otto.db')
  const db = await setup(openDb(path))
  return { path, db }
}

describe('durability', () => {
  it('boot recovery marks a partial answer and running tool calls interrupted, and clears the running turn', async () => {
    const db = await setup()
    const { write } = writer(db)
    await write({ ...chatOf('r1'), running: true }, [
      msg('u1', 'user', 1, { content: 'do it' }),
      msg('t1', 'tool', 2, { toolName: 'Bash', toolStatus: 'executing' }),
      msg('t0', 'tool', 2, { toolName: 'Read', toolStatus: 'completed', toolResult: 'ok' }),
      msg('partial-x', 'assistant', 3, { content: 'half a giraffe', partial: true }),
    ])
    await write(chatOf('r2'), [msg('u1', 'user', 1, { content: 'idle chat' })])

    expect(runChatsRecovery(db)).toEqual({ chats: 1, partial: 1, tools: 1 })
    const messages = getMessagesPage(W, 'r1', getSessionPath('/tmp/w', 'r1'), {}, db).messages as Array<StoredMessage & Record<string, unknown>>
    expect(messages.find((m) => m.id === 't1')).toMatchObject({ toolStatus: 'error', isError: true, interrupted: true })
    expect(messages.find((m) => m.id === 't0')).toMatchObject({ toolStatus: 'completed' })
    expect(messages.find((m) => m.id === 'partial-x')).toMatchObject({ content: 'half a giraffe', interrupted: true })
    expect(messages.find((m) => m.id === 'partial-x')!.partial).toBeUndefined()
    expect(messages.at(-1)).toMatchObject({ type: 'info', content: 'Response interrupted' })
    expect(searchChats(W, ME, 'giraffe', {}, db).map((r) => r.sessionId)).toEqual(['r1'])
    expect(db.all(sql`SELECT id FROM chats WHERE run_started_at IS NOT NULL`)).toEqual([])
    expect(runChatsRecovery(db)).toEqual({ chats: 0, partial: 0, tools: 0 })
  })

  it('a process killed inside a batch leaves nothing of it; one killed after the commit leaves all of it, once', async () => {
    const { path, db } = await fileDb()
    const { write } = writer(db)
    await write(chatOf('k1'), [msg('m1', 'user', 1, { content: 'row m1' }), msg('m2', 'user', 2, { content: 'row m2' })])
    db.$client.close()

    const killed = child(`
db.transaction((tx) => {
  writeMessages(tx, '${W}', 'k1', ['m3', 'm4', 'm5'].map((id, i) => ({ ...toMessageRow(msg(id, 10 + i), '/tmp/w/sessions/k1'), reposition: true })), ['m1'])
  writeChat(tx, { ...chat('k1'), name: 'never committed' })
  process.kill(process.pid, 'SIGKILL')
}, { behavior: 'immediate' })`, [path])
    expect(await killed.exited).not.toBe(0)
    expect(killed.signalCode).toBe('SIGKILL')

    const after = openDb(path)
    expect(getMessageRows(W, 'k1', after).map((row) => row.id)).toEqual(['m1', 'm2'])
    expect(count(after, sql`SELECT count(*) AS n FROM messages_fts`)).toBe(2)
    expect(getChat(W, '/tmp/w', 'k1', after)!.name).toBeUndefined()
    expect(after.all(sql`PRAGMA integrity_check`)).toEqual([{ integrity_check: 'ok' }])
    after.$client.close()

    const committed = child(`
const queue = new ChatPersistenceQueue({ db: () => db })
queue.enqueue('k1', () => ({ chat: chat('k1'), sessionDir: '/tmp/w/sessions/k1', messages: [msg('m3', 30), msg('m4', 31)] }))
await queue.flush('k1')
process.kill(process.pid, 'SIGKILL')`, [path])
    await committed.exited
    const again = openDb(path)
    expect(getMessageRows(W, 'k1', again).map((row) => row.id)).toEqual(['m1', 'm2', 'm3', 'm4'])
    // the same write again (a retry after the restart, unseeded): nothing doubles, positions stay unique
    const retry = new ChatPersistenceQueue({ db: () => again })
    retry.enqueue('k1', () => ({ chat: chatOf('k1'), sessionDir: '/tmp/w/sessions/k1', messages: [msg('m3', 'user', 30, { content: 'row m3' }), msg('m4', 'user', 31, { content: 'row m4' })] }))
    await retry.flush('k1')
    const rows = positions(again, 'k1')
    expect(rows.map((row) => row.id)).toEqual(['m1', 'm2', 'm3', 'm4'])
    expect(new Set(rows.map((row) => row.position)).size).toBe(4)
    expect(count(again, sql`SELECT count(*) AS n FROM messages_fts`)).toBe(4)
    again.$client.close()
  })

  it('two processes writing one chat at once: both commit, positions stay unique, neither deletes the other rows', async () => {
    const { path, db } = await fileDb()
    const { write } = writer(db)
    await write(chatOf('cc'), [msg('seed', 'user', 1, { content: 'seed' })])
    db.$client.close()

    const script = `
const [prefix] = rest
const queue = new ChatPersistenceQueue({ db: () => db, debounceMs: 1 })
const mine = []
for (let i = 0; i < 100; i++) {
  mine.push(msg(prefix + i, 100 + i))
  queue.enqueue('cc', () => ({ chat: chat('cc'), sessionDir: '/tmp/w/sessions/cc', messages: [...mine] }))
  if (i % 10 === 9) await queue.flush('cc')
}
await queue.flushAll()`
    const a = child(script, [path, 'a'])
    const b = child(script, [path, 'b'])
    const [codeA, codeB] = await Promise.all([a.exited, b.exited])
    expect([codeA, codeB, await new Response(a.stderr).text(), await new Response(b.stderr).text()]).toEqual([0, 0, '', ''])

    const after = openDb(path)
    const rows = positions(after, 'cc')
    expect(rows).toHaveLength(201)
    expect(new Set(rows.map((row) => row.position)).size).toBe(201)
    expect(rows.filter((row) => row.id.startsWith('a'))).toHaveLength(100)
    expect(rows.filter((row) => row.id.startsWith('b'))).toHaveLength(100)
    after.$client.close()
  }, 30_000)
})

// ---------------------------------------------------------------------------------------------------------------
// Performance sanity (numbers printed; generous bounds so a slow CI machine does not flake)
// ---------------------------------------------------------------------------------------------------------------

describe('performance', () => {
  it('a 5k-message chat: written, loaded whole, paged and searched in milliseconds', async () => {
    const { db } = await fileDb()
    const { queue } = writer(db)
    const chat = chatOf('big')
    const messages = Array.from({ length: 5000 }, (_, i) =>
      i % 4 === 3
        ? msg(`m${i}`, 'tool', 1000 + i, { toolName: 'Bash', toolUseId: `t${i}`, toolStatus: 'completed', toolInput: { command: 'ls -la' }, toolResult: 'x'.repeat(2000) })
        : msg(`m${i}`, i % 2 ? 'assistant' : 'user', 1000 + i, { content: `message number ${i} about the quarterly ${i % 7 ? 'report' : 'budget'} and its numbers` }),
    )
    const time = async (run: () => unknown) => {
      const start = performance.now()
      await run()
      return Math.round((performance.now() - start) * 100) / 100
    }
    const flush = (list: StoredMessage[]) => {
      queue.enqueue('big', () => ({ chat, sessionDir: '/tmp/w/sessions/big', messages: list }))
      return queue.flush('big')
    }

    const writeAll = await time(() => flush(messages))
    const loadAll = await time(() => loadSession({ id: W, rootPath: '/tmp/w' }, 'big', db))
    const pageNewest = await time(() => getMessagesPage(W, 'big', '/tmp/w/sessions/big', {}, db))
    const pageOlder = await time(() => getMessagesPage(W, 'big', '/tmp/w/sessions/big', { beforeId: 'm2500' }, db))
    messages.push(msg('m5000', 'user', 9000, { content: 'one more' }))
    const appendOne = await time(() => flush(messages))
    const search = await time(() => searchChats(W, ME, 'budget', {}, db))
    const list = await time(() => getChats(W, '/tmp/w', {}, db))

    console.log(`[perf] 5k-message chat (file db, synchronous=FULL): write all ${writeAll} ms, load whole ${loadAll} ms, newest page of 50 ${pageNewest} ms, older page ${pageOlder} ms, append one (hashing 5k loaded rows) ${appendOne} ms, search ${search} ms, list ${list} ms`)
    expect(pageNewest).toBeLessThan(50)
    expect(pageOlder).toBeLessThan(50)
    expect(loadAll).toBeLessThan(1000)
    expect(appendOne).toBeLessThan(500)
    expect(getMessageRows(W, 'big', db)).toHaveLength(5001)
  }, 60_000)
})
