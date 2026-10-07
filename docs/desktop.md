# Desktop: the Electron app on a Bun server

Status (7 Oct 2026): **the desktop app does not build or boot.** This page records why and the plan to fix it. The web/server mode is unaffected.

## What fails

- `bun run electron:build:main` stops in esbuild: `Could not resolve "bun:sqlite"` (`packages/shared/src/db/index.ts`, `drizzle-orm/bun-sqlite`) and `Could not resolve "bun"` (`packages/shared/src/library/s3-file-store.ts`). Preload, renderer, resources and assets build.
- Marking `bun:sqlite` and `bun` external makes the bundle build, but Electron then dies on load with `Cannot find module 'bun:sqlite'` (seen under `xvfb-run`). So externals are not a fix.
- It broke when storage moved to SQLite (`8b599de`, 5 Oct: secrets domain, one SQLite db) and the S3 store (`7d0c2c6`, 6 Oct). Testing since then has been web/server only.

## Why

Electron's main process runs Node, and the main process **embeds the whole server**: `apps/electron/src/main/index.ts` calls `bootstrapServer` in-process with `SessionManager`, the core RPC handlers, messaging and model refresh. The server code is Bun-only, beyond the driver: `Bun.file`/`Bun.write` (`library/file-store.ts`), `Bun.hash` (`sessions/persistence-queue.ts`), `Bun.spawn` (`computer/local.ts`, `computer/docker.ts`), `Glob` from `bun` (`db/push.ts`), `S3Client` from `bun`. A Node SQLite driver alone would not make it run under Electron.

Even the thin shell pieces of main reach the database through barrels: `window-manager.ts`, `browser-pane-manager.ts`, `auto-update.ts` and `handlers/system.ts` import `@otto/shared/config` (`config/index.ts` -> `preferences.ts` -> `db/index.ts`), and `config/storage.ts` itself reaches it through `credentials` -> `decisions/keys.ts`. `@otto/server-core/transport` (`WsRpcServer`) is free of it.

## The design

The decision on record is "the macOS app embeds the server" (data-architecture.md, deployment modes) and "Drizzle on `bun:sqlite`". Embedding becomes **a child process**: main is a shell that starts the same headless server (`packages/server/src/index.ts`) under Bun and points the windows at it.

- Main picks a free `127.0.0.1` port and a random token, and spawns Bun with `OTTO_CONFIG_DIR`, `ENCRYPTION_KEY` (already resolved from `safeStorage` into `process.env` by `encryption-key.ts`), `BETTER_AUTH_SECRET` (random per launch, as today), `OTTO_SERVER_TOKEN`, `OTTO_RPC_HOST=127.0.0.1`, `OTTO_RPC_PORT`, `OTTO_BUNDLED_ASSETS_ROOT`. It waits until the port accepts a WS connection, then opens windows. On quit it sends SIGTERM (the server flushes chats and exits) and kills after a timeout. A server that exits early shows an error dialog with the last log lines.
- The server runs under the Bun the app already ships (`vendor/bun`, electron-builder.yml) from a `bun build --target bun` bundle, like `pi-agent-server`. Dev runs `bun packages/server/src/index.ts`.
- Main keeps a small `WsRpcServer` (no database) for what needs Electron: windows, dialogs, shell, badge, menu, deep links, notifications, update, browser panes, Git Bash. The preload already has the routing: `RoutedClient` sends `LOCAL_ONLY` channels to main and the rest to the workspace's server, and `__get-workspace-remote-config` can return the child as every local workspace's server (`{ url, token, remoteWorkspaceId: id }`), so the preload needs no new mode.
- The server serves 44 of the 96 `LOCAL_ONLY` channels today (workspaces, theme, input, power, appearance, onboarding, system info, shell guards, file dialog relay). They move to `REMOTE_ELIGIBLE`, which is where the web UI already gets them; main keeps the 51 it serves itself. Browser panes already work across the process line: the server asks the window through `CLIENT_BROWSER_INVOKE` ("remote browser bridge is now available" at boot).

## Steps and sizes

| # | Change | Files | Size |
|---|---|---|---|
| 1 | Server entry: `OTTO_LOCAL_USER=1` makes the one local user before boot (`initLocalUser`, as main does today), so the token acts as someone; otherwise the first-sign-up rule applies | `packages/server/src/index.ts` | S |
| 2 | Schema at first launch: the packaged app has no `bun run db:push` (it globs `schema.ts` sources and needs `drizzle-kit`). Push at server boot from a statically imported schema list, refusing data loss as today | `packages/shared/src/db/push.ts`, server entry | M |
| 3 | `server-process.ts` in main: port, token, env, spawn, readiness wait, SIGTERM then kill, crash dialog | new file, about 100 lines | S |
| 4 | `index.ts`: delete the in-process server (about 530 lines: `bootstrapServer`, imports at boot, messaging, model refresh, credential health check, server-config handlers, `session:transferToWorkspace` local path, `releaseServerLock`), start the child and the GUI `WsRpcServer` instead | `apps/electron/src/main/index.ts` | L |
| 5 | Shell modules stop importing the database: workspace lookups, theme, `allowRemoteEvaluate`, update settings, keep-awake, UI language and the Git Bash path come from the server over RPC or move to the server's handlers; `handlers/system.ts` badge refresh goes through the server | `window-manager.ts`, `browser-pane-manager.ts`, `auto-update.ts`, `power-manager.ts`, `handlers/system.ts` | M |
| 6 | Routing: 44 channels from `LOCAL_ONLY` to `REMOTE_ELIGIBLE`, exhaustiveness test kept | `packages/shared/src/protocol/routing.ts` and its test | S |
| 7 | Build: bundle the server into `apps/electron/dist/server.js`, ship it, fail the main build if the bundle has a `bun:` import | `scripts/electron-build-main.ts`, `scripts/electron-dev.ts`, `electron-builder.yml` | S |
| 8 | Tests: GUI handler registration without a `SessionManager`; `authorize.isolated.ts` registers core handlers from the server side | `apps/electron/src/main/handlers/__tests__/` | S |

Total: L, about one to two days, touching main, the server entry, `db/push.ts`, the routing table, the build and packaging. Order: 1, 2 and 3 first give a child server that boots from a fresh config dir; 4 to 6 make the app open against it; 7 and 8 close the build and tests.

## Verified so far

- The headless server boots from an empty `OTTO_CONFIG_DIR` after `bun run db:push`, listens on a random port with `OTTO_RPC_PORT=0` and shuts down cleanly on SIGTERM.
- Electron 39 starts under `xvfb-run` here, so step 4 can be checked end to end on this machine.
