import { resolve } from 'path'
import { homedir } from 'os'
import { execSync } from 'child_process'
import { RPC_CHANNELS } from '@otto/shared/protocol'
import { getWorkspaceByNameOrId } from '@otto/shared/config'
import { classifyExternalUrl, formatBlockedUrlError } from '@otto/shared/utils/url-safety'
import { validateFilePath, assertPathNotPrivate, callerOf, getWorkspaceAllowedDirs } from '@otto/server-core/handlers'
import type { RpcServer } from '@otto/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import {
  requestClientOpenExternal,
  requestClientOpenPath,
  requestClientShowInFolder,
} from '@otto/server-core/transport'

export const CORE_HANDLED_CHANNELS = [
  RPC_CHANNELS.theme.GET_SYSTEM_PREFERENCE,
  RPC_CHANNELS.system.VERSIONS,
  RPC_CHANNELS.system.HOME_DIR,
  RPC_CHANNELS.system.IS_DEBUG_MODE,
  RPC_CHANNELS.debug.LOG,
  RPC_CHANNELS.shell.OPEN_URL,
  RPC_CHANNELS.shell.OPEN_FILE,
  RPC_CHANNELS.shell.SHOW_IN_FOLDER,
  RPC_CHANNELS.git.GET_BRANCH,
] as const

interface ParsedInternalDeepLink {
  navigation?: {
    view?: string
    action?: string
    actionParams?: Record<string, string>
  }
  workspaceId?: string
  /** True when URL is intentionally consumed without navigation (auth callbacks). */
  handledNoop?: boolean
}

const COMPOUND_ROUTE_PREFIXES = new Set([
  'allSessions',
  'flagged',
  'state',
  'sources',
  'settings',
  'skills',
])

function collectDeepLinkParams(parsed: URL, pathId?: string): Record<string, string> | undefined {
  const params: Record<string, string> = {}
  if (pathId) params.id = pathId

  parsed.searchParams.forEach((value, key) => {
    if (key === 'sidebar') return
    params[key] = value
  })

  return Object.keys(params).length > 0 ? params : undefined
}

function parseInternalOttoDeepLink(parsed: URL): ParsedInternalDeepLink | null {
  if (parsed.protocol !== 'otto:') return null

  const host = parsed.hostname
  const pathParts = parsed.pathname.split('/').filter(Boolean)

  // OAuth callback links are handled by auth flow code paths.
  if (host === 'auth-callback') {
    return { handledNoop: true }
  }

  if (COMPOUND_ROUTE_PREFIXES.has(host)) {
    const viewRoute = pathParts.length > 0 ? `${host}/${pathParts.join('/')}` : host
    return { navigation: { view: viewRoute } }
  }

  if (host === 'action') {
    const action = pathParts[0]
    if (!action) return null

    const actionParams = collectDeepLinkParams(parsed, pathParts[1])
    return {
      navigation: {
        action,
        actionParams,
      },
    }
  }

  if (host === 'workspace') {
    const workspaceId = pathParts[0]
    if (!workspaceId) return null

    const routeType = pathParts[1]
    if (!routeType) return null

    if (COMPOUND_ROUTE_PREFIXES.has(routeType)) {
      return {
        workspaceId,
        navigation: { view: pathParts.slice(1).join('/') },
      }
    }

    if (routeType === 'action') {
      const action = pathParts[2]
      if (!action) return null

      return {
        workspaceId,
        navigation: {
          action,
          actionParams: collectDeepLinkParams(parsed, pathParts[3]),
        },
      }
    }
  }

  return null
}

/** Guard: reject filesystem-path actions on remote workspaces where local paths are meaningless. */
function assertLocalWorkspace(ctx: { workspaceId: string | null }, action: string): void {
  const ws = getWorkspaceByNameOrId(ctx.workspaceId ?? '')
  if (ws?.remoteServer) {
    throw new Error(`${action} is not available for remote workspaces`)
  }
}

