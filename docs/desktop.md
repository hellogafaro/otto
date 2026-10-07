# Desktop: the Electron app on a Bun server

Status (7 Oct 2026): **as built.** Electron's main process is a shell without a database; the server (`packages/server`) runs as its child process under Bun. Verified end to end under `xvfb-run` on Linux in dev mode (below). Packaging, auto-update, macOS and Windows are not verified.

## Why

Electron's main process runs Node, and the server is Bun-only: `bun:sqlite` (Drizzle), `Bun.file`/`Bun.write`, `Bun.hash`, `Bun.spawn`, `S3Client` from `bun`. Main used to embed the whole server (`bootstrapServer` in `apps/electron/src/main/index.ts`), so it stopped building once storage moved to SQLite (`8b599de`) and S3 (`7d0c2c6`).

## As built

**Main is a shell** (`apps/electron/src/main/index.ts`, `server-process.ts`). It starts the server child, then opens the windows:

- `initServer` spawns Bun with the server entry: `packages/server/src/index.ts` with `bun` (or `OTTO_BUN`) in dev, `dist/server.js` with the shipped `vendor/bun` when packaged. The child's environment is main's (the CLI tool paths, `OTTO_CONFIG_DIR`, `OTTO_APP_ROOT`, `OTTO_IS_PACKAGED`) plus `OTTO_LOCAL_USER=1`, a random per-launch `OTTO_SERVER_TOKEN` and `BETTER_AUTH_SECRET`, `OTTO_RPC_HOST=127.0.0.1`, `OTTO_RPC_PORT=0`, `OTTO_BUNDLED_ASSETS_ROOT` (main's `dist`), `OTTO_RESOURCES_PATH`, and the WhatsApp worker run by Electron as Node.
- `ENCRYPTION_KEY` comes from `encryption-key.ts` (safeStorage, or the environment in dev) into a variable in main and the child's environment only; main deletes it from its own environment (renderers inherit that) and never logs it. The child's `OTTO_SERVER_TOKEN=` echo is dropped from main's log.
- Ready = the child printed `OTTO_SERVER_URL=ws://127.0.0.1:<port>` and main's own WebSocket connection to it completed the handshake (60 s limit).
- Quit: SIGTERM (the server flushes its chats and exits), SIGKILL after 8 s. The child also stops when its stdin closes, so it does not outlive a killed main.
- A child that exits on its own shows an error window with the reason (exit code or signal) and its last log lines, with Restart (a new child; every window reloads onto it) or Quit. A child that does not start shows the same with Try again or Quit (for example a refused schema push or a bad `ENCRYPTION_KEY`).

**Main keeps a small `WsRpcServer`** (127.0.0.1, random port, its own per-launch token, no authorize and no database) for the 34 `LOCAL_ONLY` channels: windows, focus, traffic lights, system versions and appearance, `shell:openUrl` (OS browser and `otto://` links), update, badge, menu, deep links, notifications (`notification:show`), the power blocker and `debug:log` (`handlers/`). What those handlers store goes to the server over main's connection: `settings:getSetting` / `updateSetting` for `install` keys (`keepAwakeWhileRunning`, `dismissedUpdateVersion`), `preferences:read` / `write` for the menu language, `workspaces:get` for window restore and titles, `sessions:getUnreadSummary` and the `sessions:unreadSummaryChanged` push for the dock badge, and `server:statusChanged` (`{ runningChats }`, pushed by the server on every change) for keep-awake.

**The windows connect like the web UI.** The preload (`preload/bootstrap.ts`) opens a client to main (`__get-ws-port`, `__get-ws-token`) and one to the server (`__get-server`), and `RoutedClient` sends `LOCAL_ONLY` to main and everything else to the workspace's server: the child for every local workspace (`homeClient`), a remote server for a remote workspace. After a `window:switchWorkspace` the preload tells main (`__window:workspace`) so its window map (titles, window state, reloads) follows. No new mode; the thin client (`OTTO_SERVER_URL`) is unchanged and starts no child.

**Routing** (`packages/shared/src/protocol/routing.ts`): 40 channels the server answers moved from `LOCAL_ONLY` to `REMOTE_ELIGIBLE` (workspaces, the window's workspace, file and folder dialogs and `file:readUserAttachment`, `auth:showDeleteSessionConfirmation`, `shell:openFile` / `showInFolder`, skills' editor and finder, app theme and presets and their pushes, notification and input and appearance preferences, `power:getKeepAwake`, Git Bash, onboarding), plus `transcription:create` and the new `workspaces:remove`. `registration.test.ts` checks that main answers only `LOCAL_ONLY` channels and that no `LOCAL_ONLY` channel is answered by the server alone.

**The server at boot** (`packages/server/src/index.ts`):

- Schema: every boot calls `pushSchema(initDb())` before anything reads the database. `pushSchema` takes the statically imported `SCHEMAS` list (`db/push.ts`; `push.test.ts` fails when a `schema.ts` is missing from it) instead of globbing source files, so it works in a bundle, and it still refuses a change that loses data (the server exits; `bun run db:push --force` decides). `bun run dev` no longer runs `db:push` first.
- The local user: with `OTTO_LOCAL_USER=1` the server makes the install's one user once (`initLocalUser`, name "You", `local@localhost`) before anything asks who the token is. The server token acts as the first user, so on the desktop it is that person, the owner of every workspace and the instance owner, and there is no sign-in. Without the flag (the web server) nothing changes: the first sign-up (or `OTTO_OWNER_EMAIL`) owns it. The same flag lets `workspaces:create` take any folder (one person, their own disk); every other server creates under `CONFIG_DIR/workspaces`.
- Also new for every server: the Pi model resolver, the default permission rules (`ensureDefaultPermissions`) and the PowerShell validator root, which only the old in-process desktop set up.

**Build** (`scripts/electron-build-main.ts`): `electron:build:main` bundles main with only `electron` external and fails when `main.cjs` requires `bun:` (main reached server code); it bundles the server into `dist/server.js` with esbuild (ESM, run by Bun; `bun build` mis-converts the CommonJS `tmp` package under markitdown-js). `drizzle-orm` and `drizzle-kit` stay outside it (drizzle-kit's push breaks when bundled: its lazily initialised dialects), so `electron-builder.yml` ships them and sharp's `@img` binaries under `app/node_modules`. `build-win.ps1` now calls `electron:build:main` instead of its own esbuild line.

## Removed

- From main: the in-process server (`bootstrapServer`, `SessionManager`, the core handlers, the importers at boot, messaging, model refresh, the credential health check, Sentry config tags, the Git Bash path restore, `releaseServerLock`, `OTTO_HEADLESS`), `platform.ts`, `runtime/`, the messaging log, the grammY shims and the `claude-agent-sdk` external, the duplicate core system handlers (`registerSystemCoreHandlers`) and their test, `workspace:remove` IPC (now `workspaces:remove` on the server, owners only).
- Server mode (Settings > Server: the desktop as a server for other machines, behind the off-by-default `embeddedServer` flag): the page, its three channels, the `server` setting and its secret import, `server-config.ts`, the flag, the catalogue's `sensitive` marker (only `server` had it), its locale strings. Local installs have no remote features (data-architecture.md, deployment modes).
- From server-core: `windowManager` and `browserPaneManager` in `HandlerDeps` and the `IWindowManager` interface (no host passes them now), `SessionManager.setBrowserPaneManager`, `setSessionPathResolver` (main computes a chat's downloads folder from the workspace root), `clearActiveViewingSession`, `setFileInputFiles` and the in-process `uploadFile`.
- The in-app browser pane (owner decision: the agent's browser is a server-side Fortress instance): `BrowserPaneManager`, `browser-cdp.ts`, the toolbar and empty-state pages and their preload, the `browserPane` channels, the tab strip and status bar, the remote `client:browser:invoke` capability with `RemoteBrowserPaneManager`, the agent-control overlay and the `allowRemoteEvaluate` setting.
- Dead scripts: root `electron:dev:menu`, `electron:dev:logs`, `sync-secrets`, `fresh-start`, `fresh-start:token`, `build`, `release`, `check-version`, `oss:sync` (their files were gone); in `apps/electron` `build`, `build:win`, `start`, `start:win`, `build:validate` and the `build:*` steps only they ran; the debug menu's "Reset to Defaults" (it pointed at `fresh-start`).

## Verified

Dev mode under `xvfb-run` with `OTTO_CONFIG_DIR=/tmp/desktop-home`: first launch makes the encryption key, pushes 54 statements, makes the local user, opens first-run setup; creating a workspace, the owner's provider step, a chat (message stored, the expected "Connect Anthropic" error without a provider), Settings (notification and keep-awake toggles round-trip through the server); a relaunch restores the window; quit stops the child; killing the child shows the error window and Restart reconnects the window; killing main stops the child; a bad `ENCRYPTION_KEY` shows the start error and Quit exits. `dist/server.js` boots outside the repo with only `node_modules/drizzle-orm` and `drizzle-kit` beside it. The key never appears in the logs.

## Not verified, and known limits

- Packaging (`electron-builder` output, `vendor/bun`, the shipped `node_modules`, sharp's native binaries, the Claude Agent SDK resolving its files from inside the bundle), auto-update, macOS, Windows.
- A remote workspace (cut from the MVP, still wired): its window now gets the 40 moved channels from the remote server (its workspace list, preferences, onboarding), and `file:readUserAttachment` with local paths fails there.
- Turning notifications on no longer shows the confirmation notification (the setting is the server's now).
- The server no longer clears a workspace's "viewing" chat when the last window leaves it (it has no windows).
- `drizzle-kit` prints a spinner on each boot push; main strips the escapes from its log.
