#!/usr/bin/env bun
/**
 * @otto/server — standalone headless Otto server.
 *
 * Usage:
 *   OTTO_SERVER_TOKEN=<secret> bun run packages/server/src/index.ts
 *
 * Environment:
 *   OTTO_SERVER_TOKEN         — required: the machine and CLI credential (acts as the first user)
 *   OTTO_OWNER_EMAIL          — optional: the only email that may make the first account (otherwise the
 *                               first sign-up wins, and the boot log warns until it happens)
 *   BETTER_AUTH_SECRET        — required: signs sessions and tokens, at least 32 characters (not ENCRYPTION_KEY)
 *   BETTER_AUTH_URL           — the public origin the browser uses (https makes cookies Secure)
 *   BETTER_AUTH_TRUSTED_ORIGINS — optional comma-separated extra origins allowed to call /api/auth
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET — optional: each pair turns that sign-in on
 *   OTTO_STORAGE              — where library files are stored: disk (default) or s3 (docs/object-storage.md); with s3, the
 *                               workspace's library folder is a read-through cache of the bucket
 *   OTTO_S3_ENDPOINT, OTTO_S3_BUCKET, OTTO_S3_REGION, OTTO_S3_ACCESS_KEY_ID, OTTO_S3_SECRET_ACCESS_KEY
 *                             — required with OTTO_STORAGE=s3 (path-style endpoint: Garage, minio, AWS)
 *   OTTO_S3_PREFIX            — optional folder in the bucket for everything Otto stores (default: none)
 *   OTTO_RPC_HOST             — bind address (default: 127.0.0.1)
 *   OTTO_RPC_PORT             — bind port (default: 9100)
 *   OTTO_RPC_TLS_CERT         — path to PEM certificate file (enables TLS/wss)
 *   OTTO_RPC_TLS_KEY          — path to PEM private key file (required with cert)
 *   OTTO_RPC_TLS_CA           — path to PEM CA chain file (optional)
 *   OTTO_APP_ROOT             — app root path (default: cwd)
 *   OTTO_RESOURCES_PATH       — resources path (default: cwd/resources)
 *   OTTO_IS_PACKAGED          — 'true' for production (default: false)
 *   OTTO_VERSION              — app version (default: 0.0.0-dev)
 *   OTTO_DEBUG                — 'true' for debug logging
 *   OTTO_WEBUI_DIR            — path to built web UI assets (enables web UI on RPC port)
 *   OTTO_WEBUI_SECURE_COOKIE  — optional true/false override for the session cookie Secure flag
 *   OTTO_WEBUI_WS_URL         — optional browser-facing ws:// or wss:// URL returned by /api/config
 *   OTTO_MESSAGING_WA_WORKER  — absolute path to worker.cjs (default: packages/messaging-whatsapp-worker/dist/worker.cjs)
 *   OTTO_MESSAGING_NODE_BIN   — Node binary used to spawn the WhatsApp worker (default: node)
 */

import { join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { version as packageVersion } from '../package.json'
import { enableDebug } from '@otto/shared/utils/debug'
import { bootstrapServer, startHealthHttpServer, generateServerToken } from '@otto/server-core/bootstrap'
import { createWebuiHandler, nodeHttpAdapter } from '@otto/server-core/webui'
import type { WebuiHandler } from '@otto/server-core/webui'
import { getCredentialManager } from '@otto/shared/credentials'
import { initSecrets } from '@otto/shared/secrets'
import { initFileStorage } from '@otto/shared/library'
import { initUsersStore } from '@otto/shared/users'
import { getWorkspaces } from '@otto/shared/config'
import { CONFIG_DIR } from '@otto/shared/config/paths'
import { createMessagingBootstrap, type MessagingBootstrapHandle } from '@otto/messaging-gateway'

// --generate-token: print a crypto-random token and exit
if (process.argv.includes('--generate-token')) {
  console.log(generateServerToken())
  process.exit(0)
}
import type { WsRpcTlsOptions } from '@otto/server-core/transport'
import { registerCoreRpcHandlers, cleanupSessionFileWatchForClient } from '@otto/server-core/handlers/rpc'
import { SessionManager, setSessionPlatform, setSessionRuntimeHooks } from '@otto/server-core/sessions'
import { initModelRefreshService, setFetcherPlatform } from '@otto/server-core/model-fetchers'
import { setSearchPlatform, setImageProcessor } from '@otto/server-core/services'
import type { HandlerDeps } from '@otto/server-core/handlers'

process.env.OTTO_IS_PACKAGED ??= 'false'

// Prevent unhandled rejections from crashing the server.
// SDK subprocess abort can reject promises that propagate up unhandled;
// Bun (unlike Node) terminates the process on unhandled rejections by default.
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason)
  console.error(`[server] Unhandled rejection (caught, not crashing): ${msg}`)
})

