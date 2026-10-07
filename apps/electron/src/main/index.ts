// Load user's shell environment first (before other imports that may use env)
// This ensures tools like Homebrew, nvm, etc. are available to the agent
import { loadShellEnv } from './shell-env'
loadShellEnv()

import { app, BrowserWindow, dialog, ipcMain, safeStorage, session } from 'electron'
import { createHash, randomBytes } from 'crypto'
import { hostname, homedir } from 'os'
import * as Sentry from '@sentry/electron/main'
import { redactSensitiveHeadersInPlace, redactSensitiveKeysInPlace } from '@otto/shared/utils'

// Initialize Sentry error tracking as early as possible after app import.
// Only enabled in production (packaged) builds to avoid noise during development.
// DSN is baked in at build time via esbuild --define (same pattern as OAuth secrets).
//
// NOTE: Source map upload is intentionally disabled. Stack traces in Sentry will show
// bundled/minified code. To enable source map upload in the future:
//   1. Add SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT to CI secrets
//   2. Re-enable the @sentry/vite-plugin in vite.config.ts (handles renderer maps)
//   3. Add @sentry/esbuild-plugin to scripts/electron-build-main.ts (handles main process maps)
Sentry.init({
  dsn: process.env.SENTRY_ELECTRON_INGEST_URL,
  environment: app.isPackaged ? 'production' : 'development',
  release: app.getVersion(),
  // Enabled whenever the ingest URL is available — works in both production (baked via CI)
  // and development (injected via .env / 1Password). Filter by environment in Sentry dashboard.
  enabled: !!process.env.SENTRY_ELECTRON_INGEST_URL,

  // Scrub sensitive data before sending to Sentry.
  // Shared logic in @otto/shared/utils redaction.ts (also used by the
  // renderer hook) — keep semantics there.
  beforeSend(event) {
    // Scrub request headers (authorization, cookies)
    if (event.request?.headers) {
      redactSensitiveHeadersInPlace(event.request.headers)
    }

    // Scrub breadcrumb data that may contain sensitive values
    if (event.breadcrumbs) {
      for (const breadcrumb of event.breadcrumbs) {
        if (breadcrumb.data) {
          redactSensitiveKeysInPlace(breadcrumb.data)
        }
      }
    }

    return event
  },
})

// Initialize i18n for main process (menus, dialogs, etc.)
//
// The main-process i18n instance has no detection plugin (no localStorage in Node)
// — it always starts at `fallbackLng: 'en'`. It is hydrated from the user's `uiLanguage`
// preference on the server once it answers (see the startup block below), and the
// `i18n:changeLanguage` IPC handler keeps that preference current.
import { setupI18n, i18n, SUPPORTED_LANGUAGE_CODES, type LanguageCode } from '@otto/shared/i18n'
import { PRODUCT_NAME } from '@otto/shared/branding'
import { CONFIG_DIR } from '@otto/shared/config/paths'
setupI18n()

// Set anonymous machine ID for Sentry user tracking (no PII — just a hash).
// Uses hostname + homedir to produce a stable per-machine identifier.
const machineId = createHash('sha256').update(hostname() + homedir()).digest('hex').slice(0, 16)
Sentry.setUser({ id: machineId })

import { join, delimiter } from 'path'
import { existsSync } from 'fs'
import { RPC_CHANNELS, type UnreadSummary } from '@otto/shared/protocol'
import type { RemoteServerConfig, Workspace } from '@otto/core/types'
import { WsRpcServer } from '@otto/server-core/transport'
import { initEncryptionKey } from './encryption-key'
import { registerGuiRpcHandlers } from './handlers/index'
import { createApplicationMenu } from './menu'
import { WindowManager } from './window-manager'
import { loadWindowState, saveWindowState } from './window-state'
import { handleDeepLink } from './deep-link'
import { BrowserPaneManager } from './browser-pane-manager'
import { registerThumbnailHandler } from './thumbnail-protocol'
import { registerPrivilegedSchemes, handleAppProtocol } from './protocol-schemes'
import log, { isDebugMode, mainLog, getLogFilePath, autoUpdateLog } from './logger'
import { setPerfEnabled, enableDebug } from '@otto/shared/utils'
import { initNotificationService, initBadgeIcon, initInstanceBadge, updateBadgeCount, setNotificationEventSink } from './notifications'
import { checkForUpdatesOnLaunch, setAutoUpdateEventSink, isUpdating, setBeforeUpdateQuitHook, setBeforeUpdateInstallHook, setInstallQuitFailedHook } from './auto-update'
import { checkVCRedistInstalled } from '@otto/server-core/services/vcredist'
import { initServer, stopServer, getServerConnection, getWorkspaces, getKnownWorkspace, invokeServer, onServerEvent } from './server-process'
import { initPowerManager, setRunningChats, cleanup as cleanupPowerManager } from './power-manager'

// Initialize electron-log for renderer process support
log.initialize()

// Enable debug/perf in dev mode (running from source)
if (isDebugMode) {
  process.env.OTTO_DEBUG = '1'
  enableDebug()
  setPerfEnabled(true)
}

