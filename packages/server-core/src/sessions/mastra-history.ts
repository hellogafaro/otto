import type { MastraDBMessage } from '@mastra/core/agent'
import { initDb } from '@otto/shared/db'
import type { StoredMessage } from '@otto/core/types'
import {
  expandSessionPath,
  makeSessionPathPortable,
} from '../../../shared/src/sessions/messages.ts'
import { openMastraStorage } from './mastra-storage'
import { getNativeMessages } from '../../../shared/src/sessions/native-messages.ts'

let runtime: ReturnType<typeof openMastraStorage> | undefined

export async function initMastraHistory() {
  runtime ??= openMastraStorage()
  return runtime
}

export async function writeMastraHistory(input: {
  workspaceId: string
  chatId: string
  title?: string
  sessionDir: string
  messages: StoredMessage[]
}) {
  const { storage } = await initMastraHistory()
  const memory = await storage.getStore('memory')
  if (!memory) throw new Error('Native conversation storage is unavailable.')
  const thread = await memory.getThreadById({
    threadId: input.chatId,
    resourceId: input.workspaceId,
  })
  if (!thread)
    await memory.saveThread({
      thread: {
        id: input.chatId,
        resourceId: input.workspaceId,
        title: input.title ?? 'Chat',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    })
  const current = await memory.listMessages({
    threadId: input.chatId,
    resourceId: input.workspaceId,
    perPage: false,
  })
  const known = new Map(
    current.messages.map((row) => [
      String(row.content.metadata?.ottoId ?? row.id),
      row.id,
    ]),
  )
  const retained = new Set<string>()
  const messages: MastraDBMessage[] = input.messages.map(
    (message, position) => {
      const id = known.get(message.id) ?? crypto.randomUUID()
      retained.add(id)
      const fields = JSON.parse(
        makeSessionPathPortable(JSON.stringify(message), input.sessionDir),
      ) as StoredMessage
      return {
        id,
        threadId: input.chatId,
        resourceId: input.workspaceId,
        role:
          message.type === 'user'
            ? 'user'
            : message.type === 'assistant' || message.type === 'tool'
              ? 'assistant'
              : 'system',
        createdAt: new Date(message.timestamp ?? Date.now()),
        type: 'v2',
        content: {
          format: 2,
          parts: [
            {
              type: 'text',
              text:
                message.type === 'tool'
                  ? (message.toolResult ?? '')
                  : message.content,
            },
          ],
          metadata: { ottoId: message.id, position, otto: fields },
        },
      }
    },
  )
  await memory.saveMessages({ messages })
  const removed = current.messages
    .filter((message) => !retained.has(message.id))
    .map((message) => message.id)
  if (removed.length) await memory.deleteMessages(removed)
}

export async function importMastraHistory(input: {
  workspaceId: string
  chatId: string
  title?: string
  sessionDir: string
}) {
  const db = initDb()
  const rows = db.$client
    .query(
      'SELECT id,type,content,created_at,parent_id FROM messages WHERE workspace_id=? AND chat_id=? ORDER BY position',
    )
    .all(input.workspaceId, input.chatId) as {
    id: string
    type: string
    content: string
    created_at: number
    parent_id: string | null
  }[]
  if (!rows.length) return
  if (
    rows.some(
      (row) =>
        row.parent_id !== null ||
        ![
          'user',
          'assistant',
          'tool',
          'error',
          'info',
          'warning',
          'plan',
          'auth-request',
        ].includes(row.type),
    )
  )
    throw new Error(
      'This legacy history requires a reviewed native import before it can run.',
    )
  const messages = rows.map(
    (row) =>
      ({
        ...JSON.parse(expandSessionPath(row.content, input.sessionDir)),
        id: row.id,
        type: row.type,
        timestamp: row.created_at,
      }) as StoredMessage,
  )
  const existing = getNativeMessages(
    input.workspaceId,
    input.chatId,
    input.sessionDir,
  )
  const legacyById = new Map(
    messages.map((message) => [message.id, JSON.stringify(message)]),
  )
  if (
    existing.some(
      (message) => legacyById.get(message.id) !== JSON.stringify(message),
    )
  )
    throw new Error(
      'Legacy and native histories differ; refusing an automatic merge.',
    )
  await writeMastraHistory({ ...input, messages })
  const verified = getNativeMessages(
    input.workspaceId,
    input.chatId,
    input.sessionDir,
  )
  if (JSON.stringify(verified) !== JSON.stringify(messages))
    throw new Error(
      'Native import verification failed; legacy history was preserved.',
    )
  db.transaction((tx) => {
    const ids = db.$client
      .query('SELECT rowid FROM messages WHERE workspace_id=? AND chat_id=?')
      .all(input.workspaceId, input.chatId) as { rowid: number }[]
    for (const row of ids)
      db.$client.query('DELETE FROM messages_fts WHERE rowid=?').run(row.rowid)
    db.$client
      .query('DELETE FROM messages WHERE workspace_id=? AND chat_id=?')
      .run(input.workspaceId, input.chatId)
  })
}

export function assertLegacyHistoryImported(workspaceId:string,chatId?:string){
  const sqlite=initDb().$client
  const row=chatId?sqlite.query('SELECT id FROM messages WHERE workspace_id=? AND chat_id=? LIMIT 1').get(workspaceId,chatId):sqlite.query('SELECT id FROM messages WHERE workspace_id=? LIMIT 1').get(workspaceId)
  if(row)throw new Error('Legacy app history requires the reviewed offline native import before enabling this runtime. The existing rows are unchanged.')
}

export async function recoverMastraHistory(input: {
  workspaceId: string
  chatId: string
  sessionDir: string
}) {
  const messages = getNativeMessages(
    input.workspaceId,
    input.chatId,
    input.sessionDir,
  )
  for (const message of messages) {
    if (message.isQueued) {
      message.isQueued = false
    }
    if ((message as StoredMessage & { partial?: boolean }).partial) {
      delete (message as StoredMessage & { partial?: boolean }).partial
      message.isIntermediate = true
    }
    if (
      message.type === 'tool' &&
      ['pending', 'executing'].includes(message.toolStatus ?? '')
    ) {
      message.toolStatus = 'error'
      message.isError = true
      message.toolResult =
        'Interrupted by a restart; the action may have run. Verify the result before repeating it.'
    }
  }
  messages.push({
    id: crypto.randomUUID(),
    type: 'info',
    content:
      'Response interrupted by a restart. Pending work was not replayed.',
    timestamp: Date.now(),
  })
  await writeMastraHistory({ ...input, messages })
  initDb()
    .$client.query(
      'UPDATE chats SET run_started_at=NULL WHERE id=? AND workspace_id=?',
    )
    .run(input.chatId, input.workspaceId)
}

export async function closeMastraHistory() {
  const existing = runtime
  runtime = undefined
  if (existing) (await existing).close()
}

export async function deleteMastraHistory(workspaceId: string, chatId: string) {
  const memory = await (await initMastraHistory()).storage.getStore('memory')
  if (
    await memory?.getThreadById({ threadId: chatId, resourceId: workspaceId })
  )
    await memory?.deleteThread({ threadId: chatId })
}
