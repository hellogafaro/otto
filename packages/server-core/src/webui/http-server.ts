/**
 * Web UI HTTP handler and standalone server.
 *
 * The core logic lives in `createWebuiHandler()` which returns a web-standard
 * fetch handler `(Request) => Promise<Response>`. This handler can be:
 *
 * 1. **Embedded** — attached to the WsRpcServer's HTTPS server via the
 *    node-adapter so that HTTP and WSS share a single port.
 * 2. **Standalone** — wrapped in `Bun.serve()` via `startWebuiHttpServer()`
 *    for separate-port deployments or development.
 */

import { stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { generateCallbackPage } from '@otto/shared/auth'
import type { UsersStore } from '@otto/shared/users'
import type { PlatformServices } from '../runtime/platform'

// ---------------------------------------------------------------------------
// MIME types for static file serving
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.map': 'application/json',
}

function getMimeType(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * A missing file under `/assets/` or with a known static extension is a real 404; every other
 * unknown path is an app route (`/test/chats/abc`) and gets index.html. A dot in a route segment
 * (`/x/chats/a.b`) is fine: only the extensions above count. Keep in sync with `isStaticAssetPath`
 * in apps/electron/src/main/app-protocol.ts.
 */
function isStaticAssetPath(pathname: string): boolean {
  if (pathname.startsWith('/assets/')) return true
  const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1)
  return extname(lastSegment).toLowerCase() in MIME_TYPES
}

/**
 * Where sign-in returns to: a same-origin path (and query) the app opened, never another site.
 * Anything else, and the login page itself, is the app's root.
 */
export function safeNextPath(next: unknown): string {
  if (typeof next !== 'string' || next.length > 2048) return '/'
  // `//host` and `/\host` are protocol-relative to a browser; control characters have no business in a path.
  if (!next.startsWith('/') || next.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(next)) return '/'
  try {
    const parsed = new URL(next, 'http://app.invalid')
    if (parsed.origin !== 'http://app.invalid') return '/'
    if (/^\/(login|login\.html)\/?$/.test(parsed.pathname)) return '/'
  } catch {
    return '/'
  }
  return next
}

/** `/login`, carrying the app path the visitor asked for (nothing for the root) so sign-in can return to it. */
function loginRedirectPath(url: URL): string {
  const next = safeNextPath(url.pathname + url.search)
  return next === '/' || url.pathname === '/index.html' ? '/login' : `/login?next=${encodeURIComponent(next)}`
}

/** Files the login page needs before sign-in (no auth): the app bundle and the icons. */
function isPublicAsset(pathname: string): boolean {
  return pathname.startsWith('/assets/')
    || /^\/(favicon\.(ico|svg)|apple-touch-icon\.png|manifest\.json|icon-\d+\.png)$/.test(pathname)
}

/** Decode a URL pathname to an existing file inside `root`, or null (missing, directory, or escaping). */
async function resolveStaticFile(root: string, pathname: string): Promise<string | null> {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').includes('..')) return null
  const base = resolve(root)
  const target = resolve(base, '.' + decoded)
  if (target !== base && !target.startsWith(base + sep)) return null
  try {
    return (await stat(target)).isFile() ? target : null
  } catch {
    return null
  }
}

/** Hashed bundle files never change; the HTML shell must always be revalidated. */
function staticHeaders(pathname: string): Record<string, string> {
  return {
    'Content-Type': getMimeType(pathname),
    'Cache-Control': pathname.startsWith('/assets/') ? 'private, max-age=31536000, immutable' : 'no-cache',
  }
}

function getForwardedValue(req: Request, key: 'host'): string | null {
  const forwarded = req.headers.get('forwarded')
  if (!forwarded) return null

  const match = forwarded.match(new RegExp(`${key}="?([^;,"]+)"?`, 'i'))
  return match?.[1]?.trim() || null
}

function getRequestHost(req: Request): string | null {
  return req.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
    || getForwardedValue(req, 'host')
    || req.headers.get('host')
}

function formatHostWithPort(host: string, port: number): string {
  try {
    const parsed = new URL(`http://${host}`)
    const hostname = parsed.hostname.includes(':') ? `[${parsed.hostname}]` : parsed.hostname
    return `${hostname}:${port}`
  } catch {
    const withoutPort = host.replace(/:\d+$/, '')
    return `${withoutPort}:${port}`
  }
}

