import { sameSecret, type UsersStore } from '@otto/shared/users'
import type { WsRpcServerOptions } from '../transport/server'

/**
 * Who a WebSocket connection is, from its handshake: a user or nothing.
 * - a session cookie or a bearer token (Better Auth's bearer plugin) is that session's user;
 * - the server token (`OTTO_SERVER_TOKEN`, or the per-launch token of the desktop app) is the first
 *   user, and nobody until a first user exists.
 */
export function createIdentityValidators(
  users: Pick<UsersStore, 'auth' | 'getFirstUser'>,
  serverToken: string,
): Required<Pick<WsRpcServerOptions, 'validateToken' | 'validateSessionCookie'>> {
  async function getSessionUser(headers: Record<string, string>) {
    const session = await users.auth.api.getSession({ headers: new Headers(headers) })
    return session ? { userId: session.user.id } : null
  }

  return {
    validateToken: async (token) => {
      if (!sameSecret(token, serverToken)) return getSessionUser({ authorization: `Bearer ${token}` })
      const first = users.getFirstUser()
      return first ? { userId: first.id } : null
    },
    validateSessionCookie: async (cookie) => (cookie ? getSessionUser({ cookie }) : null),
  }
}
