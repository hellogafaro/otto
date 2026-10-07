import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { userActor } from '../actors.ts'
import { loadStoredConfig } from '../config/storage.ts'
import { initDb, type Db } from '../db/index.ts'
import { INSTALL, getSetting, updateSetting } from '../settings/index.ts'
import { getStatusRow } from '../statuses/storage.ts'
import { parsePermissionMode } from '../agent/mode-types.ts'
import { getFirstUser } from '../users/queries.ts'
import { getWorkspaceOwnerIds } from '../workspaces/ownership.ts'
import { getWorkspaceSessionsPath } from '../workspaces/storage.ts'
import { hasChat, writeChat, type ChatSnapshot } from './chats.ts'
import { initMessages, toMessageRow, writeMessages } from './messages.ts'
import type { SessionHeader, StoredMessage } from './types.ts'

/**
 * The importer of chats: each workspace's `sessions/<id>/session.jsonl` (line 1 the header, then one message per
 * line) becomes a `chats` row, its `labels_entities` rows and its `messages` rows (with their search entries), in
 * one transaction per chat, at boot (headless and desktop), before the session manager loads chats. A workspace is
 * recorded as `chats:<id>` in the `imports` setting once a pass over it imported every readable chat (a write that
 * failed leaves it unrecorded, so the next boot tries again; an unreadable file is not retried), so a chat deleted
 * later never comes back; a chat whose id already has a row is skipped, so a pass cut short or with failures resumes
 * where it stopped.
 * The old files are only read: never changed, moved or deleted.
 *
 *   header.createdBy (absent)     -> the workspace's first owner (else the first user): chats are private
 *   header.isFlagged              -> pinned_at
 *   header.isArchived             -> the `archived` status; else header.sessionStatus (old `todoState`), when
 *                                    the workspace has it (else none, read as the default)
 *   header.triggeredBy            -> origin 'routine:<automationId>' (+ metadata)
 *   header.parentSessionId        -> origin 'chat:<id>'
 *   header.hidden                 -> not imported (hidden chats were the removed mini edit chats)
 *   header.hasUnread              -> read_at
 *   header.lastMessageAt          -> updated_at
 *   a line that does not parse    -> skipped and counted (a truncated last line from a crash)
 *   a `status` line               -> dropped (never shown after the turn)
 *   no `timestamp`                -> the previous line's
 *   the same id twice             -> the last line wins
 *   order                         -> by (timestamp, line), so position follows what the chat view shows
 *
 * A workspace with nobody to own its chats is left for the next boot. A file that cannot be read is reported and
 * its chat skipped; nothing here stops boot.
 */

export interface ChatsImportReport {
  workspaces: number
  chats: number
  messages: number
  /** Message lines that did not parse. */
  skippedLines: number
  /** Hidden chats left out. */
  hidden: number
  /** Chats whose file could not be read (not tried again). */
  unreadable: number
  /** Chats that could not be written (tried again at the next boot: their workspace is not recorded). */
  failed: number
  warnings: string[]
}

const CHAT_ID = /^[\w-]+$/

/** The messages of a session.jsonl body (lines after the header), as the importer orders them. */
export function parseMessageLines(lines: string[]): { messages: StoredMessage[]; skipped: number } {
  const byId = new Map<string, { message: StoredMessage; index: number }>()
  let skipped = 0
  let lastTimestamp = 0
  lines.forEach((line, index) => {
    if (!line.trim()) return
    let message: StoredMessage
    try {
      message = JSON.parse(line) as StoredMessage
    } catch {
      skipped++
      return
    }
    if (!message || typeof message !== 'object' || typeof message.id !== 'string' || typeof message.type !== 'string') {
      skipped++
      return
    }
    if ((message.type as string) === 'status') return
    if (typeof message.timestamp !== 'number') message.timestamp = lastTimestamp
    lastTimestamp = message.timestamp
    byId.set(message.id, { message, index })
  })
  const messages = [...byId.values()].sort((a, b) => a.message.timestamp! - b.message.timestamp! || a.index - b.index).map((entry) => entry.message)
  return { messages, skipped }
}

