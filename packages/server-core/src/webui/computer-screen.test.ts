import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createServer, type Server } from 'node:http'
import { URL_TOKEN_MS, createScreenHttpHandler, createScreenUpgradeHandler, createScreenUrl } from './computer-screen'

/** A fake box: noVNC's files and an echoing websockify on one loopback port. */
let novnc: ReturnType<typeof Bun.serve>
let server: Server
let base = ''
let now = 1_000_000
const viewers = { attached: 0, detached: 0 }
const computer = {
  hostPort: async (): Promise<number | null> => novnc.port ?? null,
  attachViewer: () => {
    viewers.attached++
    return () => { viewers.detached++ }
  },
}

beforeAll(async () => {
  novnc = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(req, srv) {
      const url = new URL(req.url)
      if (url.pathname === '/websockify' && srv.upgrade(req, { data: undefined })) return undefined
      return new Response(`novnc ${url.pathname}`, { headers: { 'content-type': 'text/html' } })
    },
    websocket: { message: (ws, msg) => { ws.send(`echo ${msg}`) } },
  })
  const deps = { getComputer: (id: string) => (id === 'agent0000001' ? computer : null), now: () => now }
  server = createServer(createScreenHttpHandler(deps, (_req, res) => { res.writeHead(404); res.end('next') }))
  const upgrade = createScreenUpgradeHandler(deps)
  server.on('upgrade', (req, socket, head) => { if (!upgrade(req, socket, head)) socket.destroy() })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})

afterAll(() => {
  server.close()
  novnc.stop(true)
})

const open = (path: string, cookie?: string) => fetch(`${base}${path}`, { redirect: 'manual', headers: cookie ? { cookie } : {} })

describe('the screen route', () => {
  it('trades a one-time link for a cookie scoped to that agent, then proxies noVNC and its WebSocket', async () => {
    const link = createScreenUrl('agent0000001', 'user00000001', now)
    const first = await open(link)
    expect(first.status).toBe(302)
    expect(first.headers.get('location')).toBe('/api/computer/agent0000001/screen/vnc.html?autoconnect=true&resize=scale&path=api%2Fcomputer%2Fagent0000001%2Fscreen%2Fwebsockify')
    const setCookie = first.headers.get('set-cookie')!
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Strict')
    expect(setCookie).toContain('Path=/api/computer/agent0000001/screen')
    const cookie = setCookie.split(';')[0]!

    // The link works once.
    expect((await open(link)).status).toBe(401)
    // noVNC's files with the cookie; nothing without it, nothing for another agent.
    const page = await open('/api/computer/agent0000001/screen/vnc.html', cookie)
    expect(await page.text()).toBe('novnc /vnc.html')
    expect((await open('/api/computer/agent0000001/screen/vnc.html')).status).toBe(401)
    expect((await open('/api/computer/agent0000002/screen/vnc.html', cookie)).status).toBe(401)
    // Other paths go on to the rest of the server.
    expect(await (await open('/api/other')).text()).toBe('next')

    // The WebSocket is checked the same way and counts a viewer while open.
    const ws = new WebSocket(`${base.replace('http', 'ws')}/api/computer/agent0000001/screen/websockify`, { headers: { cookie } } as never)
    const reply = await new Promise<string>((resolve, reject) => {
      ws.onopen = () => ws.send('hi')
      ws.onmessage = (event) => resolve(String(event.data))
      ws.onerror = () => reject(new Error('websocket failed'))
    })
    expect(reply).toBe('echo hi')
    expect(viewers.attached).toBe(1)
    ws.close()
    await Bun.sleep(100)
    expect(viewers.detached).toBeGreaterThanOrEqual(1)

    const refused = new WebSocket(`${base.replace('http', 'ws')}/api/computer/agent0000001/screen/websockify`)
    expect(await new Promise<string>((resolve) => { refused.onerror = () => resolve('refused'); refused.onopen = () => resolve('open') })).toBe('refused')
  })

  it('an unused link expires', async () => {
    const link = createScreenUrl('agent0000001', 'user00000001', now)
    now += URL_TOKEN_MS + 1
    expect((await open(link)).status).toBe(401)
  })
})
