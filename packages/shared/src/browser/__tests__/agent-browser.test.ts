import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FortressNotInstalledError, disposeAgentBrowsers, findFortress, getAgentBrowser, parseBrowserCommand, runBrowserCommand, type BrowserToolContext } from '../index.ts'

describe('parseBrowserCommand', () => {
  test('quotes group words; the array form is taken as is', () => {
    expect(parseBrowserCommand('fill @e2 "two words" more')).toEqual(['fill', '@e2', 'two words', 'more'])
    expect(parseBrowserCommand("evaluate 'a; b'")).toEqual(['evaluate', 'a; b'])
    expect(parseBrowserCommand(['evaluate', 'var x = 1; x'])).toEqual(['evaluate', 'var x = 1; x'])
  })
})

describe('Fortress on the host', () => {
  test('missing: a clear error with install help, never another browser', async () => {
    expect(findFortress({ PATH: '/nonexistent' })).toBeNull()
    expect(findFortress({ OTTO_FORTRESS_PATH: '/nonexistent/tilion', PATH: process.env.PATH })).toBeNull()
    const browser = getAgentBrowser('nofortress01', null, { env: { PATH: '/nonexistent' } })
    const error = await browser.page('chat00000001').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(FortressNotInstalledError)
    expect(String((error as Error).message)).toContain('OTTO_FORTRESS_PATH')
    expect(String((error as Error).message)).toContain('github.com/tiliondev/fortress/releases')
  })
})

/**
 * Against a real Fortress: set OTTO_FORTRESS_PATH to its `tilion` launcher (skipped without it).
 * Drives the tool's commands on a local page, two chats in separate contexts.
 */
const FORTRESS = process.env.OTTO_FORTRESS_PATH
describe.skipIf(!FORTRESS)('browser_tool on a real Fortress', () => {
  let server: ReturnType<typeof Bun.serve>
  let profile: string
  beforeAll(() => {
    profile = mkdtempSync(join(tmpdir(), 'otto-fortress-profile-'))
    server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: (req) => {
        const url = new URL(req.url)
        if (url.pathname === '/next') return new Response('<title>Next</title><h1>Thanks</h1>', { headers: { 'content-type': 'text/html' } })
        return new Response(
          `<title>Form</title><h1>Hello Otto</h1>
           <input aria-label="Name" id="name"><select aria-label="Size" id="size"><option value="s">Small</option><option value="l">Large</option></select>
           <button onclick="document.title='Clicked ' + document.getElementById('name').value + ' ' + document.getElementById('size').value">Go</button>
           <a href="/next">Next page</a>
           <script>document.cookie = 'chat=' + location.search.slice(1)</script>`,
          { headers: { 'content-type': 'text/html' } },
        )
      },
    })
  })
  afterAll(() => {
    disposeAgentBrowsers()
    server?.stop(true)
    rmSync(profile, { recursive: true, force: true })
  })

  const ctxFor = (chatId: string): BrowserToolContext => {
    const browser = getAgentBrowser('fortress0001', null, { profileDir: profile, env: { ...process.env, TILION_NO_GEO: '1' } })
    return { page: () => browser.page(chatId), close: () => browser.close(chatId) }
  }

  test('navigate, snapshot, fill, select, click, screenshot, back; contexts per chat', async () => {
    const a = ctxFor('chatA0000001')
    const base = `http://127.0.0.1:${server.port}`
    expect((await runBrowserCommand(`navigate ${base}/?a`, a)).output).toContain('Page: Form')
    const snap = (await runBrowserCommand('snapshot', a)).output
    expect(snap).toContain('heading "Hello Otto"')
    const ref = (role: string, name: string) => snap.split('\n').find((l) => l.includes(`${role} "${name}"`))!.split(' ')[0]!
    await runBrowserCommand(['fill', ref('textbox', 'Name'), 'Ana Lima'], a)
    await runBrowserCommand(`select ${ref('combobox', 'Size')} Large`, a)
    expect((await runBrowserCommand(`click ${ref('button', 'Go')}`, a)).output).toContain('Page: Clicked Ana Lima l')
    expect((await runBrowserCommand('find next', a)).output).toContain('link "Next page"')
    const shot = await runBrowserCommand('screenshot', a)
    expect(shot.screenshot!.subarray(1, 4).toString()).toBe('PNG')
    await Bun.write(join(tmpdir(), 'otto-fortress-shot.png'), shot.screenshot!)
    await runBrowserCommand(`click ${ref('link', 'Next page')}`, a)
    expect((await runBrowserCommand('wait text Thanks 5000', a)).output).toContain('Found text')
    expect((await runBrowserCommand('back', a)).output).toContain('Page: Clicked Ana Lima l')

    // A second chat has its own context: other cookies, its own page.
    const b = ctxFor('chatB0000001')
    await runBrowserCommand(`navigate ${base}/?b`, b)
    expect((await runBrowserCommand('evaluate document.cookie', b)).output).toBe('chat=b')
    expect((await runBrowserCommand('evaluate document.cookie', a)).output).toBe('chat=a')
    expect((await runBrowserCommand('evaluate navigator.userAgent', a)).output).not.toContain('Headless')

    expect((await runBrowserCommand('close', b)).output).toContain('Closed')
    expect((await runBrowserCommand('close', b)).output).toContain('no open browser')
  }, 60_000)
})
