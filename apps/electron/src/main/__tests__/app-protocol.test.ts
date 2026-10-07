import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { APP_ORIGIN, buildRendererUrl, createAppProtocolHandler, isAppUrl } from '../app-protocol'
import { parseDeepLink } from '../deep-link'

let sandbox: string
let handle: (request: Request) => Promise<Response>

const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'

function get(path: string, init?: RequestInit & { navigate?: boolean }) {
  const { navigate, ...rest } = init ?? {}
  const headers = new Headers(rest.headers)
  if (navigate) headers.set('accept', HTML_ACCEPT)
  return handle(new Request(`${APP_ORIGIN}${path}`, { ...rest, headers }))
}

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'otto-app-protocol-'))
  const root = join(sandbox, 'renderer')
  mkdirSync(join(root, 'assets'), { recursive: true })
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>shell</title>')
  writeFileSync(join(root, 'playground.html'), '<!doctype html><title>playground</title>')
  writeFileSync(join(root, 'assets', 'main-abc123.js'), 'console.log(1)')
  writeFileSync(join(root, 'assets', 'font a.woff2'), 'font')
  writeFileSync(join(root, 'assets', 'data.wasm'), 'wasm')
  writeFileSync(join(sandbox, 'secret.txt'), 'top secret')
  handle = createAppProtocolHandler({ rendererRoot: root })
})

afterAll(() => rmSync(sandbox, { recursive: true, force: true }))

describe('otto://app protocol handler', () => {
  it('serves real files with their MIME type', async () => {
    const js = await get('/assets/main-abc123.js')
    expect(js.status).toBe(200)
    expect(js.headers.get('content-type')).toContain('text/javascript')
    expect(await js.text()).toBe('console.log(1)')
    expect((await get('/assets/data.wasm')).headers.get('content-type')).toBe('application/wasm')
    expect((await get('/playground.html?x=1', { navigate: true })).headers.get('content-type')).toContain('text/html')
  })

  it('serves encoded file names', async () => {
    const res = await get('/assets/font%20a.woff2')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('font/woff2')
  })

  it('caches hashed assets forever and revalidates HTML', async () => {
    expect((await get('/assets/main-abc123.js')).headers.get('cache-control')).toContain('immutable')
    expect((await get('/', { navigate: true })).headers.get('cache-control')).toBe('no-cache')
  })

  it('falls back to index.html for app routes on navigation', async () => {
    for (const path of [
      '/',
      '/test/chats',
      '/test/chats/abc',
      '/test/chats/abc/',
      '/test/chats/abc.v2',
      '/test/chats/abc.',
      '/test/settings/appearance',
      '/test/chats/abc?x=1#frag',
      '/assets',
    ]) {
      const res = await get(path, { navigate: true })
      expect(res.status, path).toBe(200)
      expect(await res.text(), path).toContain('<title>shell</title>')
    }
  })

  it('also falls back when Sec-Fetch-Dest says document (no Accept)', async () => {
    const res = await get('/test/chats/abc', { headers: { 'sec-fetch-dest': 'document' } })
    expect(res.status).toBe(200)
  })

  it('404s missing assets, even on navigation', async () => {
    for (const path of ['/assets/missing.js', '/missing.js', '/assets/missing-abc.css', '/test/chats/x.png', '/assets/nested/none', '/assets/']) {
      expect((await get(path, { navigate: true })).status, path).toBe(404)
      expect((await get(path)).status, path).toBe(404)
    }
  })

  it('does not fall back for non-navigation requests (fetch/xhr)', async () => {
    expect((await get('/test/chats/abc')).status).toBe(404)
    expect((await get('/api/config', { headers: { accept: 'application/json' } })).status).toBe(404)
  })

  it('serves only host app', async () => {
    for (const url of ['otto://other/index.html', 'otto://workspace/ws1/allSessions', 'otto://action/new-chat', 'otto://auth-callback?code=1']) {
      const res = await handle(new Request(url, { headers: { accept: HTML_ACCEPT } }))
      expect(res.status, url).toBe(404)
    }
  })

  it('rejects path traversal', async () => {
    const attempts = [
      '/../secret.txt',
      '/%2e%2e/secret.txt',
      '/%2E%2E%2Fsecret.txt',
      '/assets/..%2f..%2fsecret.txt',
      '/assets/%2e%2e/%2e%2e/secret.txt',
      '/..%5csecret.txt',
      '/assets/..\\..\\secret.txt',
      '/%00',
      '/%e0%a4%a',
    ]
    for (const path of attempts) {
      for (const navigate of [true, false]) {
        const res = await get(path, { navigate })
        const body = await res.text()
        expect(body, path).not.toContain('top secret')
        expect([200, 400, 403, 404], path).toContain(res.status)
      }
    }
    // Explicit rejections of encoded traversal and malformed input
    expect((await get('/%2e%2e%2fsecret.txt', { navigate: true })).status).toBe(403)
    expect((await get('/%00', { navigate: true })).status).toBe(403)
    expect((await get('/%e0%a4%a', { navigate: true })).status).toBe(403)
  })

  it('supports HEAD without a body and rejects other methods', async () => {
    const head = await get('/assets/main-abc123.js', { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.headers.get('content-length')).toBe('14')
    expect(await head.text()).toBe('')
    const headRoute = await get('/test/chats/abc', { method: 'HEAD', navigate: true })
    expect(headRoute.status).toBe(200)
    expect(headRoute.headers.get('content-type')).toContain('text/html')
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const res = await get('/test/chats/abc', { method, body: 'x', navigate: true })
      expect(res.status, method).toBe(405)
    }
  })

  it('404s when index.html is missing', async () => {
    const empty = mkdtempSync(join(sandbox, 'empty-'))
    const res = await createAppProtocolHandler({ rendererRoot: empty })(
      new Request(`${APP_ORIGIN}/test/chats`, { headers: { accept: HTML_ACCEPT } }),
    )
    expect(res.status).toBe(404)
  })
})