export interface ResolveWebSocketUrlOptions {
  publicWsUrl?: string
  wsProtocol: 'ws' | 'wss'
  wsPort: number
}

export function resolveWebSocketUrl(
  req: Request,
  { publicWsUrl, wsProtocol, wsPort }: ResolveWebSocketUrlOptions,
): string {
  if (publicWsUrl) return publicWsUrl

  const host = getRequestHost(req)
  if (host) {
    return `${wsProtocol}://${formatHostWithPort(host, wsPort)}`
  }

  return `${wsProtocol}://127.0.0.1:${wsPort}`
}

// ---------------------------------------------------------------------------
// Handler options (shared between embedded and standalone modes)
// ---------------------------------------------------------------------------

/** Dependencies for the /api/oauth/callback HTTP route (server-side OAuth completion). */
export interface OAuthCallbackDeps {
  flowStore: { getByState: (state: string) => any; remove: (state: string) => void }
  credManager: { exchangeAndStore: (...args: any[]) => Promise<any> }
  sessionManager: { completeAuthRequest: (...args: any[]) => Promise<void> }
  pushSourcesChanged: (workspaceId: string) => void
}

export interface WebuiHandlerOptions {
  /** Path to built web UI dist/ directory. */
  webuiDir: string
  /** Sign-in and sessions: Better Auth's handler is mounted at /api/auth/*. */
  users: Pick<UsersStore, 'auth' | 'needsOwner'>
  /** Optional browser-facing WebSocket URL override for reverse-proxy deployments. */
  publicWsUrl?: string
  /** RPC WebSocket protocol used when building a browser-facing fallback URL. */
  wsProtocol: 'ws' | 'wss'
  /** RPC WebSocket port used when building a browser-facing fallback URL. */
  wsPort: number
  /** Health check function (injected from existing server handler). */
  getHealthCheck: () => { status: string }
  /** Logger. */
  logger: PlatformServices['logger']
  /** OAuth callback deps — when provided, enables /api/oauth/callback route. */
  oauthCallbackDeps?: OAuthCallbackDeps
}

// ---------------------------------------------------------------------------
// Handler factory — the core request handler
// ---------------------------------------------------------------------------

export interface WebuiHandler {
  /** Web-standard fetch handler. */
  fetch: (req: Request) => Promise<Response>
  /** Inject OAuth callback deps after bootstrap (lazy wiring). */
  setOAuthCallbackDeps: (deps: OAuthCallbackDeps) => void
}

/**
 * Create a web-standard fetch handler for the WebUI.
 *
 * This handler can be used directly with `Bun.serve({ fetch })`,
 * or adapted for Node's HTTP server via `nodeHttpAdapter()`.
 */