export function registerSystemCoreHandlers(server: RpcServer, deps: HandlerDeps): void {
  // Get system theme preference (dark = true, light = false)
  server.handle(RPC_CHANNELS.theme.GET_SYSTEM_PREFERENCE, async () => {
    return deps.platform.systemDarkMode?.() ?? false
  })

  // Get runtime versions (previously handled locally in preload via process.versions)
  server.handle(RPC_CHANNELS.system.VERSIONS, async () => {
    return {
      node: process.versions.node,
      chrome: process.versions.chrome ?? undefined,
      electron: process.versions.electron ?? undefined,
    }
  })

  // Get user's home directory
  server.handle(RPC_CHANNELS.system.HOME_DIR, async () => {
    return homedir()
  })

  // Check if running in debug mode (from source)
  server.handle(RPC_CHANNELS.system.IS_DEBUG_MODE, async () => {
    return !deps.platform.isPackaged
  })

  // Get git branch for a directory (returns null if not a git repo or git unavailable)
  server.handle(RPC_CHANNELS.git.GET_BRANCH, async (ctx, dirPath: string) => {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: await assertPathNotPrivate(dirPath, callerOf(ctx, deps)),
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
      }).trim()
      return branch || null
    } catch {
      return null
    }
  })

  // Debug logging from renderer -> main log file (fire-and-forget, no response)
  server.handle(RPC_CHANNELS.debug.LOG, async (_ctx, ...args: unknown[]) => {
    deps.platform.logger.info('[renderer]', ...args)
  })

  // Shell operations - open URL in external browser (or handle otto:// internally)
  server.handle(RPC_CHANNELS.shell.OPEN_URL, async (ctx, url: string) => {
    deps.platform.logger.info('[OPEN_URL] Received request:', url)
    try {
      const classification = classifyExternalUrl(url)
      if (classification.kind === 'dangerous') {
        throw new Error(formatBlockedUrlError(classification))
      }

      const parsed = new URL(url)

      if (classification.kind === 'internal-deeplink') {
        const deepLink = parseInternalOttoDeepLink(parsed)

        if (deepLink?.handledNoop) {
          deps.platform.logger.info('[OPEN_URL] Ignoring auth-callback deep link in OPEN_URL handler')
          return
        }

        if (deepLink?.navigation?.view || deepLink?.navigation?.action) {
          const target = deepLink.workspaceId && deepLink.workspaceId !== ctx.workspaceId
            ? { to: 'workspace' as const, workspaceId: deepLink.workspaceId }
            : { to: 'client' as const, clientId: ctx.clientId }

          deps.platform.logger.info('[OPEN_URL] Routing otto:// URL internally via deeplink:navigate')
          server.push(RPC_CHANNELS.deeplink.NAVIGATE, target, deepLink.navigation)
          return
        }

        // Unknown deep-link shapes fall back to the client protocol handler.
        deps.platform.logger.info('[OPEN_URL] Falling back to client openExternal for otto:// URL')
        const deepLinkResult = await requestClientOpenExternal(server, ctx.clientId, url)
        if (!deepLinkResult.opened) {
          deps.platform.logger.error(`[OPEN_URL] Client capability failed: ${deepLinkResult.error}`)
          throw new Error(`Cannot open URL on client: ${deepLinkResult.error}`)
        }
        return
      }

      const result = await requestClientOpenExternal(server, ctx.clientId, url)
      if (!result.opened) {
        deps.platform.logger.error(`[OPEN_URL] Client capability failed: ${result.error}`)
        throw new Error(`Cannot open URL on client: ${result.error}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger.error('openUrl error:', message)
      throw new Error(`Failed to open URL: ${message}`)
    }
  })

  server.handle(RPC_CHANNELS.shell.OPEN_FILE, async (ctx, path: string) => {
    assertLocalWorkspace(ctx, 'Open file')
    try {
      // Expand ~ before resolve() — resolve() treats ~ as a literal path component
      const expanded = path.startsWith('~') ? path.replace(/^~/, homedir()) : path
      const absolutePath = resolve(expanded)
      const safePath = await validateFilePath(absolutePath, getWorkspaceAllowedDirs(ctx.workspaceId), callerOf(ctx, deps))
      const result = await requestClientOpenPath(server, ctx.clientId, safePath)
      if (result.error) throw new Error(result.error)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger.error('openFile error:', message)
      throw new Error(`Failed to open file: ${message}`)
    }
  })

  server.handle(RPC_CHANNELS.shell.SHOW_IN_FOLDER, async (ctx, path: string) => {
    assertLocalWorkspace(ctx, 'Show in folder')
    try {
      const expanded = path.startsWith('~') ? path.replace(/^~/, homedir()) : path
      const absolutePath = resolve(expanded)
      const safePath = await validateFilePath(absolutePath, getWorkspaceAllowedDirs(ctx.workspaceId), callerOf(ctx, deps))
      await requestClientShowInFolder(server, ctx.clientId, safePath)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger.error('showInFolder error:', message)
      throw new Error(`Failed to show in folder: ${message}`)
    }
  })
}