// Bundle CLI tools: resolve platform-specific uv binary and wrapper scripts.
// These are available to all agent Bash sessions via OTTO_UV, OTTO_SCRIPTS env vars
// and PATH prepend. uv auto-downloads Python 3.12 on first use (~5s, then cached).
// The server child inherits this environment.
{
  // In packaged app: resources are at process.resourcesPath/app/resources/
  // In dev: resources are at __dirname/../resources/ (sibling of dist/)
  const resourcesBase = app.isPackaged
    ? join(process.resourcesPath, 'app')
    : join(__dirname, '..')
  const platformKey = `${process.platform}-${process.arch}`
  const uvPlatformDir = join(resourcesBase, 'resources', 'bin', platformKey)
  const uvBinary = join(uvPlatformDir, process.platform === 'win32' ? 'uv.exe' : 'uv')
  const binDir = join(resourcesBase, 'resources', 'bin')
  const scriptsDir = join(resourcesBase, 'resources', 'scripts')

  const bundledUvExists = existsSync(uvBinary)
  const fallbackUv = bundledUvExists ? null : 'uv'

  // Runtime resolver hints for shared session tools (and the server child: 'true' or 'false')
  process.env.OTTO_IS_PACKAGED = app.isPackaged ? 'true' : 'false'
  process.env.OTTO_RESOURCES_BASE = resourcesBase
  process.env.OTTO_APP_ROOT = app.isPackaged ? app.getAppPath() : process.cwd()

  process.env.OTTO_UV = bundledUvExists ? uvBinary : (fallbackUv ?? uvBinary)

  // Bun runtime (packaged builds run the server under it; dev falls back to bun on PATH)
  const bunBinary = join(resourcesBase, 'vendor', 'bun', process.platform === 'win32' ? 'bun.exe' : 'bun')
  if (existsSync(bunBinary)) {
    process.env.OTTO_BUN = bunBinary
  }

  process.env.OTTO_SCRIPTS = scriptsDir
  process.env.OTTO_VERSION = app.getVersion()
  // Prepend both generic wrappers dir and platform uv dir:
  // - binDir exposes wrapper commands (pdf-tool, docx-tool, ...)
  // - uvPlatformDir exposes raw `uv` for direct shell usage / debugging
  process.env.PATH = `${binDir}${delimiter}${uvPlatformDir}${delimiter}${process.env.PATH}`

  if (!bundledUvExists) {
    mainLog.warn('Bundled uv binary missing, CLI document tools may fail unless uv is available on PATH.', {
      expectedUvPath: uvBinary,
      usingOttoUv: process.env.OTTO_UV,
    })
  }

  if (isDebugMode) {
    mainLog.info('CLI tools configured:', { uvBinary: process.env.OTTO_UV, binDir, scriptsDir, bundledUvExists })
  }
}

// Custom URL scheme for deeplinks (e.g., otto://auth-complete)
// Supports multi-instance dev: OTTO_DEEPLINK_SCHEME env var (otto1, otto2, etc.)
const DEEPLINK_SCHEME = process.env.OTTO_DEEPLINK_SCHEME || 'otto'

// When OTTO_SERVER_URL is set, this app is a thin client of that server: no server child.
const isClientOnly = !!process.env.OTTO_SERVER_URL

let windowManager: WindowManager | null = null
let browserPaneManager: BrowserPaneManager | null = null
let guiServer: WsRpcServer | null = null
let moduleSink: WsRpcServer['push'] | null = null
const clientMap = new Map<number, string>()
const moduleClientResolver = (webContentsId: number) => clientMap.get(webContentsId)

// The server child's ENCRYPTION_KEY: kept here, never in main's own environment (renderers inherit that)
const serverSecrets: { ENCRYPTION_KEY?: string } = { ENCRYPTION_KEY: process.env.ENCRYPTION_KEY }
delete process.env.ENCRYPTION_KEY

// Store pending deep link if app not ready yet (cold start)
let pendingDeepLink: string | null = null

// Set app name early (before app.whenReady) to ensure correct macOS menu bar title
// Supports multi-instance dev: OTTO_APP_NAME env var (e.g., "Otto [1]")
app.setName(process.env.OTTO_APP_NAME || PRODUCT_NAME)

// Register as default protocol client for otto:// URLs
// This must be done before app.whenReady() on some platforms
if (process.defaultApp) {
  // Development mode: need to pass the app path
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(DEEPLINK_SCHEME, process.execPath, [process.argv[1]])
  }
} else {
  // Production mode
  app.setAsDefaultProtocolClient(DEEPLINK_SCHEME)
}

