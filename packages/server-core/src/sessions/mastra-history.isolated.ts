import { afterAll, expect, it } from 'bun:test'
import { join } from 'node:path'
import { initDb } from '@otto/shared/db'
import { CONFIG_DIR } from '@otto/shared/config/paths'
import {
  createSession,
  loadSession,
  getSessionMessages,
  listSessions,
  searchChats,
  sessionPersistenceQueue,
} from '@otto/shared/sessions'
import { addWorkspace, saveConfig } from '@otto/shared/config'
import {
  writeMastraHistory,
  importMastraHistory,
  closeMastraHistory,
  recoverMastraHistory,
  initMastraHistory,
  assertLegacyHistoryImported,
} from './mastra-history'
import { ChatPersistenceQueue } from '../../../shared/src/sessions/persistence-queue.ts'
import { getNativeMessages } from '../../../shared/src/sessions/native-messages.ts'
import { createSecretsStore } from '@otto/shared/secrets'
import { convertLegacyIds } from '../../../../scripts/db-uuid.ts'
import { performance } from 'node:perf_hooks'

process.env.OTTO_MASTRA_CHAT = '1'
afterAll(async () => {
  await sessionPersistenceQueue.flushAll()
  await closeMastraHistory()
  delete process.env.OTTO_MASTRA_CHAT
})

it('imports mapped legacy history once with source effects/attribution and no parallel message rows', async () => {
  saveConfig({ workspaces: [] })
  const workspace = addWorkspace({
    name: 'Native history',
    rootPath: join(CONFIG_DIR, 'history'),
  })
  const chat = createSession(workspace, {
    createdBy: 'user:human0000001',
    name: 'Legacy',
  })
  const db = initDb(),
    sqlite = db.$client
  const key = Buffer.alloc(32, 5),
    secrets = createSecretsStore(db, key),
    secret = secrets.createSecret('Fixture', 'fixture-only')
  secrets.rebindSecretId(secret, 'secret000001')
  sqlite.exec(
    "INSERT INTO users(id,name,email,created_at,updated_at) VALUES('human0000001','Fixture','history@example.test',0,0)",
  )
  const messages = [
    {
      id: 'message00001',
      type: 'user',
      timestamp: 1,
      content: 'Draft launch brief',
      sender: 'user:human0000001',
    },
    {
      id: 'message00002',
      type: 'assistant',
      timestamp: 2,
      content: 'Working',
      author: 'agent:agent0000001',
      isIntermediate: true,
    },
    {
      id: 'message00003',
      type: 'tool',
      timestamp: 3,
      content: '',
      author: 'agent:agent0000001',
      toolName: 'create_document',
      toolUseId: 'call1',
      toolStatus: 'completed',
      toolResult: '{"id":"completed-effect"}',
    },
    {
      id: 'message00004',
      type: 'assistant',
      timestamp: 4,
      content: 'Saved launch brief',
      author: 'agent:agent0000001',
    },
  ]
  for (const message of messages)
    sqlite
      .query(
        'INSERT INTO messages(workspace_id,chat_id,id,position,type,content,created_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        workspace.id,
        chat.id,
        message.id,
        message.timestamp,
        message.type,
        JSON.stringify({
          ...message,
          id: undefined,
          type: undefined,
          timestamp: undefined,
        }),
        message.timestamp,
      )
  const mapping = convertLegacyIds(sqlite, key)
  const human = mapping.get('human0000001')!
  expect(secrets.getSecret(mapping.get('secret000001')!)).toBe('fixture-only')
  expect(()=>assertLegacyHistoryImported(workspace.id,chat.id)).toThrow('offline native import')
  await importMastraHistory({
    workspaceId: workspace.id,
    chatId: chat.id,
    sessionDir: join(workspace.rootPath, 'sessions', chat.id),
  })
  expect(
    sqlite
      .query('SELECT count(*) n FROM messages WHERE chat_id=?')
      .get(chat.id),
  ).toEqual({ n: 0 })
  expect(
    sqlite
      .query('SELECT count(*) n FROM mastra_messages WHERE thread_id=?')
      .get(chat.id),
  ).toEqual({ n: 4 })
  const loaded = loadSession(workspace, chat.id)!
  expect(loaded.messages[0].sender).toBe('user:' + human)
  expect(loaded.messages[2].toolResult).toContain('completed-effect')
  const page = getSessionMessages(workspace, chat.id, { limit: 2 })
  expect(page.messages.map((message) => message.type)).toEqual([
    'tool',
    'assistant',
  ])
  expect(page.olderCount).toBe(2)
  expect(
    listSessions(workspace).find((row) => row.id === chat.id),
  ).toMatchObject({ messageCount: 4, preview: 'Draft launch brief' })
  expect(searchChats(workspace.id, 'user:' + human, 'launch')).toHaveLength(1)
  expect(searchChats(workspace.id, 'user:foreign', 'launch')).toEqual([])
  await importMastraHistory({
    workspaceId: workspace.id,
    chatId: chat.id,
    sessionDir: '',
  })
  await closeMastraHistory()
  expect(loadSession(workspace, chat.id)!.messages).toHaveLength(4)
  delete process.env.OTTO_MASTRA_CHAT
  expect(loadSession(workspace,chat.id)!.messages).toHaveLength(4)
  expect(createSession(workspace,{createdBy:'user:'+human}).id).toBeTruthy()
  expect(sqlite.query('SELECT count(*) n FROM messages WHERE chat_id=?').get(chat.id)).toEqual({n:0})
  expect(()=>assertLegacyHistoryImported(workspace.id,chat.id)).not.toThrow()
  expect(sqlite.query('SELECT count(*) n FROM mastra_messages WHERE thread_id=?').get(chat.id)).toEqual({n:4})
  process.env.OTTO_MASTRA_CHAT='1'
})

