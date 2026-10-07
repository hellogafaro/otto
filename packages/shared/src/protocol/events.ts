/**
 * Typed event map for server → client push channels.
 * Keys are channel string literals, values are argument tuples.
 */

import type { ThemeOverrides } from '../config/index'
import type { LoadedSource } from '../sources/types'
import type { LoadedSkill } from '../skills/types'
import { RPC_CHANNELS } from './channels'
import type {
  SessionEvent,
  UnreadSummary,
  UpdateInfo,
  BrowserInstanceInfo,
  DeepLinkNavigation,
} from './dto'

/**
 * What `domain:changed` carries: after a write, the data of this domain in this workspace is stale and
 * clients that show it reload. `userIds` (notifications only) are the people whose inbox changed.
 */
export type DomainChange = {
  domain: 'library' | 'projects' | 'tasks' | 'timesheets' | 'comments' | 'notifications' | 'members' | 'labels' | 'statuses' | 'permissions' | 'skills' | 'sources' | 'agents' | 'routines'
  workspaceId: string
  userIds?: string[]
}

export interface BroadcastEventMap {
  // Session events (workspace-scoped via broadcastToWorkspace)
  [RPC_CHANNELS.sessions.EVENT]: [event: SessionEvent]
  [RPC_CHANNELS.sessions.UNREAD_SUMMARY_CHANGED]: [summary: UnreadSummary]
  [RPC_CHANNELS.sessions.FILES_CHANGED]: [sessionId: string]

  // Domain change broadcasts (global via broadcastToAll)
  [RPC_CHANNELS.sources.CHANGED]: [workspaceId: string, sources: LoadedSource[]]
  [RPC_CHANNELS.sources.CONFLICT]: [workspaceId: string, slug: string]
  [RPC_CHANNELS.skills.CHANGED]: [workspaceId: string, skills: LoadedSkill[]]
  [RPC_CHANNELS.skills.CONFLICT]: [workspaceId: string, slug: string]
  [RPC_CHANNELS.domain.CHANGED]: [change: DomainChange]
  [RPC_CHANNELS.llmConnections.CHANGED]: []
  [RPC_CHANNELS.permissions.DEFAULTS_CHANGED]: [value: null]

  // Theme broadcasts (global)
  [RPC_CHANNELS.theme.APP_CHANGED]: [theme: ThemeOverrides | null]
  [RPC_CHANNELS.theme.SYSTEM_CHANGED]: [isDark: boolean]
  [RPC_CHANNELS.theme.PREFERENCES_CHANGED]: [preferences: { mode: string; colorTheme: string }]

  // Update broadcasts (global)
  [RPC_CHANNELS.update.AVAILABLE]: [info: UpdateInfo]
  [RPC_CHANNELS.update.DOWNLOAD_PROGRESS]: [progress: number]

  // Badge broadcasts (global)
  [RPC_CHANNELS.badge.DRAW]: [data: { count: number; iconDataUrl: string }]
  [RPC_CHANNELS.badge.DRAW_WINDOWS]: [data: { count: number }]

  // Window events (per-window)
  [RPC_CHANNELS.window.FOCUS_STATE]: [isFocused: boolean]
  [RPC_CHANNELS.window.CLOSE_REQUESTED]: []

  // Browser pane events (global)
  [RPC_CHANNELS.browserPane.STATE_CHANGED]: [info: BrowserInstanceInfo]
  [RPC_CHANNELS.browserPane.REMOVED]: [id: string]
  [RPC_CHANNELS.browserPane.INTERACTED]: [id: string]

  // Navigation events (per-window)
  [RPC_CHANNELS.notification.NAVIGATE]: [data: { workspaceId: string; sessionId: string }]
  [RPC_CHANNELS.deeplink.NAVIGATE]: [navigation: DeepLinkNavigation]

  // Copilot device code event
  [RPC_CHANNELS.chatgpt.DEVICE_CODE]: [data: { userCode: string; verificationUri: string }]
  [RPC_CHANNELS.chatgpt.DEVICE_CODE]: [data: { userCode: string; verificationUri: string }]
  [RPC_CHANNELS.copilot.DEVICE_CODE]: [data: { userCode: string; verificationUri: string }]

  // Menu events (per-window, no payload)
  [RPC_CHANNELS.menu.NEW_CHAT]: []
  [RPC_CHANNELS.menu.OPEN_SETTINGS]: []
  [RPC_CHANNELS.menu.KEYBOARD_SHORTCUTS]: []

  // Messaging gateway broadcasts
  [RPC_CHANNELS.messaging.BINDING_CHANGED]: [workspaceId: string]
  [RPC_CHANNELS.messaging.PLATFORM_STATUS]: [workspaceId: string, platform: string, connected: boolean]
}
