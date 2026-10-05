/**
 * Deep Link Handler
 *
 * Parses otto:// URLs and routes to appropriate actions.
 *
 * URL Formats (workspace is optional - uses active window if omitted):
 *
 * Compound format (hierarchical navigation):
 *   otto://allSessions[/session/{sessionId}]            - Session list (all sessions)
 *   otto://flagged[/session/{sessionId}]             - Session list (flagged filter)
 *   otto://state/{stateId}[/session/{sessionId}]     - Session list (state filter)
 *   otto://sources[/source/{sourceSlug}]          - Sources list
 *   otto://settings[/{subpage}]                   - Settings (general, shortcuts, preferences)
 *
 * Action format:
 *   otto://action/{actionName}[/{id}][?params]
 *   otto://workspace/{workspaceId}/action/{actionName}[?params]
 *
 * Actions:
 *   new-chat                  - Create new chat, optional ?input=text&name=name&send=true
 *                               If send=true is provided with input, immediately sends the message
 *   resume-sdk-session/{id}   - Resume Claude Code session by SDK session ID
 *   delete-session/{id}       - Delete session
 *   flag-session/{id}         - Flag session
 *   unflag-session/{id}       - Unflag session
 *
 * Examples:
 *   otto://allSessions                               (all sessions view)
 *   otto://allSessions/session/abc123                (specific session)
 *   otto://settings/shortcuts                     (shortcuts page)
 *   otto://sources/source/github                  (github source info)
 *   otto://action/new-chat                        (uses active window)
 *   otto://action/resume-sdk-session/{sdkId}      (resume Claude Code session)
 *   otto://workspace/ws123/allSessions/session/abc123   (targets specific workspace)
 */

import type { BrowserWindow } from 'electron'
import { mainLog } from './logger'
import type { WindowManager } from './window-manager'
import { RPC_CHANNELS } from '../shared/types'
import type { EventSink } from '@otto/server-core/transport'

export interface DeepLinkTarget {
  /** Workspace ID - undefined means use active window */
  workspaceId?: string
  /** Compound route format (e.g., 'allSessions/session/abc123', 'settings/shortcuts') */
  view?: string
  /** Action route (e.g., 'new-chat', 'delete-session') */
  action?: string
  actionParams?: Record<string, string>
}

export interface DeepLinkResult {
  success: boolean
  error?: string
}

/**
 * Navigation payload sent to renderer via IPC
 */
export interface DeepLinkNavigation {
  /** Compound route format (e.g., 'allSessions/session/abc123', 'settings/shortcuts') */
  view?: string
  /** Action route (e.g., 'new-chat', 'delete-session') */
  action?: string
  actionParams?: Record<string, string>
}

/**
 * Parse a deep link URL into structured target
 */
export function parseDeepLink(url: string): DeepLinkTarget | null {
  try {
    const parsed = new URL(url)

    if (parsed.protocol !== 'otto:') {
      return null
    }

    // For custom protocols, the hostname contains the first path segment
    // e.g., otto://workspace/ws123 → hostname='workspace', pathname='/ws123'
    // e.g., otto://allSessions/chat/abc → hostname='allSessions', pathname='/chat/abc'
    const host = parsed.hostname
    const pathParts = parsed.pathname.split('/').filter(Boolean)

    // otto://auth-callback?... (OAuth callbacks - return null to let existing handler process)
    if (host === 'auth-callback') {
      return null
    }

    // Compound route prefixes
    const COMPOUND_ROUTE_PREFIXES = [
      'allSessions', 'flagged', 'state', 'sources', 'settings', 'skills'
    ]

    // otto://allSessions/..., otto://settings/..., etc. (compound routes)
    if (COMPOUND_ROUTE_PREFIXES.includes(host)) {
      // Reconstruct the full compound route from host + pathname
      const viewRoute = pathParts.length > 0 ? `${host}/${pathParts.join('/')}` : host
      return {
        workspaceId: undefined,
        view: viewRoute,
      }
    }

    // otto://workspace/{workspaceId}/... (with workspace targeting)
    if (host === 'workspace') {
      const workspaceId = pathParts[0]
      if (!workspaceId) return null

      const result: DeepLinkTarget = { workspaceId }

      // Check what type of route follows the workspace ID
      const routeType = pathParts[1]

      // Parse compound routes: /workspace/{id}/{compoundRoute}
      // e.g., /workspace/ws123/allSessions/session/abc123
      if (routeType && COMPOUND_ROUTE_PREFIXES.includes(routeType)) {
        const viewRoute = pathParts.slice(1).join('/')
        result.view = viewRoute
        return result
      }

      // Parse /action/{actionName}/...
      if (routeType === 'action') {
        result.action = pathParts[2]
        result.actionParams = {}
        // Handle path-based ID (e.g., /action/delete-session/{sessionId})
        if (pathParts[3]) {
          result.actionParams.id = pathParts[3]
        }
        parsed.searchParams.forEach((value, key) => {
          result.actionParams![key] = value
        })
        return result
      }

      return result
    }

    // otto://action/... (no workspace - uses active window)
    if (host === 'action') {
      const result: DeepLinkTarget = {
        workspaceId: undefined,
        action: pathParts[0],
        actionParams: {},
      }

      if (pathParts[1]) {
        result.actionParams!.id = pathParts[1]
      }

      parsed.searchParams.forEach((value, key) => {
        result.actionParams![key] = value
      })

      return result
    }

    return null
  } catch (error) {
    mainLog.error('[DeepLink] Failed to parse URL:', url, error)
    return null
  }
}

