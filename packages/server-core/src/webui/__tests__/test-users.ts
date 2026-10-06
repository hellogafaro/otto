import { openDb } from '@otto/shared/db'
import { createUsersStore, type UsersStore } from '@otto/shared/users'
import { pushSchema } from '../../../../shared/src/db/push.ts'

/** Where the test store says it lives; a request's Origin must match it. */
export const ORIGIN = 'http://127.0.0.1:9100'
export const SETUP_TOKEN = 'setup-token-0123456789'
export const PASSWORD = 'a long enough password'

/** An in-memory users store; its workspaces are the ones given (none by default). */
export async function createTestUsers(options: { baseURL?: string; workspaces?: { id: string; title: string }[] } = {}): Promise<UsersStore> {
  const db = openDb(':memory:')
  await pushSchema(db)
  return createUsersStore(db, { secret: 'x'.repeat(40), baseURL: options.baseURL ?? ORIGIN, setupToken: SETUP_TOKEN, getWorkspaces: () => options.workspaces ?? [] })
}

/** Headers for a request to Better Auth: its Origin check passes and its rate limit sees a fresh client. */
let nextClient = 0
export const authHeaders = (extra: Record<string, string> = {}) => ({
  'content-type': 'application/json',
  origin: ORIGIN,
  'x-forwarded-for': `10.0.${nextClient++ >> 8}.${nextClient & 255}`,
  ...extra,
})

/** The `name=value` pairs of a response's Set-Cookie headers, as a Cookie header. */
export const cookieOf = (res: Response) => res.headers.getSetCookie().map((line) => line.split(';')[0]).join('; ')

/** Signs the owner up through the store's handler. Returns the session cookie. */
export async function signUpOwner(users: UsersStore, email = 'owner@example.com'): Promise<string> {
  const res = await users.auth.handler(
    new Request(`${ORIGIN}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ name: 'Owner', email, password: PASSWORD, setupToken: SETUP_TOKEN }),
    }),
  )
  if (res.status !== 200) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`)
  return cookieOf(res)
}