// Accept self-signed / untrusted certificates when connecting to a user-configured remote server.
// Only bypasses cert validation for the exact OTTO_SERVER_URL origin — all other connections
// use standard certificate verification. Without this, wss:// to self-signed servers fails with
// ERR_CERT_AUTHORITY_INVALID because Chromium's WebSocket rejects untrusted certs.
//
// Electron's certificate-error always reports URLs with https:// scheme, so we normalize
// wss:// → https:// (and ws:// → http://) to ensure origins compare correctly.
function normalizeOriginForCert(urlStr: string): string {
  const u = new URL(urlStr)
  if (u.protocol === 'wss:') u.protocol = 'https:'
  else if (u.protocol === 'ws:') u.protocol = 'http:'
  return u.origin
}

if (process.env.OTTO_SERVER_URL) {
  let serverOrigin: string | undefined
  try {
    serverOrigin = normalizeOriginForCert(process.env.OTTO_SERVER_URL)
  } catch {
    // Invalid URL — will fail later during connection, no need to handle here
  }
  if (serverOrigin) {
    app.on('certificate-error', (event, _webContents, url, _error, _certificate, callback) => {
      try {
        if (normalizeOriginForCert(url) === serverOrigin) {
          event.preventDefault()
          callback(true)
          return
        }
      } catch {
        // URL parse failure — fall through to default rejection
      }
      callback(false)
    })
  }
}

// Register the custom schemes (thumbnail:// previews, otto:// renderer origin) in one call.
// Must happen before app.whenReady() — Electron requires early scheme registration.
registerPrivilegedSchemes()

// Handle deeplink on macOS (when app is already running)
app.on('open-url', (event, url) => {
  event.preventDefault()
  mainLog.info('Received deeplink:', url)

  if (windowManager) {
    handleDeepLink(url, windowManager, moduleSink ?? undefined, moduleClientResolver).catch(err => {
      mainLog.error('Failed to handle deep link:', err)
    })
  } else {
    // App not ready - store for later
    pendingDeepLink = url
  }
})

// Handle deeplink on Windows/Linux (single instance check)
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine, _workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    // On Windows/Linux, the deeplink is in commandLine
    const url = commandLine.find(arg => arg.startsWith(`${DEEPLINK_SCHEME}://`))
    if (url && windowManager) {
      mainLog.info('Received deeplink from second instance:', url)
      handleDeepLink(url, windowManager, moduleSink ?? undefined, moduleClientResolver).catch(err => {
        mainLog.error('Failed to handle deep link:', err)
      })
    } else if (windowManager) {
      // No deep link - just focus the first window
      const windows = windowManager.getAllWindows()
      if (windows.length > 0) {
        const win = windows[0].window
        if (win.isMinimized()) win.restore()
        win.focus()
      }
    }
  })
}

/** The local workspaces, or none when there is no server (a thin client, or the server is down). */
async function getWorkspacesOrNone(): Promise<Workspace[]> {
  if (isClientOnly) return []
  return getWorkspaces().catch((error) => {
    mainLog.warn('Could not list the workspaces:', error instanceof Error ? error.message : error)
    return []
  })
}

// Helper to create initial windows on startup
async function createInitialWindows(): Promise<void> {
  if (!windowManager) return

  // Load saved window state
  const savedState = loadWindowState()
  const workspaces = await getWorkspacesOrNone()
  const validWorkspaceIds = workspaces.map(ws => ws.id)

  if (savedState?.windows.length) {
    // Restore windows from saved state
    let restoredCount = 0

    for (const saved of savedState.windows) {
      // Skip invalid workspaces
      if (!validWorkspaceIds.includes(saved.workspaceId)) continue

      mainLog.info(`Restoring window: workspaceId=${saved.workspaceId}, url=${saved.url ?? 'none'}`)
      const win = windowManager.createWindow({
        workspaceId: saved.workspaceId,
        restoreUrl: saved.url,
      })
      win.setBounds(saved.bounds)

      restoredCount++
    }

    if (restoredCount > 0) {
      mainLog.info(`Restored ${restoredCount} window(s) from saved state`)
      return
    }
  }

  // Default: the first workspace; without one the window opens on first-run setup, which creates it
  windowManager.createWindow({ workspaceId: workspaces[0]?.id ?? '' })
  mainLog.info(workspaces[0] ? `Created window for first workspace: ${workspaces[0].name}` : 'Created window for first-run setup (no workspace yet)')
}

/** The server stopped on its own: say so with its last lines, then start it again or quit. */
async function handleServerExit(reason: string, lastLines: string[]): Promise<void> {
  if (isQuitting) return
  mainLog.error(`[server] stopped unexpectedly (${reason})`)
  // Sync: the windows wait with it (their server is gone), and the async box resolves late on Linux without a parent window
  const response = dialog.showMessageBoxSync({
    type: 'error',
    title: `${PRODUCT_NAME} stopped working`,
    message: `${PRODUCT_NAME}'s server stopped unexpectedly (${reason}).`,
    detail: lastLines.length ? `Last lines of its log:\n\n${lastLines.slice(-12).join('\n')}` : 'It wrote nothing before it stopped.',
    buttons: ['Restart', 'Quit'],
    defaultId: 0,
    cancelId: 1,
  })
  if (response !== 0) {
    app.quit()
    return
  }
  if (await startServer()) {
    // The new server has a new port and token: every window reconnects through its preload
    for (const win of BrowserWindow.getAllWindows()) win.webContents.reload()
  }
}

