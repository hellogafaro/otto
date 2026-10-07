/**
 * Power Manager - Prevents screen sleep while chats are running
 *
 * Uses Electron's powerSaveBlocker API to prevent the display from sleeping
 * when the "Keep screen awake" setting is enabled and at least one chat is
 * running a turn. The setting lives on the server; how many chats run comes
 * from its `server:statusChanged` push.
 */

import { powerSaveBlocker } from 'electron'
import { mainLog } from './logger'
import { getInstallSetting } from './server-process'

// Track the current power blocker ID (null when not blocking)
let powerBlockerId: number | null = null

// The number of chats running a turn on the server
let runningChats = 0

// Cache the setting value to avoid a server call per change
let settingEnabled = false

/** Load the setting from the server. Call this once the server answers. */
export async function initPowerManager(): Promise<void> {
  settingEnabled = await getInstallSetting('keepAwakeWhileRunning')
  mainLog.info('[power] Power manager initialized', { settingEnabled })
}

/**
 * Update the power state based on running chats and setting.
 * Called when:
 * - The number of running chats changes
 * - The setting is toggled
 */
function updatePowerState(): void {
  const shouldBlock = settingEnabled && runningChats > 0

  if (shouldBlock && powerBlockerId === null) {
    // Start blocking display sleep
    powerBlockerId = powerSaveBlocker.start('prevent-display-sleep')
    mainLog.info('[power] Started power save blocker', { blockerId: powerBlockerId, runningChats })
  } else if (!shouldBlock && powerBlockerId !== null) {
    // Stop blocking
    powerSaveBlocker.stop(powerBlockerId)
    mainLog.info('[power] Stopped power save blocker', { blockerId: powerBlockerId })
    powerBlockerId = null
  }
}

/** How many chats run a turn now (the server's `server:statusChanged`). */
export function setRunningChats(count: number): void {
  runningChats = count
  updatePowerState()
}

/**
 * Update the keep awake setting.
 * Called from the RPC handler when user toggles the setting.
 */
export function setKeepAwakeSetting(enabled: boolean): void {
  settingEnabled = enabled
  mainLog.info('[power] Keep awake setting changed', { enabled, runningChats })
  updatePowerState()
}

/**
 * Clean up power blocker on app quit.
 * Note: Electron automatically releases blockers on quit, but this is explicit.
 */
export function cleanup(): void {
  if (powerBlockerId !== null) {
    powerSaveBlocker.stop(powerBlockerId)
    mainLog.info('[power] Cleaned up power save blocker on shutdown')
    powerBlockerId = null
  }
  runningChats = 0
}