/**
 * Wait for window's renderer to signal ready
 */
function waitForWindowReady(window: BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    if (window.webContents.isLoading()) {
      window.webContents.once('did-finish-load', () => {
        // TIMING NOTE: This 100ms delay allows React to mount and register
        // IPC listeners before we send the deep link. `did-finish-load` fires
        // when the HTML is loaded, but React's useEffect hooks haven't run yet.
        // A proper handshake (renderer signals "ready") would be cleaner but
        // adds complexity for minimal gain - this delay is sufficient for all
        // practical cases and only affects reload scenarios.
        setTimeout(resolve, 100)
      })
    } else {
      resolve()
    }
  })
}

/**
 * Handle a deep link by navigating to the target
 */
export async function handleDeepLink(
  url: string,
  windowManager: WindowManager,
  sink?: EventSink,
  resolveClientId?: (webContentsId: number) => string | undefined,
  preferredClientId?: string,
): Promise<DeepLinkResult> {
  const target = parseDeepLink(url)

  if (!target) {
    // Return success for null targets (like auth-callback) - they're handled elsewhere
    if (url.includes('auth-callback')) {
      return { success: true }
    }
    return { success: false, error: 'Invalid deep link URL' }
  }

  mainLog.info('[DeepLink] Handling:', target)

  // 1. Get target window
  let window: BrowserWindow | null = null

  if (target.workspaceId) {
    // Workspace specified - focus or create window for that workspace
    window = windowManager.focusOrCreateWindow(target.workspaceId)
  } else {
    // No workspace - use focused window or last active
    window = windowManager.getFocusedWindow() ?? windowManager.getLastActiveWindow()

    if (!window) {
      // No windows at all - can't navigate without a workspace
      return { success: false, error: 'No active window to navigate' }
    }

    // Focus the window
    if (window.isMinimized()) {
      window.restore()
    }
    window.focus()
  }

  // 2. Wait for window to be ready (renderer loaded)
  await waitForWindowReady(window)

  // 3. Send navigation command to renderer
  if (target.view || target.action) {
    const navigation: DeepLinkNavigation = {
      view: target.view,
      action: target.action,
      actionParams: target.actionParams,
    }
    const wsId = target.workspaceId ?? windowManager.getWorkspaceForWindow(window.webContents.id)
    const resolvedClientId = resolveClientId?.(window.webContents.id)

    // Prefer the resolved target window client. Only use preferredClientId as
    // fallback when no resolver was provided (legacy call sites).
    const clientId = resolvedClientId ?? (!resolveClientId ? preferredClientId : undefined)

    if (sink && clientId) {
      sink(RPC_CHANNELS.deeplink.NAVIGATE, { to: 'client', clientId }, navigation)
    } else if (sink && wsId) {
      sink(RPC_CHANNELS.deeplink.NAVIGATE, { to: 'workspace', workspaceId: wsId }, navigation)
    }
  }

  return { success: true }
}