/** Start the server child and wire main's own use of it. False (after an error window) when it does not start. */
async function startServer(): Promise<boolean> {
  try {
    await initServer(serverSecrets, (reason, lastLines) => void handleServerExit(reason, lastLines))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    mainLog.error('[server] did not start:', message)
    const response = dialog.showMessageBoxSync({
      type: 'error',
      title: `${PRODUCT_NAME} could not start`,
      message: `${PRODUCT_NAME}'s server did not start.`,
      detail: message,
      buttons: ['Try again', 'Quit'],
      defaultId: 0,
      cancelId: 1,
    })
    if (response === 0) return startServer()
    app.quit()
    return false
  }
  // The dock badge follows the unread count; the power blocker the running chats
  onServerEvent(RPC_CHANNELS.sessions.UNREAD_SUMMARY_CHANGED, (summary: UnreadSummary) => updateBadgeCount(summary.totalUnreadSessions))
  onServerEvent(RPC_CHANNELS.server.STATUS_CHANGED, (status: { runningChats: number }) => setRunningChats(status.runningChats))
  try {
    await initPowerManager()
  } catch (err) {
    mainLog.warn('[power] Power manager init failed (non-critical):', err instanceof Error ? err.message : err)
  }
  // The menus speak the language the user picked (their preference on the server)
  try {
    const { content } = await invokeServer<{ content: string }>(RPC_CHANNELS.preferences.READ)
    const persisted = (JSON.parse(content) as { uiLanguage?: string }).uiLanguage
    if (persisted && SUPPORTED_LANGUAGE_CODES.includes(persisted as LanguageCode)) await i18n.changeLanguage(persisted)
  } catch (err) {
    mainLog.warn('[i18n] could not read the language preference:', err instanceof Error ? err.message : err)
  }
  return true
}

/** Where a workspace's chats live: its remote server, or this app's server for a local workspace. */
function getWorkspaceServer(workspace: Workspace): RemoteServerConfig {
  if (workspace.remoteServer) return workspace.remoteServer
  const connection = getServerConnection()
  if (!connection) throw new Error('The server is not running')
  return { ...connection, remoteWorkspaceId: workspace.id }
}

