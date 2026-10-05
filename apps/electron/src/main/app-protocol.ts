/**
 * `otto://app/` — the origin the packaged renderer is served from.
 *
 * Pure module (no `electron` import) so it is unit-testable. The Electron wiring
 * (privileged scheme + `protocol.handle`) lives in `protocol-schemes.ts`.
 *
 * Why a custom scheme instead of `loadFile`: the renderer uses path URLs
 * (`/{workspace}/chats/{id}`) with the History API. On `file://` a reload on such a
 * path 404s and `pushState` is unusable. Here every path that is not a real file
 * falls back to `index.html` (the same rule as packages/server-core/src/webui/http-server.ts).
 *
 * `otto://` is also the OS deep-link scheme (deep-link.ts). The two coexist: OS deep links reach the
 * app through `open-url` / `second-instance`, never through this handler, and this handler serves
 * ONLY the reserved host `app` (any other host is a 404). The deep-link parser refuses host `app`.
 */

import { readFile, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'

export const APP_SCHEME = 'otto'
export const APP_HOST = 'app'
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
}

/** True for `otto://app/...` (the only otto:// origin the windows may navigate to). */
export function isAppUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === `${APP_SCHEME}:` && parsed.host === APP_HOST
  } catch {
    return false
  }
}

/**
 * A request for a missing file under `/assets/` or with a known static extension must 404;
 * anything else is an app route and falls back to index.html. Keep in sync with `isStaticAssetPath`
 * in packages/server-core/src/webui/http-server.ts. A dot in a route segment (`/x/chats/a.b`) is
 * fine: only the extensions above count.
 */
function isStaticAssetPath(pathname: string): boolean {
  if (pathname.startsWith('/assets/')) return true
  const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1)
  return extname(lastSegment).toLowerCase() in MIME_TYPES
}

/** A document request: navigations send `Accept: text/html` and `Sec-Fetch-Dest: document|iframe`. */
function isNavigation(request: Request): boolean {
  const accept = request.headers.get('accept') ?? ''
  const dest = request.headers.get('sec-fetch-dest')
  return accept.includes('text/html') || dest === 'document' || dest === 'iframe'
}

/** Decode a URL pathname to an absolute path inside `root`, or null when it escapes or is malformed. */
function resolveInside(root: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null
  if (decoded.split('/').includes('..')) return null
  const target = resolve(root, '.' + decoded)
  return target === root || target.startsWith(root + sep) ? target : null
}

async function statFile(path: string) {
  try {
    const info = await stat(path)
    return info.isFile() ? info : null
  } catch {
    return null
  }
}

function fileHeaders(path: string, size: number, pathname: string): Headers {
  const ext = extname(path).toLowerCase()
  const headers = new Headers({
    'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
    'Content-Length': String(size),
    'X-Content-Type-Options': 'nosniff',
  })
  // Vite hashes every file under assets/, so it never changes; HTML must always be revalidated.
  headers.set(
    'Cache-Control',
    pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  )
  return headers
}

export function createAppProtocolHandler({ rendererRoot }: { rendererRoot: string }) {
  const root = resolve(rendererRoot)

  return async function handleAppRequest(request: Request): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
    }

    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return new Response('Bad Request', { status: 400 })
    }
    if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) {
      return new Response('Not Found', { status: 404 })
    }

    const target = resolveInside(root, url.pathname)
    if (!target) return new Response('Forbidden', { status: 403 })

    let file = await statFile(target)
    let filePath = target
    let servedPathname = url.pathname

    if (!file) {
      if (isStaticAssetPath(url.pathname) || !isNavigation(request)) {
        return new Response('Not Found', { status: 404 })
      }
      // SPA fallback: an app route (`/test/chats/abc`, reload, deep link) gets the shell.
      filePath = join(root, 'index.html')
      servedPathname = '/index.html'
      file = await statFile(filePath)
      if (!file) return new Response('Not Found', { status: 404 })
    }

    const headers = fileHeaders(filePath, file.size, servedPathname)
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers })
    return new Response(new Uint8Array(await readFile(filePath)), { status: 200, headers })
  }
}

/**
 * The URL a window loads. `base` is the Vite dev server in dev, `APP_ORIGIN` when packaged.
 * A saved window URL keeps its path and query (`/test/chats/abc`); a legacy `file://` one
 * keeps only its query (`?ws=…&route=…`) because its path was an install directory.
 * `?workspaceId=` is a transitional extra: nothing in the renderer reads it (the preload asks
 * main via `__get-workspace-id`), it only keeps old consumers working until the router lands.
 */
export function buildRendererUrl({
  base,
  workspaceId,
  restoreUrl,
}: {
  base: string
  workspaceId: string
  restoreUrl?: string
}): string {
  const target = new URL(base)
  target.pathname = '/'
  target.search = ''

  if (restoreUrl) {
    try {
      const saved = new URL(restoreUrl)
      if (saved.protocol === 'http:' || saved.protocol === 'https:' || isAppUrl(restoreUrl)) {
        target.pathname = saved.pathname
      }
      target.search = saved.search
    } catch {
      // Unparseable saved URL: fall through to the default.
    }
  }

  if (!target.searchParams.has('workspaceId')) target.searchParams.set('workspaceId', workspaceId)
  return target.toString()
}
