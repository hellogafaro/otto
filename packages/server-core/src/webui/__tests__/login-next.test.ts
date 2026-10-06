import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { safeNextPath, startWebuiHttpServer } from '../http-server'
import { createTestUsers } from './test-users'

const HTML_ACCEPT = 'text/html,application/xhtml+xml,*/*;q=0.8'
const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any

let dir: string
let stop: () => void
let baseUrl: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'otto-webui-next-'))
  writeFileSync(join(dir, 'index.html'), '<html>APP-SHELL</html>')
  const server = await startWebuiHttpServer({
    port: 0,
    webuiDir: dir,
    users: await createTestUsers(),
    wsProtocol: 'ws',
    wsPort: 9100,
    getHealthCheck: () => ({ status: 'ok' }),
    logger,
  })
  stop = server.stop
  baseUrl = `http://127.0.0.1:${server.port}`
})

afterAll(() => {
  stop()
  rmSync(dir, { recursive: true, force: true })
})

async function redirectOf(path: string): Promise<string | null> {
  const res = await fetch(`${baseUrl}${path}`, { redirect: 'manual', headers: { accept: HTML_ACCEPT } })
  expect(res.status, path).toBe(302)
  return res.headers.get('location')
}

describe('safeNextPath', () => {
  it('keeps same-origin app paths with their query', () => {
    for (const next of ['/', '/test/chats', '/test/settings/ai', '/test/chats/abc?status=todo&flagged=true', '/test/chats/a%20b']) {
      expect(safeNextPath(next), next).toBe(next)
    }
  })

  it('refuses anything that is not a path on this origin', () => {
    for (const next of [
      '//evil.com', '//evil.com/x', '/\\evil.com', '/\\\\evil.com', 'https://evil.com', 'http://evil.com/x', 'javascript:alert(1)',
      'test/chats', '', ' /test', '/te\nst', '/test\u0000', '/%0d%0a' + 'x'.repeat(3000), null, undefined, 42, {},
    ]) {
      expect(safeNextPath(next), String(next)).toBe('/')
    }
  })

  it('never returns to the login page', () => {
    for (const next of ['/login', '/login/', '/login.html', '/login?next=%2Ftest']) {
      expect(safeNextPath(next), next).toBe('/')
    }
    expect(safeNextPath('/login-co/chats')).toBe('/login-co/chats')
  })
})

describe('login redirect carries the path', () => {
  it('redirects an HTML deep link to /login?next=<path+query>', async () => {
    expect(await redirectOf('/test/settings/ai')).toBe('/login?next=%2Ftest%2Fsettings%2Fai')
    expect(await redirectOf('/test/chats/abc?status=todo')).toBe('/login?next=%2Ftest%2Fchats%2Fabc%3Fstatus%3Dtodo')
    expect(await redirectOf('/?ws=test&route=allSessions')).toBe('/login?next=%2F%3Fws%3Dtest%26route%3DallSessions')
  })

  it('redirects the root and the shell file to a bare /login', async () => {
    expect(await redirectOf('/')).toBe('/login')
    expect(await redirectOf('/index.html')).toBe('/login')
    expect(await redirectOf('/login.html')).toBe('/login')
  })
})