it('marks unfinished work on restart without replaying completed side effects or queues', async () => {
  const workspace = addWorkspace({
    name: 'Restart',
    rootPath: join(CONFIG_DIR, 'restart'),
  })
  const chat = createSession(workspace, { createdBy: 'user:human0000001' })
  const sessionDir = join(workspace.rootPath, 'sessions', chat.id)
  await writeMastraHistory({
    workspaceId: workspace.id,
    chatId: chat.id,
    sessionDir,
    messages: [
      {
        id: crypto.randomUUID(),
        type: 'tool',
        timestamp: 1,
        content: '',
        toolName: 'create_task',
        toolStatus: 'completed',
        toolResult: '{"id":"already-created"}',
      },
      {
        id: crypto.randomUUID(),
        type: 'tool',
        timestamp: 2,
        content: 'Running',
        toolName: 'update_document',
        toolStatus: 'executing',
      },
      {
        id: crypto.randomUUID(),
        type: 'user',
        timestamp: 3,
        content: 'queued follow-up',
        isQueued: true,
      },
    ],
  })
  initDb()
    .$client.query('UPDATE chats SET run_started_at=1 WHERE id=?')
    .run(chat.id)
  await recoverMastraHistory({
    workspaceId: workspace.id,
    chatId: chat.id,
    sessionDir,
  })
  const rows = getNativeMessages(workspace.id, chat.id, sessionDir)
  expect(rows[0].toolResult).toContain('already-created')
  expect(rows[0].toolStatus).toBe('completed')
  expect(rows[1]).toMatchObject({ toolStatus: 'error', isError: true })
  expect(rows[1].toolResult).toContain('may have run')
  expect(rows[2].isQueued).toBe(false)
  expect(rows.at(-1)!.content).toContain('not replayed')
  expect(
    initDb()
      .$client.query('SELECT run_started_at FROM chats WHERE id=?')
      .get(chat.id),
  ).toEqual({ run_started_at: null })
})

