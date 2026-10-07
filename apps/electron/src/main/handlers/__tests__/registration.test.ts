/**
 * The desktop splits the channels over two processes (docs/desktop.md): main answers LOCAL_ONLY, the server child
 * answers the rest. A LOCAL_ONLY request only the server answers would never be reached; a channel main answers that
 * is not LOCAL_ONLY would go to the server instead.
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import type { RpcServer } from '@otto/server-core/transport'
import { createMockGuiDeps, createMockServerDeps } from './electron-mock'

function recordingServer(channels: string[]): RpcServer {
  return {
    handle(channel: string) {
      channels.push(channel)
    },
    push() {},
    async invokeClient() {},
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
}

describe('channels split between main and the server child', () => {
  const main: string[] = []
  const server: string[] = []

  beforeEach(async () => {
    main.length = 0
    server.length = 0
    const { registerGuiRpcHandlers } = await import('../index')
    const { registerCoreRpcHandlers } = await import('@otto/server-core/handlers/rpc')
    registerGuiRpcHandlers(recordingServer(main), createMockGuiDeps())
    registerCoreRpcHandlers(recordingServer(server), createMockServerDeps(), { getConnectedClientCount: () => 0, serverId: 'test', startedAt: 0 })
  })

  it('main registers each of its channels once, and only LOCAL_ONLY ones', async () => {
    const { isLocalOnly } = await import('@otto/shared/protocol')
    expect(main.filter((channel, index) => main.indexOf(channel) !== index)).toEqual([])
    expect(main.filter((channel) => !isLocalOnly(channel))).toEqual([])
  })

  it('every LOCAL_ONLY channel the server answers is answered by main too', async () => {
    const { LOCAL_ONLY_CHANNELS } = await import('@otto/shared/protocol')
    const answeredByMain = new Set(main)
    expect([...LOCAL_ONLY_CHANNELS].filter((channel) => server.includes(channel) && !answeredByMain.has(channel))).toEqual([])
  })
})