app.whenReady().then(async () => {
  // The key of the secrets store, before the server can read a secret. A key in the environment (dev) wins.
  // It goes to the server child's environment only (serverSecrets); it is never logged.
  if (!isClientOnly) {
    try {
      initEncryptionKey({ safeStorage, configDir: CONFIG_DIR, env: serverSecrets, warn: (m) => mainLog.warn(m) })
    } catch (error) {
      // Never make a new key over an unreadable one: the secrets store stays off until the user fixes the file.
      mainLog.error('[encryption-key]', error)
      dialog.showErrorBox('Secrets are unavailable', error instanceof Error ? error.message : String(error))
    }
  }

  // Register thumbnail:// protocol handler (scheme was registered earlier, before app.whenReady)
  registerThumbnailHandler()

  // Serve the packaged renderer from otto://app/ (dev loads the Vite dev server instead)
  handleAppProtocol(session.defaultSession)

  // Set dock icon on macOS (required for dev mode, bundled apps use Info.plist)
  if (process.platform === 'darwin' && app.dock) {
    // In packaged app, resources are at dist/resources/ (same level as __dirname)
    // In dev, resources are at ../resources/ (sibling of dist/)
    const dockIconPath = [
      join(__dirname, 'resources/icon.png'),
      join(__dirname, '../resources/icon.png'),
    ].find(p => existsSync(p))

    if (dockIconPath) {
      app.dock.setIcon(dockIconPath)
      // Initialize badge icon for canvas-based badge overlay
      initBadgeIcon(dockIconPath)
    }

    // Multi-instance dev: show instance number badge on dock icon
    // OTTO_INSTANCE_NUMBER is set by detect-instance.sh for numbered folders
    const instanceNum = process.env.OTTO_INSTANCE_NUMBER
    if (instanceNum) {
      const num = parseInt(instanceNum, 10)
      if (!isNaN(num) && num > 0) {
        initInstanceBadge(num)
      }
    }
  }

  try {
    // Initialize window manager
    windowManager = new WindowManager()

    // Create the application menu (needs windowManager for New Window action)
    createApplicationMenu(windowManager)

    if (isClientOnly) {
      mainLog.info(`Client-only mode: OTTO_SERVER_URL=${process.env.OTTO_SERVER_URL} (no server child)`)
    }

    // Initialize notification service (always — triggered by server push events)
    initNotificationService(windowManager)

    // Initialize browser pane manager
    browserPaneManager = new BrowserPaneManager()
    browserPaneManager.setWindowManager(windowManager)
    browserPaneManager.registerToolbarIpc()
    browserPaneManager.registerCapabilityIpc()

    // Bootstrap IPC handlers — preload uses sendSync for window-local details
    ipcMain.on('__get-web-contents-id', (e) => {
      e.returnValue = e.sender.id
    })
    ipcMain.on('__get-workspace-id', (e) => {
      e.returnValue = windowManager?.getWorkspaceForWindow(e.sender.id) ?? ''
    })

    // Transport diagnostics bridge — preload reports remote WS connection state changes
    // so failures are visible in terminal/main.log (not only renderer console).
    ipcMain.on('__transport:status', (_event, payload: unknown) => {
      if (!payload || typeof payload !== 'object') return
      const p = payload as {
        level?: 'info' | 'warn' | 'error'
        message?: string
        status?: string
        attempt?: number
        nextRetryInMs?: number
        error?: unknown
        close?: unknown
        url?: string
      }

      const level = p.level ?? 'info'
      const message = p.message ?? '[transport] status update'
      const context = {
        status: p.status,
        attempt: p.attempt,
        nextRetryInMs: p.nextRetryInMs,
        error: p.error,
        close: p.close,
        url: p.url,
      }

      if (level === 'error') {
        mainLog.error(message, context)
      } else if (level === 'warn') {
        mainLog.warn(message, context)
      } else {
        mainLog.info(message, context)
      }
    })

    // Dialog bridge — preload capability handlers use ipcRenderer.invoke to
    // call main-process-only dialog APIs (dialog, BrowserWindow).
    ipcMain.handle('__dialog:showMessageBox', async (event, spec) => {
      const win = BrowserWindow.fromWebContents(event.sender)
        || BrowserWindow.getFocusedWindow()
        || BrowserWindow.getAllWindows()[0]
      const result = await dialog.showMessageBox(win, spec)
      return { response: result.response }
    })
    ipcMain.handle('__dialog:showOpenDialog', async (event, spec) => {
      const win = BrowserWindow.fromWebContents(event.sender)
        || BrowserWindow.getFocusedWindow()
        || BrowserWindow.getAllWindows()[0]
      const result = await dialog.showOpenDialog(win, spec)
      return { canceled: result.canceled, filePaths: result.filePaths }
    })

    // Main's own RPC server: windows, dialogs, menus, notifications, updates, browser panes (LOCAL_ONLY in
    // routing.ts). No database: everything else is the server child's.
    const guiToken = randomBytes(24).toString('hex')
    guiServer = new WsRpcServer({
      host: '127.0.0.1',
      port: 0,
      requireAuth: true,
      validateToken: async (token) => (token === guiToken ? { userId: 'desktop' } : null),
      serverId: 'desktop',
      serverVersion: app.getVersion(),
      onClientConnected: ({ clientId, webContentsId }) => {
        if (webContentsId != null) clientMap.set(webContentsId, clientId)
      },
      onClientDisconnected: (clientId) => {
        for (const [wcId, cId] of clientMap) {
          if (cId === clientId) { clientMap.delete(wcId); break }
        }
      },
    })
    registerGuiRpcHandlers(guiServer, { windowManager, browserPaneManager })
    await guiServer.listen()
    moduleSink = guiServer.push.bind(guiServer)

    ipcMain.on('__get-ws-port', (e) => {
      e.returnValue = guiServer?.port
    })
    ipcMain.on('__get-ws-token', (e) => {
      e.returnValue = guiToken
    })
    // The server every local workspace lives on (null: thin client, or not running)
    ipcMain.on('__get-server', (e) => {
      e.returnValue = getServerConnection()
    })
    // A workspace on another server (cut from the MVP, still wired)
    ipcMain.on('__get-workspace-remote-config', (e) => {
      const wsId = windowManager?.getWorkspaceForWindow(e.sender.id)
      e.returnValue = (wsId && getKnownWorkspace(wsId)?.remoteServer) || null
    })
    // The window switched workspace on the server: keep the window's own map (titles, restore, reloads) in step
    ipcMain.on('__window:workspace', (e, workspaceId: string) => {
      if (!windowManager || typeof workspaceId !== 'string') return
      if (!windowManager.updateWindowWorkspace(e.sender.id, workspaceId)) {
        const win = windowManager.getWindowByWebContentsId(e.sender.id)
        if (win) windowManager.registerWindow(win, workspaceId)
      }
      void getWorkspacesOrNone()
    })

    // Cross-server RPC — invoke a channel on an arbitrary remote server
    ipcMain.handle('server:invokeOnServer', async (_event, url: string, token: string, channel: string, ...args: unknown[]) => {
      const { connectToRemote } = await import('./handlers/workspace')
      const { client, error } = await connectToRemote(url, token)
      if (!client) throw new Error(error ?? 'Connection failed')
      try {
        return await client.invoke(channel, ...args)
      } finally {
        client.destroy()
      }
    })

    // Transfer session to another workspace — orchestrated in main process so
    // bundles can be moved directly between owning servers. Every connection is
    // outbound from this process (a local workspace's server is the child), so the
    // local machine never needs to accept an inbound connection.
    ipcMain.handle('session:transferToWorkspace', async (_event, sessionId: string, targetWorkspaceId: string, sessionIndex?: number, sessionCount?: number) => {
      const idx = sessionIndex ?? 0
      const count = sessionCount ?? 1
      const { connectToRemote } = await import('./handlers/workspace')
      const { CHUNKED_TRANSFER_THRESHOLD, getChunkCount, invokeChunked, prepareChunkedPayload } = await import('./chunked-rpc')

      // The pull side (sessions:export) returns the whole bundle as a single
      // unchunked response frame — up to MAX_BUNDLE_SIZE_BYTES over WAN — so
      // the 30s default request timeout is not enough for transfer clients.
      const TRANSFER_REQUEST_TIMEOUT_MS = 120_000

      await getWorkspacesOrNone()
      const targetWorkspace = getKnownWorkspace(targetWorkspaceId)
      if (!targetWorkspace) throw new Error(`Workspace ${targetWorkspaceId} not found`)

      const sourceWorkspaceLocalId = windowManager?.getWorkspaceForWindow(_event.sender.id)
      if (!sourceWorkspaceLocalId) throw new Error('Unable to resolve source workspace for transfer')

      const sourceWorkspace = getKnownWorkspace(sourceWorkspaceLocalId)
      if (!sourceWorkspace) throw new Error(`Source workspace ${sourceWorkspaceLocalId} not found`)

      let bundle: any = null

      const { url: sourceUrl, token: sourceToken, remoteWorkspaceId: sourceRemoteWorkspaceId } = getWorkspaceServer(sourceWorkspace)
      console.log(`[Transfer] Exporting session ${sessionId} from workspace ${sourceRemoteWorkspaceId}...`)
      const { client: sourceClient, error: sourceError } = await connectToRemote(sourceUrl, sourceToken, sourceRemoteWorkspaceId, { requestTimeout: TRANSFER_REQUEST_TIMEOUT_MS })
      if (!sourceClient) throw new Error(sourceError ?? 'Connection failed to source server')

      try {
        bundle = await sourceClient.invoke('sessions:export', sessionId)
        if (!bundle) throw new Error(`Failed to export session ${sessionId}`)

        try {
          console.log('[Transfer] Generating conversation summary on source server...')
          const transferPayload = await sourceClient.invoke('sessions:exportRemoteTransfer', sessionId)
          if (transferPayload?.summary && bundle.session?.header) {
            ;(bundle.session.header as any).transferredSessionSummary = transferPayload.summary
            ;(bundle.session.header as any).transferredSessionSummaryApplied = false
            console.log(`[Transfer] Summary generated: ${transferPayload.summary.length} chars`)
          }
        } catch (err) {
          console.warn('[Transfer] Source-server summary generation failed:', err)
        }
      } finally {
        sourceClient.destroy()
      }

      console.log(`[Transfer] Export complete: ${bundle.session?.messages?.length ?? 0} messages, ${bundle.files?.length ?? 0} files`)

      const emitProgress = (chunkSent: number, chunkTotal: number) => {
        try { _event.sender.send('transfer:progress', { sessionIndex: idx, sessionCount: count, chunkSent, chunkTotal }) } catch { /* renderer may be gone */ }
      }

      const { url, token, remoteWorkspaceId } = getWorkspaceServer(targetWorkspace)
      console.log(`[Transfer] Connecting to target server: ${url}`)
      const { client, error } = await connectToRemote(url, token, remoteWorkspaceId, { requestTimeout: TRANSFER_REQUEST_TIMEOUT_MS })
      if (!client) throw new Error(error ?? 'Connection failed to target server')
      console.log('[Transfer] Connected to target server')

      try {
        const preparedBundle = prepareChunkedPayload(bundle)
        const payloadSize = preparedBundle.bytes.length
        const payloadMB = (payloadSize / (1024 * 1024)).toFixed(1)

        if (payloadSize < CHUNKED_TRANSFER_THRESHOLD) {
          console.log(`[Transfer] Bundle size: ${payloadMB}MB (< 5MB threshold) → using direct RPC`)
          emitProgress(0, 1)
          const result = await client.invoke('sessions:import', remoteWorkspaceId, bundle, 'fork')
          emitProgress(1, 1)
          return result
        }

        const chunkCount = getChunkCount(payloadSize)
        console.log(`[Transfer] Bundle size: ${payloadMB}MB (>= 5MB threshold) → using chunked transfer (${chunkCount} chunks)`)
        return await invokeChunked(
          client,
          'sessions:import',
          [remoteWorkspaceId, bundle, 'fork'],
          1,
          emitProgress,
          preparedBundle,
        )
      } finally {
        client.destroy()
      }
    })

    // App relaunch
    ipcMain.handle('app:relaunch', () => {
      app.relaunch()
      app.exit(0)
    })

    // Language change: sync from renderer to main process, rebuild the native menu, and keep it as the
    // user's preference on the server (session titles and the next launch's menus read it).
    ipcMain.handle('i18n:changeLanguage', async (_event, lang: unknown) => {
      const previousResolved = i18n.resolvedLanguage ?? null
      if (typeof lang !== 'string' || !SUPPORTED_LANGUAGE_CODES.includes(lang as LanguageCode)) {
        // Defense-in-depth: renderer guarantees a supported code, but if a renegade
        // caller hands us garbage we drop it silently rather than poison i18n state.
        mainLog.warn('[i18n] changeLanguage IPC rejected — unsupported code', {
          incoming: lang,
          previousResolved,
        })
        return
      }
      const code = lang as LanguageCode
      await i18n.changeLanguage(code)
      mainLog.info('[i18n] changeLanguage IPC applied', {
        incoming: code,
        previousResolved,
        newResolved: i18n.resolvedLanguage ?? null,
      })
      const { rebuildMenu } = await import('./menu')
      await rebuildMenu()
      if (!getServerConnection()) return
      try {
        const { content } = await invokeServer<{ content: string }>(RPC_CHANNELS.preferences.READ)
        const preferences = JSON.parse(content) as { uiLanguage?: string }
        if (preferences.uiLanguage !== code) await invokeServer(RPC_CHANNELS.preferences.WRITE, JSON.stringify({ ...preferences, uiLanguage: code }))
      } catch (err) {
        mainLog.warn('[i18n] could not keep the language preference:', err instanceof Error ? err.message : err)
      }
    })

    // Wire EventSink to Electron-specific services
    // Must happen BEFORE createInitialWindows() so event handlers use WS from the start
    windowManager.setRpcEventSink(moduleSink, moduleClientResolver)
    const { setMenuEventSink } = await import('./menu')
    setMenuEventSink(moduleSink, moduleClientResolver)
    setNotificationEventSink(moduleSink, moduleClientResolver)

    // The server child, before any window: the preload connects to it while it loads (false: the user quit)
    if (!isClientOnly && !(await startServer())) return

    // Check for VC++ Redistributable on Windows (required by onnxruntime / markitdown).
    // Without it, document conversion tools (PDF, PPTX, DOCX, XLSX) crash with DLL errors.
    // Sets env var so renderer can show an actionable toast with install button.
    if (process.platform === 'win32') {
      const vcCheck = checkVCRedistInstalled()
      if (!vcCheck.installed) {
        mainLog.warn('[vcredist]', vcCheck.message)
        process.env.OTTO_VCREDIST_MISSING = '1'
        if (vcCheck.downloadUrl) {
          process.env.OTTO_VCREDIST_URL = vcCheck.downloadUrl
        }
      } else if (isDebugMode) {
        mainLog.info('[vcredist]', vcCheck.message)
      }
    }

    // Create initial windows (restores from saved state or opens first workspace)
    await createInitialWindows()

    // Initialize auto-update (check immediately on launch)
    // Skip in dev mode to avoid replacing /Applications app and launching it instead
    setAutoUpdateEventSink(moduleSink)
    // Snapshot multi-window state BEFORE quitAndInstall. electron-updater
    // (Squirrel.Mac) destroys BrowserWindows between quitAndInstall and
    // before-quit firing; saving from before-quit alone would overwrite
    // window-state.json with an empty array.
    setBeforeUpdateQuitHook(() => captureAndSaveWindowState('pre-update'))
    // Before the installer hands off, run the full quit cleanup and mark the app
    // as quitting so before-quit's guard returns early instead of cancelling
    // Squirrel.Mac's quit with preventDefault (#891).
    setBeforeUpdateInstallHook(async () => {
      isQuitting = true
      windowManager?.setAppQuitting(true)
      await performQuitCleanup()
    })
    // If quitAndInstall throws after the cleanup above already ran, the process
    // is a zombie: the server is stopped, and isQuitting makes the next quit skip
    // the cleanup. The only honest recovery is a controlled relaunch into a fresh
    // process (#891).
    setInstallQuitFailedHook(() => {
      mainLog.error('[auto-update] quitAndInstall failed after cleanup — relaunching')
      dialog.showMessageBoxSync({
        type: 'error',
        title: 'Update failed',
        message: 'The update could not be installed.',
        detail: `${PRODUCT_NAME} will restart now. The update will be retried on the next launch.`,
      })
      app.relaunch()
      app.exit(0)
    })
    if (app.isPackaged) {
      checkForUpdatesOnLaunch().catch(err => {
        mainLog.error('[auto-update] Launch check failed:', err)
      })
    } else {
      mainLog.info('[auto-update] Skipping auto-update in dev mode')
    }

    // Process pending deep link from cold start
    if (pendingDeepLink) {
      mainLog.info('Processing pending deep link:', pendingDeepLink)
      await handleDeepLink(pendingDeepLink, windowManager, moduleSink, moduleClientResolver)
      pendingDeepLink = null
    }

    mainLog.info('App initialized successfully')
    if (isDebugMode) {
      mainLog.info('Debug mode enabled - logs at:', getLogFilePath())
    }
  } catch (error) {
    mainLog.error('Failed to initialize app:', error instanceof Error ? error.message : error, (error as any)?.stack)
    // Continue anyway - the app will show errors in the UI
  }

  // macOS: Re-create window when dock icon is clicked
  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0 && windowManager) {
      // Open the last focused workspace, else the first
      const workspaces = await getWorkspacesOrNone()
      const savedState = loadWindowState()
      const wsId = savedState?.lastFocusedWorkspaceId
      windowManager.createWindow({ workspaceId: workspaces.some(ws => ws.id === wsId) ? wsId! : (workspaces[0]?.id ?? '') })
    }
  })
})

