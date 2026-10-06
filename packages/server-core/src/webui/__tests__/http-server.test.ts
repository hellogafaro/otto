import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startWebuiHttpServer } from '../http-server'
import { authHeaders, cookieOf, createTestUsers, PASSWORD, signUpOwner } from './test-users'

const TEMP_DIRS: string[] = []
const SERVERS: Array<{ stop: () => void }> = []

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as any

function createTestWebuiDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'otto-webui-test-'))
  TEMP_DIRS.push(dir)
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body>app</body></html>')
  return dir
}

async function createServer(overrides?: {
  baseURL?: string
  ownerEmail?: string
  publicWsUrl?: string
  wsProtocol?: 'ws' | 'wss'
  wsPort?: number
}) {
  const users = await createTestUsers({ baseURL: overrides?.baseURL, ownerEmail: overrides?.ownerEmail })
  const server = await startWebuiHttpServer({
    port: 0,
    webuiDir: createTestWebuiDir(),
    users,
    publicWsUrl: overrides?.publicWsUrl,
    wsProtocol: overrides?.wsProtocol ?? 'wss',
    wsPort: overrides?.wsPort ?? 9100,
    getHealthCheck: () => ({ status: 'ok' }),
    logger,
  })

  SERVERS.push(server)

  return {
    users,
    server,
    baseUrl: `http://127.0.0.1:${server.port}`,
  }
}

const post = (baseUrl: string, path: string, body: unknown) =>
  fetch(`${baseUrl}${path}`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })

afterEach(() => {
  while (SERVERS.length > 0) {
    SERVERS.pop()?.stop()
  }

  while (TEMP_DIRS.length > 0) {
    const dir = TEMP_DIRS.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('startWebuiHttpServer', () => {
  it('lets the owner set up, then sign in over plain http even when the RPC transport is wss', async () => {
    const { baseUrl } = await createServer({ wsProtocol: 'wss', wsPort: 9100 })

    expect(await (await fetch(`${baseUrl}/api/setup`)).json()).toEqual({ needsOwner: true })
    const signUp = await post(baseUrl, '/api/auth/sign-up/email', { name: 'Owner', email: 'owner@example.com', password: PASSWORD })
    expect(signUp.status).toBe(200)
    expect(await (await fetch(`${baseUrl}/api/setup`)).json()).toEqual({ needsOwner: false })

    const signIn = await post(baseUrl, '/api/auth/sign-in/email', { email: 'owner@example.com', password: PASSWORD })
    expect(signIn.status).toBe(200)
    const setCookie = signIn.headers.get('set-cookie')
    expect(setCookie).toContain('session_token=')
    expect(setCookie).not.toContain('Secure')

    const session = await fetch(`${baseUrl}/api/auth/get-session`, { headers: { cookie: cookieOf(signIn) } })
    expect(((await session.json()) as { user: { email: string } }).user.email).toBe('owner@example.com')

    const configRes = await fetch(`${baseUrl}/api/config`, { headers: { cookie: cookieOf(signIn) } })
    expect(configRes.status).toBe(200)
    expect(await configRes.json()).toEqual({ wsUrl: 'wss://127.0.0.1:9100' })
  })

  it('refuses a first sign-up from another email than OTTO_OWNER_EMAIL, with our error code', async () => {
    const { baseUrl } = await createServer({ ownerEmail: 'boss@example.com' })
    const res = await post(baseUrl, '/api/auth/sign-up/email', { name: 'A', email: 'a@example.com', password: PASSWORD })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { code: string }).code).toBe('OWNER_ONLY')
    expect(await (await fetch(`${baseUrl}/api/setup`)).json()).toEqual({ needsOwner: true })
  })

  it('rejects invalid credentials', async () => {
    const { baseUrl, users } = await createServer()
    await signUpOwner(users)

    const res = await post(baseUrl, '/api/auth/sign-in/email', { email: 'owner@example.com', password: 'wrong-password-123' })

    expect(res.status).toBe(401)
    expect(((await res.json()) as { code: string }).code).toBe('INVALID_EMAIL_OR_PASSWORD')
  })

  it('marks the cookie Secure when the public URL is https', async () => {
    const { baseUrl, users } = await createServer({ baseURL: 'https://otto.example.com' })
    await signUpOwner(users)

    const res = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: authHeaders({ origin: 'https://otto.example.com' }),
      body: JSON.stringify({ email: 'owner@example.com', password: PASSWORD }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('Secure')
  })

  it('derives a browser-facing websocket URL from forwarded public host headers', async () => {
    const { baseUrl, users } = await createServer({ wsProtocol: 'wss', wsPort: 9100 })
    const cookie = await signUpOwner(users)

    const configRes = await fetch(`${baseUrl}/api/config`, {
      headers: {
        cookie,
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'otto.example.com:3100',
      },
    })

    expect(configRes.status).toBe(200)
    expect(await configRes.json()).toEqual({
      wsUrl: 'wss://otto.example.com:9100',
    })
  })

  it('returns an explicit public websocket URL override from /api/config', async () => {
    const { baseUrl, users } = await createServer({
      publicWsUrl: 'wss://otto.example.com/ws',
      wsProtocol: 'wss',
      wsPort: 9100,
    })
    const cookie = await signUpOwner(users)

    const configRes = await fetch(`${baseUrl}/api/config`, { headers: { cookie } })

    expect(configRes.status).toBe(200)
    expect(await configRes.json()).toEqual({
      wsUrl: 'wss://otto.example.com/ws',
    })
  })
})