describe('isAppUrl', () => {
  it('accepts only otto://app', () => {
    expect(isAppUrl('otto://app/')).toBe(true)
    expect(isAppUrl('otto://app/test/chats/abc?workspaceId=x')).toBe(true)
    expect(isAppUrl('otto://app.evil.com/')).toBe(false)
    expect(isAppUrl('otto://workspace/ws1/allSessions')).toBe(false)
    expect(isAppUrl('otto://action/new-chat')).toBe(false)
    expect(isAppUrl('file:///tmp/renderer/index.html')).toBe(false)
    expect(isAppUrl('https://app/')).toBe(false)
    expect(isAppUrl('not a url')).toBe(false)
  })
})

describe('buildRendererUrl', () => {
  it('opens the origin with the transitional workspaceId param', () => {
    expect(buildRendererUrl({ base: APP_ORIGIN, workspaceId: 'ws1' })).toBe('otto://app/?workspaceId=ws1')
    expect(buildRendererUrl({ base: 'http://localhost:5173', workspaceId: 'ws1' })).toBe('http://localhost:5173/?workspaceId=ws1')
  })

  it('keeps the path and query of a saved app or dev URL on the current origin', () => {
    expect(buildRendererUrl({ base: APP_ORIGIN, workspaceId: 'ws1', restoreUrl: 'otto://app/test/chats/abc?x=1' }))
      .toBe('otto://app/test/chats/abc?x=1&workspaceId=ws1')
    expect(buildRendererUrl({ base: APP_ORIGIN, workspaceId: 'ws1', restoreUrl: 'http://localhost:5173/test/chats/abc?workspaceId=ws9' }))
      .toBe('otto://app/test/chats/abc?workspaceId=ws9')
    expect(buildRendererUrl({ base: 'http://localhost:5199', workspaceId: 'ws1', restoreUrl: 'otto://app/test/settings/appearance' }))
      .toBe('http://localhost:5199/test/settings/appearance?workspaceId=ws1')
  })

  it('keeps only the query of a legacy file:// URL (its path was an install directory)', () => {
    expect(buildRendererUrl({
      base: APP_ORIGIN,
      workspaceId: 'ws1',
      restoreUrl: 'file:///tmp/.mount_Otto123/resources/app.asar/dist/renderer/index.html?workspaceId=ws1&ws=test&route=allSessions',
    })).toBe('otto://app/?workspaceId=ws1&ws=test&route=allSessions')
  })

  it('never restores a deep-link URL or garbage as a path', () => {
    expect(buildRendererUrl({ base: APP_ORIGIN, workspaceId: 'ws1', restoreUrl: 'otto://workspace/ws1/allSessions' }))
      .toBe('otto://app/?workspaceId=ws1')
    expect(buildRendererUrl({ base: APP_ORIGIN, workspaceId: 'ws1', restoreUrl: 'nonsense' }))
      .toBe('otto://app/?workspaceId=ws1')
  })
})

describe('deep links vs the app origin', () => {
  it('refuses otto://app/... as a deep-link action', () => {
    expect(parseDeepLink('otto://app/')).toBeNull()
    expect(parseDeepLink('otto://app/test/chats/abc')).toBeNull()
    expect(parseDeepLink('otto://app/action/new-chat')).toBeNull()
    expect(parseDeepLink('otto://app/workspace/ws1/allSessions')).toBeNull()
  })

  it('still parses real deep links', () => {
    expect(parseDeepLink('otto://allSessions/session/abc')).toEqual({ workspaceId: undefined, view: 'allSessions/session/abc' })
    expect(parseDeepLink('otto://workspace/ws1/allSessions')?.workspaceId).toBe('ws1')
    expect(parseDeepLink('otto://action/new-chat')?.action).toBe('new-chat')
  })
})
