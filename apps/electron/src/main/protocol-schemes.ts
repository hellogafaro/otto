/**
 * Electron wiring for the custom schemes: privileges (before `ready`) and the otto handler.
 * The handler itself is pure and lives in app-protocol.ts.
 */

import { join } from 'node:path'
import { protocol, type Session } from 'electron'
import { APP_SCHEME, createAppProtocolHandler } from './app-protocol'
import { thumbnailScheme } from './thumbnail-protocol'

/**
 * Must run once, synchronously, before `app.whenReady()`. Electron keeps only the schemes of the
 * last `registerSchemesAsPrivileged` call, so every custom scheme is listed here.
 */
export function registerPrivilegedSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    thumbnailScheme,
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true, // real origin (otto://app) so relative URLs, history and storage work
        secure: true,
        supportFetchAPI: true, // the renderer fetch()es its own wasm/assets
        // V8 code cache is skipped for custom schemes unless opted in (the bundle is multi-MB).
        codeCache: true,
      },
    },
  ])
}

/**
 * Serve the packaged renderer (`dist/renderer`) from `otto://app/` on a session (handlers are per
 * session; the app pages load in the default session).
 */
export function handleAppProtocol(ses: Session): void {
  if (ses.protocol.isProtocolHandled(APP_SCHEME)) return
  ses.protocol.handle(APP_SCHEME, createAppProtocolHandler({ rendererRoot: join(__dirname, 'renderer') }))
}
