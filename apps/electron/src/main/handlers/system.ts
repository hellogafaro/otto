import { homedir } from 'os'
import { app, nativeTheme, shell } from 'electron'
import { RPC_CHANNELS } from '@otto/shared/protocol'
import { classifyExternalUrl, formatBlockedUrlError } from '@otto/shared/utils/url-safety'
import type { UnreadSummary } from '@otto/shared/protocol'
import type { RpcServer } from '@otto/server-core/transport'
import type { GuiDeps } from './handler-deps'
import { mainLog } from '../logger'
import { getInstallSetting, invokeServer, updateInstallSetting } from '../server-process'

export const GUI_HANDLED_CHANNELS = [
  RPC_CHANNELS.theme.GET_SYSTEM_PREFERENCE,
  RPC_CHANNELS.system.VERSIONS,
  RPC_CHANNELS.system.HOME_DIR,
  RPC_CHANNELS.system.IS_DEBUG_MODE,
  RPC_CHANNELS.debug.LOG,
  RPC_CHANNELS.shell.OPEN_URL,
  RPC_CHANNELS.update.CHECK,
  RPC_CHANNELS.update.GET_INFO,
  RPC_CHANNELS.update.INSTALL,
  RPC_CHANNELS.update.DISMISS,
  RPC_CHANNELS.update.GET_DISMISSED,
  RPC_CHANNELS.badge.REFRESH,
  RPC_CHANNELS.badge.SET_ICON,
  RPC_CHANNELS.window.GET_FOCUS_STATE,
  RPC_CHANNELS.notification.SHOW,
  RPC_CHANNELS.menu.QUIT,
] as const

export function registerSystemGuiHandlers(server: RpcServer, deps: GuiDeps): void {
  const { windowManager } = deps

  // The OS appearance (dark = true, light = false)
  server.handle(RPC_CHANNELS.theme.GET_SYSTEM_PREFERENCE, async () => nativeTheme.shouldUseDarkColors)

  // This app's runtime versions
  server.handle(RPC_CHANNELS.system.VERSIONS, async () => ({
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  }))

  server.handle(RPC_CHANNELS.system.HOME_DIR, async () => homedir())

  // Running from source
  server.handle(RPC_CHANNELS.system.IS_DEBUG_MODE, async () => !app.isPackaged)

  // Renderer lines into main's log file (fire-and-forget, no response)
  server.handle(RPC_CHANNELS.debug.LOG, async (_ctx, ...args: unknown[]) => {
    mainLog.info('[renderer]', ...args)
  })

  // Open a URL in the OS browser, or an otto:// link in this app's windows
  server.handle(RPC_CHANNELS.shell.OPEN_URL, async (ctx, url: string) => {
    const classification = classifyExternalUrl(url)
    if (classification.kind === 'dangerous') throw new Error(`Failed to open URL: ${formatBlockedUrlError(classification)}`)
    if (classification.kind === 'internal-deeplink') {
      const { handleDeepLink } = await import('../deep-link')
      const resolver = (wcId: number) => windowManager.getClientIdForWindow(wcId)
      await handleDeepLink(url, windowManager, server.push.bind(server), resolver, ctx.clientId)
      return
    }
    await shell.openExternal(url)
  })

  // Auto-update handlers
  server.handle(RPC_CHANNELS.update.CHECK, async () => {
    const { checkForUpdates } = await import('../auto-update')
    return checkForUpdates({ autoDownload: true })
  })

  server.handle(RPC_CHANNELS.update.GET_INFO, async () => {
    const { getUpdateInfo } = await import('../auto-update')
    return getUpdateInfo()
  })

  server.handle(RPC_CHANNELS.update.INSTALL, async () => {
    const { installUpdate } = await import('../auto-update')
    return installUpdate()
  })

  server.handle(RPC_CHANNELS.update.DISMISS, async (_ctx, version: string) => {
    await updateInstallSetting('dismissedUpdateVersion', version)
  })

  server.handle(RPC_CHANNELS.update.GET_DISMISSED, async () => getInstallSetting('dismissedUpdateVersion'))

  // Quit, from the app.quit action
  server.handle(RPC_CHANNELS.menu.QUIT, async () => {
    app.quit()
  })

  // Notifications (whether they are on is the person's setting on the server: notification:getEnabled)
  server.handle(RPC_CHANNELS.notification.SHOW, async (_ctx, title: string, body: string, workspaceId: string, sessionId: string) => {
    const { showNotification } = await import('../notifications')
    showNotification(title, body, workspaceId, sessionId)
  })

  // Badge: the unread count is the server's
  server.handle(RPC_CHANNELS.badge.REFRESH, async () => {
    const { updateBadgeCount } = await import('../notifications')
    const summary = await invokeServer<UnreadSummary>(RPC_CHANNELS.sessions.GET_UNREAD_SUMMARY)
    updateBadgeCount(summary.totalUnreadSessions)
  })

  server.handle(RPC_CHANNELS.badge.SET_ICON, async (_ctx, dataUrl: string) => {
    const { setDockIconWithBadge } = await import('../notifications')
    setDockIconWithBadge(dataUrl)
  })

  server.handle(RPC_CHANNELS.window.GET_FOCUS_STATE, async () => {
    const { isAnyWindowFocused } = await import('../notifications')
    return isAnyWindowFocused()
  })
}
