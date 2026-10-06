import { describe, expect, it } from 'bun:test'
import { RPC_CHANNELS } from '@otto/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '@otto/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { registerCoreRpcHandlers } from './index'
import { SESSION_ID_CHANNELS } from './session-guard'

// Chats are private. This enumerates every channel the core registers: the ones that take a session
// id first must refuse another user's chat as `not_found`, and a new one that is not declared fails here.

const OWNER = 'owner-user1'
const OTHER = 'other-user1'
const MINE = 'chat-of-owner'

const ctxOf = (userId: string | null): RequestContext => ({ clientId: 'c', userId, workspaceId: 'ws-1', webContentsId: null })

function register() {
  const handlers = new Map<string, HandlerFn>()
  const server = {
    handle: (channel: string, handler: HandlerFn) => void handlers.set(channel, handler),
    push() {},
    async invokeClient() {},
    hasClientCapability: () => false,
    findClientsWithCapability: () => [],
  } as RpcServer
  const deps = {
    // What the handlers need from the manager here: who may see which chat.
    sessionManager: { canSeeSession: (id: string, userId: string | null) => id === MINE && userId === OWNER },
    platform: { logger: console, imageProcessor: {} },
    // Messaging channels register only when a registry exists; none of its methods is reached.
    messagingRegistry: new Proxy({}, { get: () => () => undefined }),
    oauthFlowStore: {},
  } as unknown as HandlerDeps
  registerCoreRpcHandlers(server, deps)
  return handlers
}

const code = async (run: () => unknown) => {
  try {
    await run()
  } catch (error) {
    return (error as { code?: string }).code ?? 'other'
  }
  return 'ok'
}

describe('chats are private on every channel with a session id', () => {
  const handlers = register()

  it('declares only channels that are registered', () => {
    expect([...SESSION_ID_CHANNELS].filter((channel) => !handlers.has(channel))).toEqual([])
  })

  it('has no registered channel that takes a session id first and is not declared', () => {
    const undeclared = [...handlers]
      .filter(([channel]) => !SESSION_ID_CHANNELS.has(channel))
      // The parameters of a handler as written: (ctx, sessionId, ...)
      .filter(([, handler]) => /^[^(]*\(\s*[\w$]+\s*,\s*sessionId\b/.test(handler.toString()))
      .map(([channel]) => channel)
    expect(undeclared).toEqual([])
  })

  for (const channel of SESSION_ID_CHANNELS) {
    it(`${channel} refuses another user as not_found, and a chat that does not exist the same way`, async () => {
      const handler = handlers.get(channel)!
      expect(await code(() => handler(ctxOf(OTHER), MINE, 'x', 'y'))).toBe('not_found')
      expect(await code(() => handler(ctxOf(null), MINE, 'x', 'y'))).toBe('not_found')
      expect(await code(() => handler(ctxOf(OWNER), 'no-such-chat', 'x', 'y'))).toBe('not_found')
      expect(await code(() => handler(ctxOf(OWNER), undefined))).toBe('not_found')
    })

    it(`${channel} lets the owner of the chat through to its handler`, async () => {
      // The handler may fail on the stub manager, but not with the guard's answer.
      expect(await code(() => handlers.get(channel)!(ctxOf(OWNER), MINE, 'x', 'y'))).not.toBe('not_found')
    })
  }

  it('covers the session channels the brief lists', () => {
    for (const channel of [
      RPC_CHANNELS.sessions.GET_MESSAGES,
      RPC_CHANNELS.sessions.DELETE,
      RPC_CHANNELS.sessions.SEND_MESSAGE,
      RPC_CHANNELS.sessions.CANCEL,
      RPC_CHANNELS.sessions.COMMAND,
      RPC_CHANNELS.sessions.EXPORT,
      RPC_CHANNELS.sessions.GET_FILES,
      RPC_CHANNELS.drafts.GET,
      RPC_CHANNELS.messaging.GENERATE_CODE,
    ]) {
      expect(SESSION_ID_CHANNELS.has(channel)).toBe(true)
    }
  })
})

describe('the lists a caller reads', () => {
  it('sessions:get answers with the chats of the caller only, for the list, pins, recents and the palette alike', async () => {
    const seen: Array<string | null | undefined> = []
    const handlers = new Map<string, HandlerFn>()
    const { registerSessionsHandlers } = await import('./sessions')
    registerSessionsHandlers(
      { handle: (c: string, h: HandlerFn) => void handlers.set(c, h) } as unknown as RpcServer,
      {
        sessionManager: {
          waitForInit: async () => {},
          getSessions: (_ws: string | undefined, viewer: string | null | undefined) => (seen.push(viewer), []),
          getUnreadSummary: (viewer: string | null) => (seen.push(viewer), {}),
        },
        platform: { logger: console },
      } as unknown as HandlerDeps,
    )

    await handlers.get(RPC_CHANNELS.sessions.GET)!(ctxOf(OTHER))
    await handlers.get(RPC_CHANNELS.sessions.GET_UNREAD_SUMMARY)!(ctxOf(OTHER))

    expect(seen).toEqual([OTHER, OTHER])
  })
})
