import { RPC_CHANNELS } from '@otto/shared/protocol'
import type { RpcServer } from '@otto/server-core/transport'
import { setKeepAwakeSetting } from '../power-manager'
import { updateInstallSetting } from '../server-process'

export const GUI_HANDLED_CHANNELS = [
  RPC_CHANNELS.power.SET_KEEP_AWAKE,
] as const

export function registerSettingsGuiHandlers(server: RpcServer): void {
  // Keep the screen awake while a chat runs: stored on the server, applied to the OS power blocker here
  server.handle(RPC_CHANNELS.power.SET_KEEP_AWAKE, async (_ctx, enabled: boolean) => {
    await updateInstallSetting('keepAwakeWhileRunning', enabled)
    setKeepAwakeSetting(enabled)
  })
}