app.on('window-all-closed', () => {
  // On macOS, apps typically stay active until explicitly quit
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Track if we're in the process of quitting (to avoid re-entry)
let isQuitting = false

/**
 * Capture the current multi-window state and persist it to disk.
 * Called from two sites:
 *   - before-quit (normal quit path, reason='before-quit')
 *   - installUpdate hook (auto-update path, reason='pre-update'), because
 *     electron-updater destroys BrowserWindows between quitAndInstall and
 *     before-quit firing — by the time before-quit runs, getWindowStates()
 *     returns an empty array and would clobber the on-disk state.
 * Returns the number of windows saved, or -1 if windowManager isn't ready.
 */
function captureAndSaveWindowState(reason: 'before-quit' | 'pre-update'): number {
  if (!windowManager) return -1
  const windows = windowManager.getWindowStates()
  const focusedWindow = BrowserWindow.getFocusedWindow()
  const lastFocusedWorkspaceId = focusedWindow
    ? windowManager.getWorkspaceForWindow(focusedWindow.webContents.id) ?? undefined
    : undefined
  saveWindowState({ windows, lastFocusedWorkspaceId })
  mainLog.info('[window-state] saved', { windowCount: windows.length, reason })
  return windows.length
}

// Stop the server (it flushes its chats) and release all quit-time resources. Shared by the normal quit
// path (before-quit) and the update-install handoff (beforeUpdateInstallHook), so
// the two cleanup sequences can't drift (#891).
let quitCleanupRan = false
async function performQuitCleanup(): Promise<void> {
  // Idempotent: a failed update install may retry, and the update path plus a
  // subsequent quit must not dispose already-disposed services.
  if (quitCleanupRan) {
    mainLog.info('Quit cleanup already ran, skipping')
    return
  }
  quitCleanupRan = true

  try {
    await stopServer()
    mainLog.info('Stopped the server')
  } catch (error) {
    mainLog.error('Failed to stop the server:', error)
  }

  // Clean up browser pane instances
  browserPaneManager?.destroyAll()

  guiServer?.close()

  // Clean up power manager (release power blocker)
  cleanupPowerManager()
}

// Save window state and clean up resources before quitting
app.on('before-quit', async (event) => {
  // Avoid re-entry when we call app.exit()
  if (isQuitting) return
  isQuitting = true

  // Ensure Cmd+Q/app quit bypasses layered window close interception (Cmd+W behavior).
  windowManager?.setAppQuitting(true)

  if (windowManager) {
    const windows = windowManager.getWindowStates()
    // Empty-snapshot guard: during update-quit, electron-updater has already
    // destroyed all BrowserWindows by the time before-quit fires. The pre-update
    // hook already saved the real state — don't let this late save overwrite it.
    if (windows.length === 0 && isUpdating()) {
      mainLog.warn('[window-state] skip save: empty snapshot during update-quit (pre-update snapshot wins)')
    } else {
      captureAndSaveWindowState('before-quit')
    }
    // Diagnostic correlation with installUpdate's [update-flow] log. During an
    // update-quit, record it to the dedicated always-on auto-update log (#891)
    // so the install/quit handoff is diagnosable in production; normal quits
    // stay on the debug-only main log.
    const isUpdateQuit = isUpdating()
    const beforeQuitSave = {
      windowCount: windows.length,
      electronWindowCount: BrowserWindow.getAllWindows().length,
      isUpdating: isUpdateQuit,
      reason: isUpdateQuit ? 'update-quit' : 'user-quit',
    }
    if (isUpdateQuit) {
      autoUpdateLog.info('before-quit save', beforeQuitSave)
    } else {
      mainLog.info('[update-flow] before-quit save', beforeQuitSave)
    }
  }

  // Normal quit: stop the server + clean up, then exit. The update-install path does NOT
  // reach here — installUpdate's beforeUpdateInstallHook already ran
  // performQuitCleanup and set isQuitting, so the guard at the top returns early
  // and Squirrel.Mac's quit proceeds uninterrupted so the update installs (#891).
  event.preventDefault()
  await performQuitCleanup()
  app.exit(0)
})

// Handle uncaught exceptions — forward to Sentry explicitly since registering
// a custom handler can interfere with @sentry/electron's automatic capture.
process.on('uncaughtException', (error) => {
  mainLog.error('Uncaught exception:', error)
  Sentry.captureException(error)
})

process.on('unhandledRejection', (reason, promise) => {
  mainLog.error('Unhandled rejection at:', promise, 'reason:', reason)
  Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)))
})