if (process.env.OTTO_DEBUG === 'true' || process.env.OTTO_DEBUG === '1') {
  enableDebug()
}

function parseOptionalWebSocketUrl(name: string, value: string | undefined): string | undefined {
  if (value == null || value.trim() === '') return undefined

  try {
    const url = new URL(value)
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
      throw new Error('must use ws:// or wss://')
    }
    return value
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Invalid ${name}: ${message}`)
    process.exit(1)
  }
}

// In dev (monorepo), bundled assets root is the repo root (4 levels up from this file).
// In packaged mode, use OTTO_BUNDLED_ASSETS_ROOT env or cwd.
const bundledAssetsRoot = process.env.OTTO_BUNDLED_ASSETS_ROOT
  ?? join(import.meta.dir, '..', '..', '..', '..')

// TLS configuration — when cert + key paths are provided, server listens on wss://
let tls: WsRpcTlsOptions | undefined
const tlsCertPath = process.env.OTTO_RPC_TLS_CERT
const tlsKeyPath = process.env.OTTO_RPC_TLS_KEY
if (tlsCertPath || tlsKeyPath) {
  if (!tlsCertPath || !tlsKeyPath) {
    console.error('TLS requires both OTTO_RPC_TLS_CERT and OTTO_RPC_TLS_KEY.')
    process.exit(1)
  }
  tls = {
    cert: readFileSync(tlsCertPath),
    key: readFileSync(tlsKeyPath),
    ...(process.env.OTTO_RPC_TLS_CA ? { ca: readFileSync(process.env.OTTO_RPC_TLS_CA) } : {}),
  }
}

// Secrets are encrypted under ENCRYPTION_KEY and sessions are signed with BETTER_AUTH_SECRET, library files go where OTTO_STORAGE says: fail now, not at the first use.
try {
  initSecrets()
  initUsersStore()
  const storage = initFileStorage()
  if (storage === 's3') console.log(`Library files: s3 bucket ${process.env.OTTO_S3_BUCKET} at ${new URL(process.env.OTTO_S3_ENDPOINT!).host}`)
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}

// Web UI configuration
const webuiDir = process.env.OTTO_WEBUI_DIR || undefined
const webuiEnabled = webuiDir && existsSync(webuiDir)
const webuiWsUrl = parseOptionalWebSocketUrl('OTTO_WEBUI_WS_URL', process.env.OTTO_WEBUI_WS_URL)
const serverToken = process.env.OTTO_SERVER_TOKEN

// ---------------------------------------------------------------------------
// Create WebUI handler early so it can be embedded in the WsRpcServer.
// The handler is a pure function — it doesn't need the session manager yet
// because health checks are injected lazily via getHealthCheck().
// ---------------------------------------------------------------------------

let webuiHandler: WebuiHandler | null = null
let webuiNodeHandler: ReturnType<typeof nodeHttpAdapter> | undefined

// Health check is injected lazily — the session manager isn't ready until
// after bootstrap completes, but the handler captures the closure.
let healthCheckFn: (() => { status: string }) | null = null

if (webuiEnabled && serverToken) {
  const rpcPort = parseInt(process.env.OTTO_RPC_PORT ?? '9100', 10)
  const rpcProtocol = tls ? 'wss' as const : 'ws' as const

  webuiHandler = createWebuiHandler({
    webuiDir: webuiDir!,
    users: initUsersStore(),
    publicWsUrl: webuiWsUrl,
    wsProtocol: rpcProtocol,
    // WebUI is served on the same port as WS — wsPort matches the RPC port
    wsPort: rpcPort,
    getHealthCheck: () => healthCheckFn?.() ?? { status: 'starting' },
    logger: { info: console.log, warn: console.warn, error: console.error } as any,
  })

  webuiNodeHandler = nodeHttpAdapter(webuiHandler.fetch)
}

// Resolve WhatsApp worker paths up-front so the helper + Docker env stay in sync.
// The worker is a Node subprocess — Bun cannot run it directly — so we must
// pass an explicit `nodeBin` (Electron defaults nodeBin to process.execPath
// which is correct there but wrong under Bun).
const waWorkerEntry = process.env.OTTO_MESSAGING_WA_WORKER
  ?? join(bundledAssetsRoot, 'packages', 'messaging-whatsapp-worker', 'dist', 'worker.cjs')
const waNodeBin = process.env.OTTO_MESSAGING_NODE_BIN ?? 'node'

// Built inside createHandlerDeps (needs sessionManager), populated with the WS
// publisher after bootstrapServer resolves.
let messagingHandle: MessagingBootstrapHandle | null = null

const instance = await (async () => {
  try {
    return await bootstrapServer<SessionManager, HandlerDeps>({
      bundledAssetsRoot,
      serverVersion: process.env.OTTO_VERSION ?? packageVersion,
      tls,
      // Embed the WebUI HTTP handler on the WS server's port
      httpHandler: webuiNodeHandler,
      applyPlatformToSubsystems: (platform) => {
        setFetcherPlatform(platform)
        setSessionPlatform(platform)
        setSessionRuntimeHooks({
          updateBadgeCount: () => {},
          captureException: (error) => {
            const err = error instanceof Error ? error : new Error(String(error))
            platform.captureError?.(err)
          },
        })
        setSearchPlatform(platform)
        setImageProcessor(platform.imageProcessor)
      },
      initModelRefreshService: () => initModelRefreshService(async (slug: string, scope: string) => {
        const manager = getCredentialManager()
        const [apiKey, oauth] = await Promise.all([
          manager.getLlmApiKey(slug, scope).catch(() => null),
          manager.getLlmOAuth(slug, scope).catch(() => null),
        ])
        return {
          apiKey: apiKey ?? undefined,
          oauthAccessToken: oauth?.accessToken,
          oauthRefreshToken: oauth?.refreshToken,
          oauthIdToken: oauth?.idToken,
        }
      }),
      createSessionManager: () => new SessionManager(),
      bindRpcServer: (sm, server) => sm.setRpcServer(server),
      createHandlerDeps: ({ sessionManager, platform, oauthFlowStore }) => {
        messagingHandle = createMessagingBootstrap({
          sessionManager,
          credentialManager: getCredentialManager(),
          getMessagingDir: (wsId: string) =>
            join(CONFIG_DIR, 'workspaces', wsId, 'messaging'),
          // Headless has no legacy messaging dir — workspaces start clean.
          whatsapp: {
            workerEntry: waWorkerEntry,
            nodeBin: waNodeBin,
            pairingMode: 'qr',
          },
        })
        return {
          sessionManager,
          platform,
          oauthFlowStore,
          messagingRegistry: messagingHandle.registry,
        }
      },
      registerAllRpcHandlers: registerCoreRpcHandlers,
      setSessionEventSink: (sessionManager, sink) => {
        if (!messagingHandle) {
          // createHandlerDeps always runs before setSessionEventSink, but be
          // defensive in case bootstrapServer's ordering ever changes.
          sessionManager.setEventSink(sink)
          return
        }
        sessionManager.setEventSink(messagingHandle.wrapSink(sink))
      },
      initializeSessionManager: async (sessionManager) => {
        await sessionManager.initialize()
      },
      cleanupSessionManager: async (sessionManager) => {
        try {
          await sessionManager.flushAllSessions()
        } finally {
          sessionManager.cleanup()
        }
      },
      cleanupClientResources: cleanupSessionFileWatchForClient,
    })
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
})()

// ---------------------------------------------------------------------------
// Messaging post-bootstrap: bind the WS publisher and initialize local
// workspaces. Remote-owned workspaces are skipped because their messaging
// runs on the remote server.
// ---------------------------------------------------------------------------
// OTTO_DISABLE_MESSAGING lets a dev/test server share a config dir with a live app
// without both processes fighting over the same Telegram/WhatsApp connections (409s).
const messagingDisabled = process.env.OTTO_DISABLE_MESSAGING === 'true' || process.env.OTTO_DISABLE_MESSAGING === '1'
if (messagingHandle !== null && !messagingDisabled) {
  const handle: MessagingBootstrapHandle = messagingHandle
  handle.setPublisher(instance.wsServer.push.bind(instance.wsServer))
  try {
    const localWorkspaceIds = getWorkspaces()
      .filter((ws) => !ws.remoteServer)
      .map((ws) => ws.id)
    await handle.initializeWorkspaces(localWorkspaceIds)
  } catch (error) {
    console.error('[messaging] Workspace initialization failed:', error)
  }
} else if (messagingDisabled) {
  console.log('[messaging] Disabled via OTTO_DISABLE_MESSAGING — skipping workspace messaging init')
}

// Wire up the lazy health check now that the session manager is ready
if (webuiHandler) {
  const { getHealthCheck } = await import('@otto/server-core/handlers/rpc/server')
  const depsLike = { sessionManager: instance.sessionManager } as any
  healthCheckFn = () => getHealthCheck(depsLike)

  // Wire up OAuth callback deps so /api/oauth/callback works
  const { getSourceCredentialManager, getLoadedSources } = await import('@otto/shared/sources')
  const { getWorkspaceByNameOrId } = await import('@otto/shared/config')
  const { pushTyped } = await import('@otto/server-core/transport')
  const { RPC_CHANNELS } = await import('@otto/shared/protocol')

  webuiHandler.setOAuthCallbackDeps({
    flowStore: instance.oauthFlowStore,
    credManager: getSourceCredentialManager(),
    sessionManager: instance.sessionManager,
    pushSourcesChanged: (workspaceId: string) => {
      const ws = getWorkspaceByNameOrId(workspaceId)
      const sources = ws ? getLoadedSources(ws.id) : []
      pushTyped(instance.wsServer, RPC_CHANNELS.sources.CHANGED, { to: 'workspace', workspaceId }, workspaceId, sources)
    },
  })
}

// Start HTTP health endpoint if OTTO_HEALTH_PORT is set
const healthPort = parseInt(process.env.OTTO_HEALTH_PORT ?? '0', 10)
const healthServer = await startHealthHttpServer({
  port: healthPort,
  deps: { sessionManager: instance.sessionManager },
  wsServer: instance.wsServer,
  platform: instance.platform,
})

const serverProto = instance.protocol === 'wss' ? 'https' : 'http'
console.log(`OTTO_SERVER_URL=${instance.protocol}://${instance.host}:${instance.port}`)
console.log(`OTTO_SERVER_TOKEN=${instance.token}`)
if (webuiHandler) {
  console.log(`OTTO_WEBUI_URL=${serverProto}://0.0.0.0:${instance.port}`)
}

// Block binding to a non-localhost address without TLS — tokens would be sent in cleartext.
// Override with --allow-insecure-bind for explicitly trusted networks.
const isLocalBind = instance.host === '127.0.0.1' || instance.host === 'localhost' || instance.host === '::1'
if (!isLocalBind && instance.protocol === 'ws') {
  if (process.argv.includes('--allow-insecure-bind')) {
    console.warn(
      '\n⚠️  WARNING: Server is listening on a network address without TLS.\n' +
      '   Authentication tokens will be sent in cleartext.\n' +
      '   Set OTTO_RPC_TLS_CERT and OTTO_RPC_TLS_KEY to enable wss://.\n'
    )
  } else {
    console.error(
      '\n❌  Refusing to bind to a network address without TLS.\n' +
      '   Authentication tokens would be sent in cleartext.\n\n' +
      '   Options:\n' +
      '     1. Set OTTO_RPC_TLS_CERT and OTTO_RPC_TLS_KEY to enable wss://\n' +
      '     2. Pass --allow-insecure-bind to override (NOT recommended for production)\n'
    )
    await instance.stop()
    process.exit(1)
  }
}

const shutdown = async () => {
  healthServer?.stop()
  if (messagingHandle) {
    try {
      await messagingHandle.dispose()
    } catch (error) {
      console.error('[messaging] dispose failed:', error)
    }
  }
  await instance.stop()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