/** A header as the chat it describes. */
function toSnapshot(header: SessionHeader & { todoState?: string }, chatId: string, workspaceId: string, owner: string, db: Db): ChatSnapshot {
  const {
    hidden: _hidden, isArchived, archivedAt: _archivedAt, todoState, sessionStatus, workspaceRootPath,
    messageCount: _count, lastMessageRole: _role, preview: _preview, lastFinalMessageId: _final, ...fields
  } = header as SessionHeader & { todoState?: string; hidden?: boolean; archivedAt?: number }
  const slug = isArchived ? 'archived' : (sessionStatus ?? todoState)
  return {
    ...fields,
    id: chatId,
    workspaceId,
    workspaceRootPath,
    createdBy: header.createdBy ?? owner,
    createdAt: typeof header.createdAt === 'number' ? header.createdAt : Date.now(),
    lastUsedAt: header.lastUsedAt ?? header.createdAt,
    lastMessageAt: header.lastMessageAt ?? header.lastUsedAt ?? header.createdAt,
    sessionStatus: slug && getStatusRow(workspaceId, slug, db) ? slug : undefined,
    // old headers may carry the canonical names (`execute`, `explore`)
    permissionMode: typeof header.permissionMode === 'string' ? (parsePermissionMode(header.permissionMode) ?? undefined) : undefined,
    previousPermissionMode: typeof header.previousPermissionMode === 'string' ? (parsePermissionMode(header.previousPermissionMode) ?? undefined) : undefined,
  }
}

export function initChatsImport(db: Db = initDb(), workspaces: { id: string; rootPath: string }[] = loadStoredConfig()?.workspaces ?? []): ChatsImportReport {
  const report: ChatsImportReport = { workspaces: 0, chats: 0, messages: 0, skippedLines: 0, hidden: 0, unreadable: 0, failed: 0, warnings: [] }
  initMessages(db)
  for (const { id: workspaceId, rootPath } of workspaces) {
    const key = `chats:${workspaceId}`
    if (getSetting(INSTALL, 'imports', db)[key]) continue
    const ownerId = getWorkspaceOwnerIds(workspaceId, db)[0] ?? getFirstUser(db)?.id
    if (!ownerId) {
      report.warnings.push(`workspace ${workspaceId}: nobody to own its chats yet; left for the next boot`)
      continue
    }
    const owner = userActor(ownerId)
    const sessionsDir = getWorkspaceSessionsPath(rootPath)
    const failedBefore = report.failed
    const folders = existsSync(sessionsDir) ? readdirSync(sessionsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name) : []
    for (const chatId of folders) {
      const file = join(sessionsDir, chatId, 'session.jsonl')
      if (!CHAT_ID.test(chatId) || !existsSync(file)) continue
      if (hasChat(chatId, db)) continue
      let lines: string[]
      let header: SessionHeader & { hidden?: boolean }
      try {
        lines = readFileSync(file, 'utf-8').split('\n')
        header = JSON.parse(lines[0] ?? '') as SessionHeader & { hidden?: boolean }
        if (!header || typeof header !== 'object') throw new Error('no header')
      } catch (error) {
        // A file that cannot be read stays unreadable: retrying it would only bring deleted chats back
        report.unreadable++
        report.warnings.push(`${file}: ${error instanceof Error ? error.message : String(error)}; not imported`)
        continue
      }
      if (header.hidden) {
        report.hidden++
        continue
      }
      try {
        const { messages, skipped } = parseMessageLines(lines.slice(1))
        const chat = toSnapshot(header, chatId, workspaceId, owner, db)
        const sessionDir = join(sessionsDir, chatId)
        const rows = messages.map((message) => ({ ...toMessageRow(message, sessionDir), reposition: true }))
        db.transaction(
          (tx) => {
            writeChat(tx, chat, { labels: header.labels ?? [] })
            writeMessages(tx, workspaceId, chatId, rows, [])
          },
          { behavior: 'immediate' },
        )
        report.chats++
        report.messages += rows.length
        report.skippedLines += skipped
        if (skipped) report.warnings.push(`${file}: ${skipped} unreadable lines skipped`)
      } catch (error) {
        report.failed++
        report.warnings.push(`${file}: ${error instanceof Error ? error.message : String(error)}; not imported`)
      }
    }
    // A chat whose write failed is tried again at the next boot: the workspace is recorded only once every readable
    // chat is in (until then a chat deleted in between would come back, the price of not losing one)
    if (report.failed > failedBefore) {
      report.warnings.push(`workspace ${workspaceId}: ${report.failed - failedBefore} chats failed; tried again at the next boot`)
      continue
    }
    updateSetting(INSTALL, 'imports', { ...getSetting(INSTALL, 'imports', db), [key]: Date.now() }, db)
    report.workspaces++
  }
  if (report.workspaces || report.warnings.length) {
    console.log(
      `[chats] imported ${report.chats} chats, ${report.messages} messages for ${report.workspaces} workspaces (${report.skippedLines} lines skipped, ${report.hidden} hidden chats left out, ${report.unreadable} unreadable, ${report.failed} failed)`,
    )
    for (const warning of report.warnings) console.warn(`[chats] ${warning}`)
  }
  return report
}
