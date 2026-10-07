import type { IncomingMessage, ServerResponse } from 'node:http'
import { connect } from 'node:net'
import type { Duplex } from 'node:stream'
import { randomBytes } from 'node:crypto'
import { NOVNC_PORT } from '@otto/shared/computer'

/**
 * `/api/computer/<agentId>/screen`: a person watches an agent's box through the server (docs/computers.md "Viewing
 * the desktop"). noVNC listens on the server host's loopback only; this route is the one way in.
 *
 * 1. A member asks `agents:screenUrl` (RPC, membership checked there) and gets `/api/computer/<id>/screen?token=...`:
 *    a random token, single use, valid `URL_TOKEN_MS`.
 * 2. Opening it trades the token for an HttpOnly, SameSite=Strict cookie scoped to that agent's screen path (valid
 *    `VIEWER_MS`) and redirects to noVNC's page, whose files and WebSocket (`.../websockify`) are proxied to the box
 *    with the cookie checked on each request. While the WebSocket is open the box counts a viewer (no idle stop, and
 *    no chat takes the desktop lease: a person watching wins).
 */

export const URL_TOKEN_MS = 60_000
export const VIEWER_MS = 8 * 60 * 60_000
const COOKIE = 'otto_screen'
const ROUTE = /^\/api\/computer\/([a-z0-9]+)\/screen(\/[^?]*)?(?:\?.*)?$/i

export interface ScreenComputer {
  hostPort(port: number): Promise<number | null>
  attachViewer(): () => void
}

export interface ScreenDeps {
  /** The agent's running box, or null. */
  getComputer(agentId: string): ScreenComputer | null
  now?: () => number
}

interface Grant {
  agentId: string
  userId: string
  expiresAt: number
}

const urlTokens = new Map<string, Grant>()
const viewers = new Map<string, Grant>()

/** A one-time URL for `userId` to open `agentId`'s screen. */
export function createScreenUrl(agentId: string, userId: string, now = Date.now()): string {
  const token = randomBytes(24).toString('base64url')
  urlTokens.set(token, { agentId, userId, expiresAt: now + URL_TOKEN_MS })
  return `/api/computer/${agentId}/screen?token=${token}`
}

function take(map: Map<string, Grant>, token: string | null | undefined, agentId: string, now: number, once: boolean): Grant | null {
  if (!token) return null
  const grant = map.get(token)
  if (!grant) return null
  if (once || grant.expiresAt <= now) map.delete(token)
  return grant.expiresAt > now && grant.agentId === agentId ? grant : null
}

function cookieOf(req: IncomingMessage): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=')
    if (name === COOKIE) return value.join('=')
  }
  return null
}

function deny(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(message)
}

/** Serves the screen route; every other request goes to `next`. */
export function createScreenHttpHandler(deps: ScreenDeps, next: (req: IncomingMessage, res: ServerResponse) => void) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const match = ROUTE.exec(req.url ?? '')
    if (!match) return next(req, res)
    void (async () => {
      const agentId = match[1]!
      const rest = match[2] ?? ''
      const now = (deps.now ?? Date.now)()
      const base = `/api/computer/${agentId}/screen`
      if (req.method !== 'GET' && req.method !== 'HEAD') return deny(res, 405, 'Method Not Allowed')
      if (rest === '' || rest === '/') {
        const url = new URL(req.url ?? '', 'http://x')
        const grant = take(urlTokens, url.searchParams.get('token'), agentId, now, true)
        if (!grant) return deny(res, 401, 'This screen link expired. Open the screen again from the app.')
        const viewer = randomBytes(24).toString('base64url')
        viewers.set(viewer, { agentId, userId: grant.userId, expiresAt: now + VIEWER_MS })
        const secure = (req.socket as { encrypted?: boolean }).encrypted ? '; Secure' : ''
        res.writeHead(302, {
          'Set-Cookie': `${COOKIE}=${viewer}; Path=${base}; HttpOnly; SameSite=Strict; Max-Age=${VIEWER_MS / 1000}${secure}`,
          Location: `${base}/vnc.html?autoconnect=true&resize=scale&path=${encodeURIComponent(`${base.slice(1)}/websockify`)}`,
          'Cache-Control': 'no-store',
        })
        return res.end()
      }
      if (!take(viewers, cookieOf(req), agentId, now, false)) return deny(res, 401, 'Open the screen from the app.')
      const port = await deps.getComputer(agentId)?.hostPort(NOVNC_PORT)
      if (!port) return deny(res, 503, 'The computer is not running.')
      const upstream = await fetch(`http://127.0.0.1:${port}${rest}`, { method: req.method }).catch(() => null)
      if (!upstream) return deny(res, 502, 'The computer did not answer.')
      res.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      })
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(await upstream.arrayBuffer()))
    })().catch(() => deny(res, 500, 'Internal Server Error'))
  }
}

/**
 * The screen's WebSocket (`.../screen/websockify`): checked like the files, then piped as raw TCP to the box's
 * websockify. Returns false for any other upgrade (the RPC WebSocket handles those).
 */
export function createScreenUpgradeHandler(deps: ScreenDeps) {
  return (req: IncomingMessage, socket: Duplex, head: Buffer): boolean => {
    const match = ROUTE.exec(req.url ?? '')
    if (!match || match[2] !== '/websockify') return false
    const agentId = match[1]!
    const refuse = (status: string) => {
      socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`)
    }
    if (!take(viewers, cookieOf(req), agentId, (deps.now ?? Date.now)(), false)) {
      refuse('401 Unauthorized')
      return true
    }
    const computer = deps.getComputer(agentId)
    void (async () => {
      const port = computer ? await computer.hostPort(NOVNC_PORT) : null
      if (!computer || !port) return refuse('503 Service Unavailable')
      const upstream = connect(port, '127.0.0.1')
      const detach = computer.attachViewer()
      const close = () => { detach(); upstream.destroy(); socket.destroy() }
      upstream.on('connect', () => {
        const headers: string[] = []
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          const name = req.rawHeaders[i]!
          if (/^(host|cookie)$/i.test(name)) continue
          headers.push(`${name}: ${req.rawHeaders[i + 1]}`)
        }
        upstream.write(`GET /websockify HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n${headers.join('\r\n')}\r\n\r\n`)
        if (head.length) upstream.write(head)
        upstream.pipe(socket)
        socket.pipe(upstream)
      })
      upstream.on('error', close)
      upstream.on('close', close)
      socket.on('error', close)
      socket.on('close', close)
    })()
    return true
  }
}
