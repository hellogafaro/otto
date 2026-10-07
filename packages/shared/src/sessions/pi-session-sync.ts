import { mkdirSync, readdirSync, statSync } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { getBundleStore, isObjectStorage } from '../library/index.ts'
import { expandPath } from '../utils/paths.ts'

/**
 * Pi's lossless session file survives the host's disk (docs/final-plan.md 2.3). The primary agent's file is
 * `<chat folder>/.pi-sessions/*.jsonl`, another agent's `<chat folder>/.pi-sessions/<agent_id>/*.jsonl` (each agent of a
 * chat has its own Pi session); on S3 a copy lives at `workspaces/<ws>/chats/<chatId>/session.jsonl` (the primary's)
 * or `session-<agent_id>.jsonl` (the bundle store of kind `chats`). It is Pi's own resume file stored like any chat file, not a second history:
 * the `messages` rows stay what the app shows. On the disk driver nothing here does anything.
 *
 * The chat's `metadata.piSession` (another agent's: `metadata.agents[id].piSession`; {@link PiSessionRef}) is the hash of the bytes last uploaded and when. Upload
 * runs after a settled turn and skips unchanged bytes; restore runs before the agent is created and downloads only
 * when the local file is missing, or differs from the stored one and is older than the upload (another node moved
 * on). Limits: the file is uploaded whole (one PUT, no append); "older" compares a file's mtime with the uploader's
 * clock, so nodes need roughly synced clocks.
 */
export interface PiSessionRef {
  hash: string
  /** Upload time (ms). */
  at: number
}

type Workspace = { id: string; rootPath: string }

/** `agentId`: another agent's session (absent: the primary agent's). */
const keyOf = (chatId: string, agentId?: string) => `${chatId}/session${agentId ? `-${agentId}` : ''}.jsonl`
const dirOf = (sessionDir: string, agentId?: string) => (agentId ? join(sessionDir, '.pi-sessions', agentId) : join(sessionDir, '.pi-sessions'))
const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher('sha256').update(bytes).digest('hex')

/** The newest `.jsonl` in the folder (the one Pi continues), or undefined. */
function newestFile(dir: string): { path: string; mtimeMs: number } | undefined {
  let best: { path: string; mtimeMs: number } | undefined
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.jsonl')) continue
      const path = join(dir, name)
      const { mtimeMs } = statSync(path)
      if (!best || mtimeMs > best.mtimeMs) best = { path, mtimeMs }
    }
  } catch {}
  return best
}

/** Uploads the chat's Pi session file unless its bytes are the ones last uploaded. Returns the new ref, or undefined when nothing was uploaded. Throws when the PUT fails (call again next turn). */
export async function uploadPiSession(workspace: Workspace, chatId: string, sessionDir: string, ref?: PiSessionRef, agentId?: string): Promise<PiSessionRef | undefined> {
  if (!isObjectStorage()) return undefined
  const file = newestFile(dirOf(sessionDir, agentId))
  if (!file) return undefined
  const bytes = await Bun.file(file.path).bytes()
  const hash = sha256(bytes)
  if (ref?.hash === hash) return undefined
  await getBundleStore(workspace.rootPath, workspace.id, 'chats').put(keyOf(chatId, agentId), bytes)
  return { hash, at: Date.now() }
}

/**
 * Puts the stored Pi session file in the chat folder when the local one is missing or older than the stored one.
 * `cwd` is the working directory the agent will run in (`~` allowed): Pi only continues a file whose header names it, so the
 * header is rewritten when the file came from a node that ran elsewhere. Returns whether a file was written.
 */
export async function restorePiSession(workspace: Workspace, chatId: string, sessionDir: string, cwd: string, ref?: PiSessionRef, agentId?: string): Promise<boolean> {
  if (!isObjectStorage()) return false
  const dir = dirOf(sessionDir, agentId)
  const local = newestFile(dir)
  if (local) {
    if (!ref || local.mtimeMs >= ref.at) return false
    if (sha256(await Bun.file(local.path).bytes()) === ref.hash) return false
  }
  const bytes = await getBundleStore(workspace.rootPath, workspace.id, 'chats').get(keyOf(chatId, agentId))
  if (!bytes) return false
  const resolvedCwd = expandPath(cwd)
  const text = new TextDecoder().decode(bytes)
  const lineEnd = text.indexOf('\n')
  const head = lineEnd < 0 ? text : text.slice(0, lineEnd)
  let restored = text
  try {
    const header = JSON.parse(head) as { type?: string; cwd?: string }
    if (header.type === 'session' && header.cwd !== resolvedCwd) restored = JSON.stringify({ ...header, cwd: resolvedCwd }) + (lineEnd < 0 ? '' : text.slice(lineEnd))
  } catch {}
  mkdirSync(dir, { recursive: true })
  const path = local?.path ?? join(dir, 'session.jsonl')
  const temp = `${path}.tmp-${crypto.randomUUID()}`
  try {
    await Bun.write(temp, restored)
    await rename(temp, path)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
  return true
}

/** Removes the chat's stored Pi session files, the primary agent's and those of `agentIds` (nothing happens for none). */
export async function deletePiSession(workspace: Workspace, chatId: string, agentIds: readonly string[] = []): Promise<void> {
  if (!isObjectStorage()) return
  const store = getBundleStore(workspace.rootPath, workspace.id, 'chats')
  for (const key of [keyOf(chatId), ...agentIds.map((id) => keyOf(chatId, id))]) await store.delete(key)
}
