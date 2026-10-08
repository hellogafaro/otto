import { initDb, type Db } from '../db/index.ts'
import { debug } from '../utils/debug.ts'
import { writeChat, type ChatSnapshot } from './chats.ts'
import {
  initMessages,
  toMessageRow,
  writeMessages,
  type MessageUpsert,
} from './messages.ts'
import type { StoredMessage } from './types.ts'
import { assertHistoryRuntime } from './native-messages.ts'

/** What a chat looks like at flush time: the queue asks for it then, so a burst of changes is one batch. */
export interface ChatWrite {
  chat: ChatSnapshot
  /** The chat folder: its absolute path is stored as `{{SESSION_PATH}}`. */
  sessionDir: string
  /** Every message the server holds for the chat; absent when they are not loaded (only the chat row is written). */
  messages?: StoredMessage[]
  writeNativeMessages?: (messages: StoredMessage[]) => Promise<void>
}

interface WrittenRow {
  hash: number | bigint
  createdAt: number
}

interface WrittenChat {
  /** What the database holds for each message, as far as this process knows (seeded on load, kept on commit). */
  rows: Map<string, WrittenRow>
  labels?: string
}

interface PendingWrite {
  snapshot: () => ChatWrite
  timer?: ReturnType<typeof setTimeout>
}

const isFinal = (message: StoredMessage) =>
  message.type === 'user' ||
  (message.type === 'assistant' &&
    !message.isIntermediate &&
    !(message as { partial?: boolean }).partial)

const hashRow = (type: string, content: string) =>
  Bun.hash(`${type}\0${content}`)

/**
 * The write path of chats (docs/messages-design.md section 4). Callers enqueue a chat after changing it; at most
 * `debounceMs` later (a pending write is not pushed back, so a stream of changes is written every `debounceMs`) the
 * queue takes the chat's snapshot and writes, in one short `BEGIN IMMEDIATE` transaction, only the messages whose
 * content changed since the last commit (an upsert by (chat_id, id) with their search entries), deletes the ones
 * that left, and updates the chat row. `flush` writes at once (a finished message, the user message before its
 * ack). A failed write is never dropped: the chat stays pending, is retried after `retryMs`, and `flush` rejects.
 *
 * Shortcut, with its limit: changed rows are found by hashing every loaded message at each flush (cheap for the
 * chats people have; a chat of tens of thousands of messages would want explicit dirty marks instead).
 */
export class ChatPersistenceQueue {
  private pending = new Map<string, PendingWrite>()
  private written = new Map<string, WrittenChat>()
  private writing = new Map<string, Promise<void>>()
  private writeTail = Promise.resolve()
  private readonly debounceMs: number
  private readonly retryMs: number
  private readonly db: () => Db

  constructor({
    debounceMs = 500,
    retryMs = 1000,
    db = () => initDb(),
  }: { debounceMs?: number; retryMs?: number; db?: () => Db } = {}) {
    this.debounceMs = debounceMs
    this.retryMs = retryMs
    this.db = db
  }

  /** Marks a chat to be written; `snapshot` is called when the write happens. */
  enqueue(chatId: string, snapshot: () => ChatWrite): void {
    assertHistoryRuntime(this.db())
    const entry = this.pending.get(chatId)
    if (entry) {
      entry.snapshot = snapshot
      return
    }
    const next: PendingWrite = { snapshot }
    next.timer = setTimeout(() => {
      this.flush(chatId).catch(() => {
        // logged and rescheduled by write()
      })
    }, this.debounceMs)
    this.pending.set(chatId, next)
  }