export function createWebuiHandler(options: WebuiHandlerOptions): WebuiHandler {
  const { webuiDir, users, publicWsUrl, wsProtocol, wsPort, getHealthCheck, logger } = options

  async function fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname

    // ── Health endpoint (no auth) ──
    if (path === '/health') {
      const health = getHealthCheck()
      return Response.json(health, {
        status: health.status === 'ok' ? 200 : 503,
      })
    }

    // ── Sign-in, sign-up, sessions, invitations: Better Auth (no session needed) ──
    if (path.startsWith('/api/auth/')) return users.auth.handler(req)

    // ── Does the install still need its owner? (the login page asks) ──
    if (path === '/api/setup' && req.method === 'GET') {
      return Response.json({ needsOwner: users.needsOwner() })
    }

    // ── Login page: the app shell, whose router renders the login route (no auth) ──
    if (path === '/login' || path === '/login/') return serveIndex()

    // ── The bundle and icons the login page needs (no auth) ──
    if (isPublicAsset(path)) {
      const filePath = await resolveStaticFile(webuiDir, path)
      if (filePath) {
        return new Response(Bun.file(filePath), { headers: staticHeaders(path) })
      }
      return new Response('Not Found', { status: 404 })
    }

    // ── OAuth callback (no cookie auth — state param is CSRF protection) ──
    // Receives redirect from the relay (or directly from OAuth provider for MCP sources).
    // Completes the token exchange server-side and renders a success/error page.
    if (path === '/api/oauth/callback' && req.method === 'GET' && options.oauthCallbackDeps) {
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      const error = url.searchParams.get('error')
      const errorDescription = url.searchParams.get('error_description')

      if (error) {
        const flow = state ? options.oauthCallbackDeps.flowStore.getByState(state) : null
        if (flow && state) options.oauthCallbackDeps.flowStore.remove(state)
        const errorMsg = errorDescription || error
        logger.warn(`[webui] OAuth callback error: ${errorMsg}`)
        return new Response(generateCallbackPage({ title: 'Authorization Failed', isSuccess: false, errorDetail: errorMsg }), {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }

      if (!code || !state) {
        return new Response(generateCallbackPage({ title: 'Authorization Failed', isSuccess: false, errorDetail: 'Missing code or state parameter' }), {
          status: 400,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }

      try {
        const { completeOAuthFlow } = await import('../handlers/rpc/oauth')
        const result = await completeOAuthFlow({
          code,
          state,
          flowStore: options.oauthCallbackDeps.flowStore,
          credManager: options.oauthCallbackDeps.credManager as any,
          sessionManager: options.oauthCallbackDeps.sessionManager,
          pushSourcesChanged: options.oauthCallbackDeps.pushSourcesChanged,
          logger,
          // No clientId/workspaceId — HTTP callback skips ownership checks (state is auth)
        })

        if (result.success) {
          return new Response(generateCallbackPage({ title: 'Authorization Successful', isSuccess: true }), {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          })
        } else {
          return new Response(generateCallbackPage({ title: 'Authorization Failed', isSuccess: false, errorDetail: result.error }), {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Token exchange failed'
        logger.error(`[webui] OAuth callback failed: ${msg}`)
        return new Response(generateCallbackPage({ title: 'Authorization Failed', isSuccess: false, errorDetail: msg }), {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }
    }

    // ── Everything below requires a session ──
    const session = await users.auth.api.getSession({ headers: req.headers })

    if (!session) {
      const accept = req.headers.get('accept') ?? ''
      if (accept.includes('text/html') || path === '/' || path === '') {
        return Response.redirect(loginRedirectPath(url), 302)
      }
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (path === '/api/config' && req.method === 'GET') {
      return Response.json({
        wsUrl: resolveWebSocketUrl(req, { publicWsUrl, wsProtocol, wsPort }),
      })
    }

    // Return the default workspace ID so the webui can include it in the WS handshake
    if (path === '/api/config/workspaces' && req.method === 'GET') {
      const { getActiveWorkspace } = await import('@otto/shared/config/storage')
      const active = getActiveWorkspace()
      return Response.json({
        defaultWorkspaceId: active?.id ?? null,
      })
    }

    // ── Serve SPA static files ──
    const filePath = await resolveStaticFile(webuiDir, path)
    if (filePath) {
      return new Response(Bun.file(filePath), { headers: staticHeaders(path) })
    }

    // Unknown API and socket paths are errors, never the app shell.
    if (path.startsWith('/api/') || path === '/ws') {
      return Response.json({ error: 'Not Found' }, { status: 404 })
    }
    if (isStaticAssetPath(path)) {
      return new Response('Not Found', { status: 404 })
    }

    // SPA fallback — any other path is a client route (`/{workspace}/chats/{id}`): serve index.html
    return serveIndex()
  }

  async function serveIndex(): Promise<Response> {
    const indexFile = Bun.file(join(webuiDir, 'index.html'))
    if (await indexFile.exists()) {
      return new Response(indexFile, { headers: staticHeaders('/index.html') })
    }
    return new Response('Not Found', { status: 404 })
  }

  return {
    fetch,
    setOAuthCallbackDeps: (deps: OAuthCallbackDeps) => {
      options.oauthCallbackDeps = deps
    },
  }
}

// ---------------------------------------------------------------------------
// Standalone server (backwards-compatible, uses Bun.serve)
// ---------------------------------------------------------------------------

export interface WebuiHttpServerOptions extends WebuiHandlerOptions {
  /** Port to bind on. Use 0 for an ephemeral port in tests. */
  port: number
}

export async function startWebuiHttpServer(
  options: WebuiHttpServerOptions,
): Promise<{ port: number, stop: () => void }> {
  const { port, logger, ...handlerOpts } = options
  const handler = createWebuiHandler({ ...handlerOpts, logger })

  const server = Bun.serve({
    port,
    fetch: handler.fetch,
  })

  const boundPort = server.port ?? port
  logger.info(`[webui] Web UI server listening on http://0.0.0.0:${boundPort}`)

  return { port: boundPort, stop: () => server.stop() }
}
