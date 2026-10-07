/**
 * Transport error-code preservation tests.
 *
 * Spins up a real WsRpcServer + WsRpcClient and verifies that:
 * 1. Handler-thrown `CodedError` values surface on the receiver with `err.code`
 *    set to the original ErrorCode string.
 * 2. `instanceof CodedError` does NOT hold on the receiver (the transport
 *    reconstructs a plain Error; class identity is lost across the wire).
 */

import { describe, it, expect, afterEach } from 'bun:test'
import { WsRpcServer } from '../server'
import { WsRpcClient } from '../client'
import { CLIENT_OPEN_PATH } from '../capabilities'
import { CodedError } from '@otto/shared/protocol'
import { domainError } from '@otto/shared/utils'

const TEST_TOKEN = 'test-token-with-enough-entropy-to-pass'

const teardown: Array<() => void | Promise<void>> = []

afterEach(async () => {
  for (const fn of teardown.splice(0).reverse()) {
    try { await fn() } catch { /* best-effort */ }
  }
})

async function startPair(opts?: { clientCapabilities?: string[]; workspaceId?: string }) {
  let clientId = ''
  const server = new WsRpcServer({
    host: '127.0.0.1',
    port: 0,
    requireAuth: true,
    validateToken: async (t) => (t === TEST_TOKEN ? { userId: 'user00000001' } : null),
    serverId: 'test',
    onClientConnected: (info) => { clientId = info.clientId },
  })
  await server.listen()
  teardown.push(() => server.close())

  const client = new WsRpcClient(`ws://127.0.0.1:${server.port}`, {
    token: TEST_TOKEN,
    workspaceId: opts?.workspaceId ?? 'ws-a',
    clientCapabilities: opts?.clientCapabilities ?? [],
    autoReconnect: false,
  })
  client.connect()
  teardown.push(() => client.destroy())

  // Wait for handshake to complete.
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('client never connected')), 2000)
    const off = client.onConnectionStateChanged((state) => {
      if (state.status === 'connected') {
        clearTimeout(t); off(); resolve()
      } else if (state.status === 'failed' || state.status === 'disconnected') {
        clearTimeout(t); off(); reject(new Error(`status=${state.status}`))
      }
    })
  })

  return { server, client, clientId }
}

describe('Transport — error code preservation', () => {
  it('preserves `err.code` from server handler → client invoke', async () => {
    const { server, client } = await startPair()
    server.handle('explode', async () => {
      throw new CodedError('SESSION_NOT_IDLE', 'nope')
    })

    let caught: unknown
    try {
      await client.invoke('explode')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as { code?: string }).code).toBe('SESSION_NOT_IDLE')
    // Class identity lost over the wire — receiver must branch on `.code`.
    expect(caught instanceof CodedError).toBe(false)
  })

  it('preserves `err.code` from client handler → server invokeClient', async () => {
    const { server, client, clientId } = await startPair({ clientCapabilities: [CLIENT_OPEN_PATH] })

    client.handleCapability(CLIENT_OPEN_PATH, () => {
      throw new CodedError('CAPABILITY_UNAVAILABLE', 'denied')
    })
    expect(clientId).not.toBe('')

    let caught: unknown
    try {
      await server.invokeClient(clientId, CLIENT_OPEN_PATH, '/tmp/x')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as { code?: string }).code).toBe('CAPABILITY_UNAVAILABLE')
  })

  it('falls back to HANDLER_ERROR when handler throws a plain Error', async () => {
    const { server, client } = await startPair()
    server.handle('plain', async () => { throw new Error('boom') })

    let caught: unknown
    try {
      await client.invoke('plain')
    } catch (err) {
      caught = err
    }
    expect((caught as { code?: string }).code).toBe('HANDLER_ERROR')
  })
})

describe('Transport — domain error codes', () => {
  it('sends the code of a domainError to the client', async () => {
    const { server, client } = await startPair()
    server.handle('library', async () => { throw domainError('conflict', 'changed') })
    server.handle('project', async () => { throw domainError('not_found', 'no project') })
    server.handle('task', async () => { throw domainError('invalid', 'bad task') })

    for (const [channel, code, message] of [
      ['library', 'conflict', 'changed'],
      ['project', 'not_found', 'no project'],
      ['task', 'invalid', 'bad task'],
    ]) {
      const caught = await client.invoke(channel!).then(() => undefined, (err: unknown) => err)
      expect((caught as { code?: string }).code).toBe(code)
      expect((caught as Error).message).toBe(message)
    }
  })

  it('does not leak the code of other errors', async () => {
    const { server, client } = await startPair()
    server.handle('enoent', async () => { throw Object.assign(new Error('gone'), { code: 'ENOENT' }) })
    const caught = await client.invoke('enoent').then(() => undefined, (err: unknown) => err)
    expect((caught as { code?: string }).code).toBe('HANDLER_ERROR')
  })
})