it('refuses unsupported legacy tree entries without deleting them', async () => {
  const workspace = addWorkspace({
    name: 'Refusal',
    rootPath: join(CONFIG_DIR, 'refusal'),
  })
  const chat = createSession(workspace, { createdBy: 'user:human0000001' })
  initDb()
    .$client.query(
      'INSERT INTO messages(workspace_id,chat_id,id,position,parent_id,type,content,created_at) VALUES(?,?,?,1,?,?,?,1)',
    )
    .run(
      workspace.id,
      chat.id,
      'legacytree01',
      'parent',
      'assistant',
      '{"content":"keep"}',
    )
  await expect(
    importMastraHistory({
      workspaceId: workspace.id,
      chatId: chat.id,
      sessionDir: '',
    }),
  ).rejects.toThrow('reviewed native import')
  expect(
    initDb()
      .$client.query('SELECT count(*) n FROM messages WHERE chat_id=?')
      .get(chat.id),
  ).toEqual({ n: 1 })
})

it('concurrent scoped writes keep one transcript each and persistence failure retries only storage', async () => {
  const workspace = addWorkspace({
    name: 'Concurrent',
    rootPath: join(CONFIG_DIR, 'concurrent'),
  })
  const a = createSession(workspace, { createdBy: 'user:human0000001' }),
    b = createSession(workspace, { createdBy: 'user:human0000001' })
  const make = (chatId: string, text: string) => ({
    workspaceId: workspace.id,
    chatId,
    sessionDir: '',
    messages: [
      {
        id: crypto.randomUUID(),
        type: 'user' as const,
        timestamp: 1,
        content: text,
        sender: 'user:human0000001',
      },
    ],
  })
  const first = make(a.id, 'one'),
    second = make(b.id, 'two')
  await Promise.all([writeMastraHistory(first), writeMastraHistory(second)])
  expect(
    getNativeMessages(workspace.id, a.id, '').map((row) => row.content),
  ).toEqual(['one'])
  expect(
    getNativeMessages(workspace.id, b.id, '').map((row) => row.content),
  ).toEqual(['two'])
  expect(getNativeMessages('foreign', a.id, '')).toEqual([])
  const runtime = await initMastraHistory(),
    memory = await runtime.storage.getStore('memory')
  const save = memory!.saveMessages.bind(memory)
  memory!.saveMessages = async () => {
    throw new Error('Controlled storage failure')
  }
  const queue = new ChatPersistenceQueue({ retryMs: 60000 })
  const next = make(a.id, 'three')
  queue.enqueue(a.id, () => ({
    chat: { ...a, workspaceId: workspace.id, running: false },
    sessionDir: '',
    messages: next.messages,
    writeNativeMessages: (messages) =>
      writeMastraHistory({ ...next, messages }),
  }))
  await expect(queue.flush(a.id)).rejects.toThrow('Controlled storage failure')
  expect(queue.hasPending(a.id)).toBe(true)
  expect(getNativeMessages(workspace.id, a.id, '')[0].content).toBe('one')
  memory!.saveMessages = save
  await queue.flush(a.id)
  expect(
    getNativeMessages(workspace.id, a.id, '').map((row) => row.content),
  ).toEqual(['three'])
  expect(
    initDb()
      .$client.query('SELECT count(*) n FROM messages WHERE chat_id=?')
      .get(a.id),
  ).toEqual({ n: 0 })
})

it('searches full authorized native history and measures a 2100-row fixture',async()=>{
  const workspace=addWorkspace({name:'Search measure',rootPath:join(CONFIG_DIR,'search-measure')})
  const chat=createSession(workspace,{createdBy:'user:human0000001'})
  await writeMastraHistory({workspaceId:workspace.id,chatId:chat.id,sessionDir:'',messages:Array.from({length:2100},(_,index)=>({id:crypto.randomUUID(),type:'user',timestamp:index+1,content:index===0?'oldestneedle':'recentneedle '+index,sender:'user:human0000001'}))})
  const start=performance.now()
  const hits=searchChats(workspace.id,'user:human0000001','recentneedle')
  const elapsed=performance.now()-start
  expect(hits[0].matchCount).toBe(2099)
  expect(searchChats(workspace.id,'user:human0000001','oldestneedle')[0].matchCount).toBe(1)
  expect(searchChats(workspace.id,'user:foreign','recentneedle')).toEqual([])
  console.log(`Native search fixture: 2100 rows, full history, ${elapsed.toFixed(2)}ms.`)
},15000)
