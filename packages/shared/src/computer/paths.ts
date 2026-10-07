/**
 * Where things are inside an agent's box, and how a path moves between the server (host) and the box (C1).
 * Pure: no IO. `docs/computers.md` "Paths" has the table.
 *
 * - The agent's volume is `/home/agent`; a chat works in `/home/agent/chats/<chat_id>` (created on first use).
 * - The workspace's skills folder is mounted read-only at `/skills`, its sources folder at `/sources`, the server's
 *   docs folder at `/otto/docs`.
 * - The chat's host folder (`<workspace>/sessions/<chat_id>`) and its box folder mirror each other for the files the
 *   server moves: attachments are copied in, screenshots and files a tool needs on the server are copied out.
 */

import { posix } from 'node:path'

export const BOX_HOME = '/home/agent'
export const BOX_CHATS = `${BOX_HOME}/chats`
export const BOX_FILES = `${BOX_HOME}/files`
/** The workspace's skills folder, read-only. */
export const SKILLS_MOUNT = '/skills'
/** The server's docs folder (`CONFIG_DIR/docs`: the guides the prompt points at, the `otto` skill), read-only. */
export const DOCS_MOUNT = '/otto/docs'
/** The workspace's sources folder (each source's `guide.md` and config; no secrets), read-only. */
export const SOURCES_MOUNT = '/sources'

/** Chat ids are UUIDs; older stored chat folders remain readable until the explicit conversion. */
const CHAT_ID = /^[a-z0-9][a-z0-9-]*$/i

/** The chat's working folder in the box. */
export function boxChatDir(chatId: string): string {
  if (!CHAT_ID.test(chatId)) throw new Error(`invalid chat id: ${chatId}`)
  return `${BOX_CHATS}/${chatId}`
}

export interface PathMapOptions {
  chatId: string
  /** The chat's folder on the server (`getSessionPath`). */
  hostChatDir: string
  /** The workspace's skills folder on the server (mounted at /skills). */
  hostSkillsDir?: string
  /** The server's docs folder (mounted at /otto/docs). */
  hostDocsDir?: string
  /** The workspace's sources folder (mounted at /sources). */
  hostSourcesDir?: string
  /** Single files copied into the box: [host path, box path]. */
  files?: ReadonlyArray<readonly [string, string]>
  /** Text-only spellings of a host folder in prompts (e.g. `~/.otto/docs`): [text, box path]. */
  textAliases?: ReadonlyArray<readonly [string, string]>
}

export interface PathMap {
  /** The chat's working folder in the box. */
  readonly cwd: string
  /** The box path of a server path, or null when the box cannot see it. */
  toBox(hostPath: string): string | null
  /** The server path of a box path, or null when it has none (the agent's own files outside its chat folder). */
  toHost(boxPath: string): string | null
  /** `text` with every server folder the box can see written as its box path (prompts, tool descriptions). */
  textToBox(text: string): string
  /** A new map that also knows these copied files. */
  withFiles(files: ReadonlyArray<readonly [string, string]>): PathMap
}

const trimSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)

/** `root` itself or a path under it (on a segment boundary). */
function under(path: string, root: string): string | null {
  if (path === root) return ''
  return path.startsWith(`${root}/`) ? path.slice(root.length) : null
}

/** Box paths are POSIX: `~` is the agent's home, relative paths are against the chat's folder. */
function normalizeBox(path: string, cwd: string): string {
  const expanded = path === '~' ? BOX_HOME : path.startsWith('~/') ? `${BOX_HOME}/${path.slice(2)}` : path
  return posix.resolve(cwd, expanded)
}

export function createPathMap(o: PathMapOptions): PathMap {
  const cwd = boxChatDir(o.chatId)
  const files = (o.files ?? []).map(([h, b]) => [trimSlash(h), trimSlash(b)] as const)
  // Longest first, so a file or a deeper folder wins over the folder it is in.
  const pairs = [
    ...files,
    [trimSlash(o.hostChatDir), cwd] as const,
    ...(o.hostSkillsDir ? [[trimSlash(o.hostSkillsDir), SKILLS_MOUNT] as const] : []),
    ...(o.hostDocsDir ? [[trimSlash(o.hostDocsDir), DOCS_MOUNT] as const] : []),
    ...(o.hostSourcesDir ? [[trimSlash(o.hostSourcesDir), SOURCES_MOUNT] as const] : []),
  ]
  const byHost = [...pairs].sort((a, b) => b[0].length - a[0].length)
  const byBox = [...pairs].sort((a, b) => b[1].length - a[1].length)
  const folders = [...byHost.filter((pair) => !files.includes(pair)), ...(o.textAliases ?? [])]

  return {
    cwd,
    toBox(hostPath) {
      const path = trimSlash(hostPath)
      for (const [host, box] of byHost) {
        const rest = under(path, host)
        if (rest !== null) return box + rest
      }
      return null
    },
    toHost(boxPath) {
      const path = normalizeBox(boxPath, cwd)
      for (const [host, box] of byBox) {
        const rest = under(path, box)
        if (rest !== null) return host + rest
      }
      return null
    },
    textToBox(text) {
      let out = text
      for (const [host, box] of folders) {
        // Only whole path segments: `/ws/sessions/ab` must not rewrite `/ws/sessions/abc`.
        out = out.replace(new RegExp(`${host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.-])`, 'g'), box)
      }
      return out
    },
    withFiles(more) {
      return createPathMap({ ...o, files: [...(o.files ?? []), ...more] })
    },
  }
}
