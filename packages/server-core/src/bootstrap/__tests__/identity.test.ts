import { afterEach, describe, expect, it } from 'bun:test'
import WebSocket from 'ws'
import { PROTOCOL_VERSION } from '@otto/shared/protocol'
import type { UsersStore } from '@otto/shared/users'
import { WsRpcServer } from '../../transport/server'
import { authHeaders, cookieOf, createTestUsers, ORIGIN, PASSWORD, signUpOwner } from '../../webui/__tests__/test-users'
import { createIdentityValidators } from '../identity'

const SERVER_TOKEN = 'server-token-0123456789abcdef'

let server: WsRpcServer | undefined
const sockets: WebSocket[] = []
afterEach(() => {
  for (const ws of sockets.splice(0)) ws.close()
  server?.close()
  server = undefined
})

async function start(users: UsersStore) {
  server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, ...createIdentityValidators(users, SERVER_TOKEN) })
  server.handle('test:whoami', (ctx) => ctx.userId)
  await server.listen()
  return `ws://127.0.0.1:${server.port}`
}

type Ack = { clientId: string; reconnected?: boolean }

/** Opens a connection and handshakes; rejects with the server's reason when it refuses. */
function connect(url: string, creds: { token?: string; cookie?: string; reconnectClientId?: string }): Promise<{ ws: WebSocket; ack: Ack }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: creds.cookie ? { cookie: creds.cookie } : {} })
    sockets.push(ws)
    ws.on('open', () =>
      ws.send(
        JSON.stringify({
          id: 'h1',
          type: 'handshake',
          protocolVersion: PROTOCOL_VERSION,
          token: creds.token,
          ...(creds.reconnectClientId && { reconnectClientId: creds.reconnectClientId, lastSeq: 0 }),
        }),
      ),
    )
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString())
      if (message.type === 'handshake_ack') resolve({ ws, ack: message })
      if (message.type === 'error') reject(new Error(message.error?.code ?? 'error'))
    })
    ws.on('close', (code) => reject(new Error(`closed ${code}`)))
  })
}

const whoami = (ws: WebSocket) =>
  new Promise<unknown>((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString()).result))
    ws.send(JSON.stringify({ id: 'r1', type: 'request', channel: 'test:whoami', args: [] }))
  })

async function signUpInvited(users: UsersStore, ownerCookie: string, email: string) {
  const invite = await users.auth.handler(
    new Request(`${ORIGIN}/api/auth/organization/invite-member`, {
      method: 'POST',
      headers: authHeaders({ cookie: ownerCookie }),
      body: JSON.stringify({ email, role: 'member', organizationId: 'ws1' }),
    }),
  )
  expect(invite.status).toBe(200)
  const res = await users.auth.handler(
    new Request(`${ORIGIN}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ name: email, email, password: PASSWORD }),
    }),
  )
  expect(res.status).toBe(200)
  return res
}

describe('WebSocket identity', () => {
  it('refuses the server token until a first user exists, then acts as that user', async () => {
    const users = await createTestUsers({ workspaces: [{ id: 'ws1', title: 'Main' }] })
    const url = await start(users)
    await expect(connect(url, { token: SERVER_TOKEN })).rejects.toThrow('AUTH_FAILED')

    await signUpOwner(users)
    const { ws } = await connect(url, { token: SERVER_TOKEN })
    expect(await whoami(ws)).toBe(users.getFirstUser()!.id)
  })

  it('knows the user by session cookie, and the server token is always the first user', async () => {
    const users = await createTestUsers({ workspaces: [{ id: 'ws1', title: 'Main' }] })
    const ownerCookie = await signUpOwner(users)
    const friend = await signUpInvited(users, ownerCookie, 'friend@example.com')
    const url = await start(users)

    const owner = users.getFirstUser()!.id
    const friendId = ((await (await users.auth.handler(new Request(`${ORIGIN}/api/auth/get-session`, { headers: { cookie: cookieOf(friend) } }))).json()) as { user: { id: string } }).user.id
    expect(friendId).not.toBe(owner)

    expect(await whoami((await connect(url, { cookie: ownerCookie })).ws)).toBe(owner)
    expect(await whoami((await connect(url, { cookie: cookieOf(friend) })).ws)).toBe(friendId)
    expect(await whoami((await connect(url, { token: SERVER_TOKEN })).ws)).toBe(owner)
  })

  it('knows the user by bearer token', async () => {
    const users = await createTestUsers()
    await signUpOwner(users)
    const signIn = await users.auth.handler(
      new Request(`${ORIGIN}/api/auth/sign-in/email`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ email: 'owner@example.com', password: PASSWORD }) }),
    )
    const bearer = signIn.headers.get('set-auth-token')
    expect(bearer).toBeTruthy()
    const url = await start(users)

    expect(await whoami((await connect(url, { token: bearer! })).ws)).toBe(users.getFirstUser()!.id)
  })

  it('refuses a wrong token, a wrong cookie and no credentials', async () => {
    const users = await createTestUsers()
    await signUpOwner(users)
    const url = await start(users)

    await expect(connect(url, { token: SERVER_TOKEN + 'x' })).rejects.toThrow('AUTH_FAILED')
    await expect(connect(url, { token: 'not-a-session-token' })).rejects.toThrow('AUTH_FAILED')
    await expect(connect(url, { cookie: 'otto.session_token=forged.value' })).rejects.toThrow('AUTH_FAILED')
    await expect(connect(url, {})).rejects.toThrow('AUTH_FAILED')
  })

  it('does not let another user resume a connection', async () => {
    const users = await createTestUsers({ workspaces: [{ id: 'ws1', title: 'Main' }] })
    const ownerCookie = await signUpOwner(users)
    const friend = await signUpInvited(users, ownerCookie, 'friend@example.com')
    const url = await start(users)

    const first = await connect(url, { cookie: ownerCookie })
    first.ws.close()
    await new Promise((resolve) => setTimeout(resolve, 50))

    const intruder = await connect(url, { cookie: cookieOf(friend), reconnectClientId: first.ack.clientId })
    expect(intruder.ack.reconnected).toBeUndefined()
    expect(intruder.ack.clientId).not.toBe(first.ack.clientId)
  })
})