  /** Writes a pending chat now. Rejects when the write fails (the chat stays pending and is retried). */
  async flush(chatId: string): Promise<void> {
    const prior = this.writing.get(chatId)
    if (prior) await prior.catch(() => {})
    const entry = this.pending.get(chatId)
    if (!entry) return
    clearTimeout(entry.timer)
    this.pending.delete(chatId)
    const run = this.writeTail.then(async () => {
      let stage = 'snapshot'
      try {
        const snapshot = entry.snapshot()
        if (snapshot.writeNativeMessages && snapshot.messages) {
          stage = 'native_history'
          await snapshot.writeNativeMessages(snapshot.messages)
          snapshot.messages = undefined
        }
        stage = 'chat_metadata'
        this.write(chatId, snapshot)
      } catch (error) {
        let code = 'storage_error'
        let cause: unknown = error
        for (let depth = 0; depth < 4 && cause && typeof cause === 'object'; depth++) {
          const detail = cause as { code?: string; message?: string; cause?: unknown }
          if (['SQLITE_BUSY', 'SQLITE_LOCKED', 'TRANSACTION_ACTIVE'].includes(detail.code ?? '')) { code = detail.code!; break }
          if (detail.message?.toLowerCase().includes('database is locked')) { code = 'SQLITE_BUSY'; break }
          cause = detail.cause
        }
        console.error('[chats] write failed; pending snapshot retained for storage retry', { chatId, stage, code, retryMs: this.retryMs })
        if (!this.pending.has(chatId)) {
          entry.timer = setTimeout(() => {
            this.flush(chatId).catch(() => {})
          }, this.retryMs)
          this.pending.set(chatId, entry)
        }
        throw error
      }
    })
    this.writeTail = run.catch(() => {})
    this.writing.set(chatId, run)
    try {
      await run
    } finally {
      if (this.writing.get(chatId) === run) this.writing.delete(chatId)
    }
  }

  /** Writes every pending chat (quit). A chat that fails stays pending; the rest are still written. */
  async flushAll(): Promise<void> {
    await Promise.all(
      [...this.writing.values()].map((write) => write.catch(() => {})),
    )
    for (const chatId of [...this.pending.keys()]) {
      await this.flush(chatId).catch(() => {})
    }
  }

  /** Drops a pending write and what is known about the chat's rows (the chat is being deleted). */
  cancel(chatId: string): void {
    clearTimeout(this.pending.get(chatId)?.timer)
    this.pending.delete(chatId)
    this.written.delete(chatId)
  }

  /** Records what the database holds for a chat just read from it, so the next flush writes only what changes. */
  seed(
    chatId: string,
    rows: { id: string; type: string; content: string; created_at: number }[],
  ): void {
    const known = new Map<string, WrittenRow>()
    for (const row of rows)
      known.set(row.id, {
        hash: hashRow(row.type, row.content),
        createdAt: row.created_at,
      })
    this.written.set(chatId, { ...this.written.get(chatId), rows: known })
  }

  /** Forgets a chat's rows (its messages left memory); a pending write must have been flushed first. */
  forget(chatId: string): void {
    this.written.delete(chatId)
  }

  hasPending(chatId: string): boolean {
    return this.pending.has(chatId)
  }

  get pendingCount(): number {
    return this.pending.size
  }

  private write(
    chatId: string,
    { chat, sessionDir, messages }: ChatWrite,
  ): void {
    const db = this.db()
    initMessages(db)
    const known = this.written.get(chatId)
    let rows = known?.rows
    const upserts: (MessageUpsert & { index: number })[] = []
    let removed: string[] = []
    let newestAt = 0
    if (messages) {
      rows = new Map()
      const changed = new Map<string, MessageUpsert & { index: number }>()
      messages.forEach((message, index) => {
        if ((message.type as string) === 'status') return
        const row = toMessageRow(message, sessionDir)
        const hash = hashRow(row.type, row.content)
        rows!.set(row.id, { hash, createdAt: row.createdAt })
        const before = known?.rows.get(row.id)
        if (
          before &&
          before.hash === hash &&
          before.createdAt === row.createdAt
        ) {
          changed.delete(row.id)
          return
        }
        changed.set(row.id, {
          ...row,
          reposition: !before || before.createdAt !== row.createdAt,
          index,
        })
        if (isFinal(message)) newestAt = Math.max(newestAt, row.createdAt)
      })
      upserts.push(
        ...[...changed.values()].sort(
          (a, b) => a.createdAt - b.createdAt || a.index - b.index,
        ),
      )
      if (known) removed = [...known.rows.keys()].filter((id) => !rows!.has(id))
    }
    const labels = JSON.stringify(chat.labels ?? [])
    const labelsChanged = known?.labels !== labels
    db.transaction(
      (tx) => {
        if (upserts.length || removed.length)
          writeMessages(tx, chat.workspaceId, chatId, upserts, removed)
        writeChat(tx, chat, {
          newestAt,
          labels: labelsChanged ? (chat.labels ?? []) : undefined,
        })
      },
      { behavior: 'immediate' },
    )
    this.written.set(chatId, { rows: rows ?? new Map(), labels })
    debug(
      `[chats] wrote ${chatId}: ${upserts.length} rows, ${removed.length} removed`,
    )
  }
}

/** The process's one queue. */
export const sessionPersistenceQueue = new ChatPersistenceQueue()
