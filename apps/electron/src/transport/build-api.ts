/**
 * Build the client API proxy.
 *
 * Replaces the 329-line preload. The ElectronAPI TypeScript interface still
 * enforces types at compile time — this proxy provides runtime dispatch.
 */

import type { RpcClient } from '@otto/server-core/transport'
import type { ElectronAPI } from '../shared/types'

// ---------------------------------------------------------------------------
// Channel map entry
// ---------------------------------------------------------------------------

export type ChannelMapEntry =
  | { type: 'invoke'; channel: string; transform?: (result: any) => any }
  | { type: 'listener'; channel: string }

export type ChannelMap = Record<string, ChannelMapEntry>

// ---------------------------------------------------------------------------
// Proxy builder
// ---------------------------------------------------------------------------

export function buildClientApi(
  client: RpcClient,
  channelMap: ChannelMap,
  isChannelAvailable?: (channel: string) => boolean,
): ElectronAPI {
  const api: Record<string, any> = {}

  for (const [key, entry] of Object.entries(channelMap)) {
    let fn: (...a: any[]) => any
    if (entry.type === 'listener') {
      fn = (cb: (...args: any[]) => void) => client.on(entry.channel, cb)
    } else if (entry.transform) {
      const t = entry.transform
      fn = async (...args: any[]) => t(await client.invoke(entry.channel, ...args))
    } else {
      fn = (...args: any[]) => client.invoke(entry.channel, ...args)
    }
    api[key] = fn
  }

  // Expose channel availability check for GUI-aware code
  api.isChannelAvailable = isChannelAvailable ?? (() => true)

  return api as ElectronAPI
}
