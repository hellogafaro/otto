import { RPC_CHANNELS } from '@otto/shared/protocol'
import type { RpcServer } from '@otto/server-core/transport'
import { assertOwnsSession } from '../../sessions/private-chats'
import type { HandlerDeps } from '../handler-deps'

/**
 * Every channel whose first argument is a session id. Chats are private, so each of these refuses
 * (`not_found`, as if the chat did not exist) before its handler runs unless the caller may see
 * the chat; `guardSessionChannels` enforces it in one place, and the test in `session-guard.test.ts`
 * fails when a handler takes a `sessionId` first and is not listed here.
 *
 * Not listed because they take a workspace or a task, not a chat, and filter on their own:
 * sessions:get, getUnreadSummary, markAllRead, searchContent, create, import, importRemoteTransfer,
 * tasks:getOutput, server:getActiveSessions, drafts:getAll.
 */
export const SESSION_ID_CHANNELS: ReadonlySet<string> = new Set([
  RPC_CHANNELS.sessions.GET_MESSAGES,
  RPC_CHANNELS.sessions.DELETE,
  RPC_CHANNELS.sessions.SEND_MESSAGE,
  RPC_CHANNELS.sessions.CANCEL,
  RPC_CHANNELS.sessions.KILL_SHELL,
  RPC_CHANNELS.sessions.RESPOND_TO_PERMISSION,
  RPC_CHANNELS.sessions.RESPOND_TO_CREDENTIAL,
  RPC_CHANNELS.sessions.COMMAND,
  RPC_CHANNELS.sessions.GET_PENDING_PLAN_EXECUTION,
  RPC_CHANNELS.sessions.GET_PERMISSION_MODE_STATE,
  RPC_CHANNELS.sessions.GET_MODEL,
  RPC_CHANNELS.sessions.SET_MODEL,
  RPC_CHANNELS.sessions.GET_FILES,
  RPC_CHANNELS.sessions.GET_NOTES,
  RPC_CHANNELS.sessions.SET_NOTES,
  RPC_CHANNELS.sessions.WATCH_FILES,
  RPC_CHANNELS.sessions.EXPORT,
  RPC_CHANNELS.sessions.EXPORT_REMOTE_TRANSFER,
  RPC_CHANNELS.drafts.GET,
  RPC_CHANNELS.drafts.SET,
  RPC_CHANNELS.drafts.DELETE,
  RPC_CHANNELS.messaging.GENERATE_CODE,
  RPC_CHANNELS.messaging.UNBIND,
])

/** The same server, except that handlers of `SESSION_ID_CHANNELS` run only for the chat's owner. */
export function guardSessionChannels(server: RpcServer, deps: Pick<HandlerDeps, 'sessionManager'>): RpcServer {
  return new Proxy(server, {
    get(target, prop) {
      if (prop === 'handle') {
        return (channel: string, handler: Parameters<RpcServer['handle']>[1]) =>
          target.handle(
            channel,
            SESSION_ID_CHANNELS.has(channel)
              ? (ctx, ...args) => {
                  assertOwnsSession(deps.sessionManager, ctx, args[0])
                  return handler(ctx, ...args)
                }
              : handler,
          )
      }
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
