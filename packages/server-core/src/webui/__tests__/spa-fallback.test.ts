import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startWebuiHttpServer } from '../http-server'
import { createTestUsers, signUpOwner } from './test-users'

const HTML_ACCEPT = 'text/html,application/xhtml+xml,*/*;q=0.8'
const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any

let dir: string
let stop: () => void
let baseUrl: string
let cookie: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'otto-webui-spa-'))
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'index.html'), '<html>APP-SHELL</html>')
  writeFileSync(join(dir, 'assets', 'main-abc123.js'), 'console.log("main")')
  writeFileSync(join(dir, 'assets', 'main-abc123.css'), 'body{}')
  for (const name of ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png', 'manifest.json', 'icon-192.png', 'icon-512.png']) {
    writeFileSync(join(dir, name), name)
  }
  writeFileSync(join(dir, '..', 'otto-webui-secret.txt'), 'top secret')

  const users = await createTestUsers()
  const server = await startWebuiHttpServer({
    port: 0,
    webuiDir: dir,
    users,
    wsProtocol: 'ws',
    wsPort: 9100,
    getHealthCheck: () => ({ status: 'ok' }),
    logger,
  })
  stop = server.stop
  baseUrl = `http://127.0.0.1:${server.port}`

  cookie = await signUpOwner(users)
})

afterAll(() => {
  stop()
  rmSync(dir, { recursive: true, force: true })
  rmSync(join(dir, '..', 'otto-webui-secret.txt'), { force: true })
})

function get(path: string, opts: { auth?: boolean; html?: boolean; method?: string } = {}) {
  const headers: Record<string, string> = {}
  if (opts.auth ?? true) headers.cookie = cookie
  if (opts.html) headers.accept = HTML_ACCEPT
  return fetch(`${baseUrl}${path}`, { headers, redirect: 'manual', method: opts.method })
}

describe('authenticated: SPA fallback matrix', () => {
  const shell = ['/', '/test/chats', '/test/chats/abc', '/test/chats/abc/', '/test/chats/abc.v2', '/test/chats/abc.', '/test/settings/appearance', '/test/settings/appearance/', '/some/very/deep/route/with/many/parts', '/login.x/', '/assets']

  for (const path of shell) {
    it(`${path} -> index.html`, async () => {
      for (const html of [true, false]) {
        const res = await get(path, { html })
        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toContain('text/html')
        expect(res.headers.get('cache-control')).toBe('no-cache')
        expect(await res.text()).toContain('APP-SHELL')
      }
    })
  }

  it('serves real files with MIME type and immutable caching for hashed assets', async () => {
    const js = await get('/assets/main-abc123.js')
    expect(js.status).toBe(200)
    expect(js.headers.get('content-type')).toContain('application/javascript')
    expect(js.headers.get('cache-control')).toContain('immutable')
    expect(await js.text()).toBe('console.log("main")')
    expect((await get('/assets/main-abc123.css')).headers.get('content-type')).toContain('text/css')
    expect(await (await get('/favicon.svg')).text()).toBe('favicon.svg')
  })

  const missing = ['/assets/missing.js', '/assets/missing-abc123.css', '/assets/nested/none', '/assets/', '/missing.js', '/test/chats/x.png', '/test/chats/x.map', '/favicon.png']
  for (const path of missing) {
    it(`${path} -> 404 (not index.html)`, async () => {
      for (const html of [true, false]) {
        const res = await get(path, { html })
        expect(res.status).toBe(404)
        expect(await res.text()).not.toContain('APP-SHELL')
      }
    })
  }

  it('unknown /api paths and /ws are JSON 404s, not the shell', async () => {
    for (const path of ['/api/nope', '/api/', '/ws']) {
      const res = await get(path, { html: true })
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'Not Found' })
    }
  })

  it('does not escape the web root', async () => {
    for (const path of ['/..%2fotto-webui-secret.txt', '/%2e%2e/otto-webui-secret.txt', '/assets/..%2f..%2fotto-webui-secret.txt', '/..%5cotto-webui-secret.txt', '/%00', '/%e0%a4%a']) {
      const res = await get(path, { html: true })
      expect(await res.text(), path).not.toContain('top secret')
    }
  })

  it('serves the app shell at /login, where the router renders the login route', async () => {
    expect(await (await get('/login')).text()).toContain('APP-SHELL')
    expect(await (await get('/login/')).text()).toContain('APP-SHELL')
  })

  it('answers HEAD for routes', async () => {
    const res = await get('/test/chats/abc', { method: 'HEAD', html: true })
    expect(res.status).toBe(200)
  })
})

describe('unauthenticated: auth gate', () => {
  it('redirects HTML routes to /login', async () => {
    for (const path of ['/', '/test/chats', '/test/chats/abc', '/test/settings/appearance', '/index.html']) {
      const res = await get(path, { auth: false, html: true })
      expect(res.status, path).toBe(302)
      expect(res.headers.get('location'), path).toContain('/login')
    }
  })

  it('401s non-HTML requests', async () => {
    for (const path of ['/test/chats/abc', '/api/nope', '/api/config', '/api/config/workspaces', '/api/auth']) {
      const res = await get(path, { auth: false })
      expect(res.status, path).toBe(401)
    }
  })

  it('serves the login page, the bundle and the icons without a session', async () => {
    expect(await (await get('/login', { auth: false })).text()).toContain('APP-SHELL')
    expect(await (await get('/login/', { auth: false })).text()).toContain('APP-SHELL')
    for (const path of ['/assets/main-abc123.js', '/assets/main-abc123.css', '/favicon.ico', '/favicon.svg', '/apple-touch-icon.png', '/manifest.json', '/icon-192.png', '/icon-512.png']) {
      const res = await get(path, { auth: false })
      expect(res.status, path).toBe(200)
    }
    expect((await get('/assets/missing.js', { auth: false })).status).toBe(404)
    expect((await get('/icon-x.png', { auth: false })).status).toBe(401)
  })

  it('keeps health, setup, auth and config routes outside the fallback', async () => {
    expect((await get('/health', { auth: false })).status).toBe(200)
    expect(await (await get('/api/setup', { auth: false })).json()).toEqual({ needsOwner: false })
    expect(await (await get('/api/auth/get-session', { auth: false })).json()).toBeNull()
    expect((await get('/api/config', { auth: false })).status).toBe(401)
    expect((await get('/api/config', { auth: true })).status).toBe(200)
  })
})
