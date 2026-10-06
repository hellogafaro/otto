/**
 * Session Bundle — Serialization Format for Session Export/Import
 *
 * A SessionBundle is the portable representation of a chat: its fields, its messages and the files of its folder,
 * used for transferring chats between workspaces (same-server or cross-server).
 *
 * Messages travel with the chat folder's paths still written as `{{SESSION_PATH}}`, so the importing side resolves
 * them to its own folder.
 */

import { toPortablePath } from '../utils/paths.ts'
import type { SessionHeader, StoredMessage } from './types.ts'
import { getMessageRows, fromMessageRow } from './messages.ts'
import { getChat } from './chats.ts'
import { getSessionPath, type ChatWorkspace } from './storage.ts'
import { pickSessionFields } from './utils.ts'
import { debug } from '../utils/debug.ts'
import {
  type BundleFile,
  MAX_BUNDLE_SIZE_BYTES,
  collectDirectoryFiles,
} from '../utils/bundle-files.ts'

// Re-export BundleFile and MAX_BUNDLE_SIZE_BYTES for backward compatibility
export { type BundleFile, MAX_BUNDLE_SIZE_BYTES } from '../utils/bundle-files.ts'

/**
 * Directories to skip when collecting session files for export.
 * tmp/ is regenerable; dotfiles are typically internal state.
 */
const SKIP_DIRS = new Set(['tmp'])

/** The file chats made before the database kept (the importer leaves it in place): never part of a bundle. */
const SKIP_FILES = new Set(['session.jsonl', 'session.jsonl.tmp'])

/**
 * Dispatch mode determines how the imported session relates to the original.
 */
export type DispatchMode = 'move' | 'fork'

/**
 * Serialized representation of a session directory.
 * JSON envelope format — sessions are typically small (text + a few attachments).
 */
export interface SessionBundle {
  /** Bundle format version */
  version: 1
  /** Session data (header metadata + full message history) */
  session: {
    /** Session metadata (id, name, timestamps, config) */
    header: SessionHeader
    /** Full message history */
    messages: StoredMessage[]
  }
  /** All files from the session directory (attachments, plans, data, downloads, etc.) */
  files: BundleFile[]
}

/**
 * Serialize a chat into a SessionBundle: its row, its messages (paths as tokens) and the files of its folder.
 * Skips tmp/ and dotfiles. Null when the chat does not exist or its files exceed MAX_BUNDLE_SIZE_BYTES.
 */
export function serializeSession(workspace: ChatWorkspace, sessionId: string): SessionBundle | null {
  const chat = getChat(workspace.id, workspace.rootPath, sessionId)
  if (!chat) {
    debug('[bundle] Chat not found:', sessionId)
    return null
  }

  const files = collectDirectoryFiles(getSessionPath(workspace.rootPath, sessionId), { skipDirs: SKIP_DIRS, skipFiles: SKIP_FILES })
  const totalSize = files.reduce((sum, f) => sum + f.size, 0)
  if (totalSize > MAX_BUNDLE_SIZE_BYTES) {
    debug(`[bundle] Session exceeds max bundle size: ${totalSize} bytes > ${MAX_BUNDLE_SIZE_BYTES} bytes`)
    return null
  }

  const header = {
    ...pickSessionFields(chat),
    workspaceRootPath: toPortablePath(workspace.rootPath),
    messageCount: chat.messageCount,
    lastMessageRole: chat.lastMessageRole,
    preview: chat.preview,
    tokenUsage: chat.tokenUsage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 },
    lastFinalMessageId: chat.lastFinalMessageId,
  } as SessionHeader

  return {
    version: 1,
    session: {
      header,
      // '' keeps `{{SESSION_PATH}}` in place for the importing side
      messages: getMessageRows(workspace.id, sessionId).map((row) => fromMessageRow(row, '')),
    },
    files,
  }
}

/**
 * Validate a SessionBundle structure.
 * Checks version, required fields, and basic integrity.
 */
export function validateBundle(bundle: unknown): bundle is SessionBundle {
  if (!bundle || typeof bundle !== 'object') return false
  const b = bundle as Record<string, unknown>

  if (b.version !== 1) return false
  if (!b.session || typeof b.session !== 'object') return false

  const session = b.session as Record<string, unknown>
  if (!session.header || typeof session.header !== 'object') return false
  if (!Array.isArray(session.messages)) return false

  const header = session.header as Record<string, unknown>
  if (typeof header.id !== 'string') return false
  if (typeof header.createdAt !== 'number') return false

  if (!Array.isArray(b.files)) return false

  return true
}
