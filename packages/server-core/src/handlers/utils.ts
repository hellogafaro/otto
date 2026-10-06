import { normalize, isAbsolute, sep, resolve } from 'path'
import { homedir, tmpdir } from 'os'
import { realpath } from 'fs/promises'
import { CONFIG_DIR } from '@otto/shared/config/paths'
import { getWorkspaceByNameOrId, getWorkspaces, type Workspace } from '@otto/shared/config'
import { isWorkspaceMember, loadWorkspaceConfig } from '@otto/shared/workspaces'
import type { PlatformServices } from '../runtime/platform'

/**
 * Get workspace by ID or name, throwing if not found.
 * Use this when a workspace must exist for the operation to proceed.
 */
export function getWorkspaceOrThrow(workspaceId: string): Workspace {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`)
  }
  return workspace
}

export function buildBackendHostRuntimeContext(platform: PlatformServices) {
  return {
    appRootPath: platform.appRootPath,
    resourcesPath: platform.resourcesPath,
    isPackaged: platform.isPackaged,
  }
}

/**
 * Resolve allowed directories for a workspace: its root path and configured
 * working directory (if set). Returns an empty array if the workspace is
 * unknown or has no relevant paths.
 */
export function getWorkspaceAllowedDirs(workspaceId?: string | null): string[] {
  if (!workspaceId) return []
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) return []

  const dirs: string[] = [workspace.rootPath]
  const config = loadWorkspaceConfig(workspace.rootPath)
  if (config?.defaults?.workingDirectory) {
    dirs.push(config.defaults.workingDirectory)
  }
  return dirs
}

/** Who asks for a path: the signed-in user and a way to ask whether they may see a chat. */
export interface PathCaller {
  userId: string | null
  canSeeSession(sessionId: string, userId: string | null): boolean
}

/** The caller of a handler, as `validateFilePath` and `assertPathNotPrivate` want it. */
export const callerOf = (
  ctx: { userId: string | null },
  deps: { sessionManager: { canSeeSession(sessionId: string, userId: string | null): boolean } },
): PathCaller => ({ userId: ctx.userId, canSeeSession: (sessionId, userId) => deps.sessionManager.canSeeSession(sessionId, userId) })

/**
 * What of the install's own folder (CONFIG_DIR) a client may read through the file channels: everything else
 * (config.json and its backups hold tokens, credentials.enc, otto.db and its -wal/-shm and backups hold every user's
 * data, drafts.json, logs/, .server.lock) is refused to everyone, owners and the local user included.
 * `workspaces/` is allowed here and checked per workspace below.
 */
const CONFIG_DIR_READABLE = new Set([
  'config-defaults.json', 'window-state.json', 'theme.json', 'themes', 'tool-icons', 'docs', 'permissions',
  'provider-domains.json', 'workspaces',
])

// The file systems of macOS and Windows ignore case; compare lowercase there (a deliberate shortcut: Linux is exact).
const fold = (path: string) => (process.platform === 'linux' ? path : path.toLowerCase())

/** The path split into segments below `dir`, or null when it is not inside it. */
function below(path: string, dir: string): string[] | null {
  const p = fold(normalize(path))
  const d = fold(normalize(dir))
  if (p === d) return []
  return p.startsWith(d.endsWith(sep) ? d : d + sep) ? p.slice(d.length).split(sep).filter(Boolean) : null
}

const realOrSelf = (path: string) => realpath(path).catch(() => path)

/**
 * The one rule behind every file channel (`file:*`, `fs:*`, `shell:openFile`, `shell:showInFolder`, `git:getBranch`),
 * regardless of the allow-list: returns a function telling whether a real path is private to this install, a
 * workspace the caller does not belong to, or a chat the caller may not see. Build it once per request and call it per
 * path. Without a caller (the server's own spawn and browser paths) only the install's sensitive files are refused.
 */
export async function createPathGuard(caller?: PathCaller): Promise<(realPath: string) => boolean> {
  const configDirs = [resolve(CONFIG_DIR), await realOrSelf(CONFIG_DIR)]
  const workspacesDirs = configDirs.map((dir) => dir + sep + 'workspaces')
  const roots = caller
    ? await Promise.all(getWorkspaces().map(async (w) => ({ id: w.id, dirs: [resolve(w.rootPath), await realOrSelf(w.rootPath)] })))
    : []

  return (realPath) => {
    for (const dir of configDirs) {
      const rest = below(realPath, dir)
      if (rest && rest[0] && !CONFIG_DIR_READABLE.has(fold(rest[0]))) return true
    }
    if (!caller) return false

    // Workspaces: only members read a workspace, and a chat's folder only its audience.
    const inside = roots.flatMap((root) => root.dirs.map((dir) => ({ root, rest: below(realPath, dir) }))).filter((hit) => hit.rest)
    for (const { root, rest } of inside) {
      if (!caller.userId || !isWorkspaceMember(root.id, caller.userId)) return true
      if (rest![0] === 'sessions' && (!rest![1] || !caller.canSeeSession(rest![1], caller.userId))) return true
    }
    // A folder under CONFIG_DIR/workspaces that no workspace of the registry claims is nobody's to read.
    if (inside.length === 0 && workspacesDirs.some((dir) => (below(realPath, dir)?.length ?? 0) > 0)) return true
    return false
  }
}

const PRIVATE_PATH = 'Access denied: that path is private to this install'

/** Normalize, expand `~`, require an absolute path and resolve symlinks (a missing file keeps its normalized path). */
async function toRealPath(filePath: string): Promise<string> {
  let normalizedPath = normalize(filePath)
  if (normalizedPath.startsWith('~')) normalizedPath = normalizedPath.replace(/^~/, homedir())
  if (!isAbsolute(normalizedPath)) throw new Error('Only absolute file paths are allowed')
  return realOrSelf(normalizedPath)
}

/**
 * For channels that take any path on the machine (a folder picker, a user's own attachment, `git:getBranch`):
 * refuses what `createPathGuard` refuses and returns the real path.
 */
export async function assertPathNotPrivate(filePath: string, caller?: PathCaller): Promise<string> {
  const realFilePath = await toRealPath(filePath)
  if ((await createPathGuard(caller))(realFilePath)) throw new Error(PRIVATE_PATH)
  return realFilePath
}

/**
 * Validates that a file path is within allowed directories to prevent path traversal attacks.
 * Allowed directories: user's home directory, /tmp, and any additional dirs passed by the caller
 * (e.g. workspace root, workspace working directory). Then the rule of `createPathGuard` applies, whatever the
 * allow-list says: pass the `caller` of every request that comes from a client.
 */
export async function validateFilePath(
  filePath: string,
  additionalAllowedDirs?: string[],
  caller?: PathCaller,
): Promise<string> {
  const realFilePath = await toRealPath(filePath)

  // Define allowed base directories
  const allowedDirs = [
    homedir(),
    tmpdir(),
    ...(additionalAllowedDirs ?? []),
  ].filter(Boolean)

  // Check if the real path is within an allowed directory (cross-platform)
  const isAllowed = allowedDirs.some(dir => {
    const normalizedDir = normalize(dir)
    const normalizedReal = normalize(realFilePath)
    return normalizedReal.startsWith(normalizedDir + sep) || normalizedReal === normalizedDir
  })

  if (!isAllowed) {
    throw new Error('Access denied: file path is outside allowed directories')
  }

  if ((await createPathGuard(caller))(realFilePath)) throw new Error(PRIVATE_PATH)

  // Block sensitive files even within allowed directories.
  // Use [\\/] to match both Unix / and Windows \ separators.
  const sensitivePatterns = [
    /\.ssh[\\/]/,
    /\.gnupg[\\/]/,
    /\.aws[\\/]credentials/,
    /\.env$/,
    /\.env\./,
    /credentials\.json$/,
    /secrets?\./i,
    /\.pem$/,
    /\.key$/,
  ]

  if (sensitivePatterns.some(pattern => pattern.test(realFilePath))) {
    throw new Error('Access denied: cannot read sensitive files')
  }

  return realFilePath
}
