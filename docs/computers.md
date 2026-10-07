# Computers: where an agent runs commands and browses

Plan: [final-plan](final-plan.md) 2.5, phases C1 and C2; background in [harness-plan](harness-plan.md) "The computer (H2)" and [agent-computers](agent-computers.md). Code: `packages/shared/src/computer/` (`@otto/shared/computer`), `packages/shared/src/browser/` (`@otto/shared/browser`). Image: `docker/otto-agent/`. Built 7 Oct 2026, not committed.

## Modes

`OTTO_COMPUTER` on the server:

| Value | Built-in tools (read, write, edit, bash, ls) | Browser (`browser_tool`) |
|---|---|---|
| `local` or unset (default) | On the server host, host paths, as before | Fortress on the server host: `OTTO_FORTRESS_PATH`, else `fortress` on the PATH; missing = the error "Fortress is not installed" with install help |
| `docker` | In the agent's box (one container per agent), box paths | Fortress in the box, driven over its published CDP port |

Agents only ever get Fortress: there is no fallback to a stock Chromium or to the desktop app's windows (the Electron browser pane is deleted).

## The interface

`Computer` (`types.ts`) is `id`, `ensureRunning()`, `exec(argv, { cwd, env, user, stdin, signal }) -> Spawned`, optional `viewerUrl()`, `stop()`. `Spawned` is `{ stdin?, stdout, stderr, exited, kill }`; `collect(spawned)` returns `{ code, stdout, stderr }`. `DockerComputer` is the one implementation; the tests use `DirComputer` (`computer/__tests__/dir-computer.ts`), a temp folder playing the box's root with box paths rewritten.

## Paths (C1)

`paths.ts`, pure and tested (`createPathMap`):

| In the box | On the server | How |
|---|---|---|
| `/home/agent` | the agent's volume `otto-agent-<agent_id>-home` | the box's own; kept across stops |
| `/home/agent/chats/<chat_id>` | the chat's folder `<workspace>/sessions/<chat_id>` | the chat's working folder (created at the turn's first tool call); the two mirror each other only for files the server moves |
| `/home/agent/chats/<chat_id>/attachments/<name>` | the attachment's library file | copied in at the turn's first tool call |
| `/home/agent/chats/<chat_id>/downloads/<file>.png` | the same path under the chat's folder | browser screenshots: saved on the server (the UI shows them) and copied into the box (the agent reads them) |
| `/skills` | the workspace's skills folder | bind mount, read-only |
| `/sources` | the workspace's sources folder (each source's `guide.md` and config; secrets are not there) | bind mount, read-only |
| `/otto/docs` | `CONFIG_DIR/docs` (the guides the prompt names, the `otto` skill) | bind mount, read-only |
| `/home/agent/files` | none | shared by the agent's chats, on the volume |

What uses the map on a box turn (`PiAgent`):
- The prompt: every server folder it names (working folder, skills, sources, docs, also spelled `~/.otto/docs`) becomes its box path (`textToBox`); Pi's `<cwd>` is the box folder (`prompt.computer.cwd`, set per turn by the turn-prompt extension); skills are `/skills/<slug>/SKILL.md`, the `otto` skill `/otto/docs/otto.md`.
- Pi's tools (`pi-agent-server/src/computer-tools.ts`): built for the box folder, with it as their context's cwd and `~` as `/home/agent`; grep and find say "use bash".
- Permission checks: the plans and data folders and the working folder are given as box paths; a block reason is rewritten to box paths.
- What people see: a tool's `path`/`file_path` is shown as the server path it maps to (so the chat's own files read as relative paths, as on the host).
- Session tools that need a file on the server (`SubmitPlan`'s plan, `call_llm`/`spawn_session` attachments): the file is copied out of the box to its mapped server path (or the chat's `computer/` folder) first.

Limits: a file the agent writes in the box exists on the server only when something copies it out (the cases above); the UI cannot open other box files. Library items are reached with `otto library ...`, not mounted. Bind mounts need the server's files readable by uid 1000 in the box (the default single-user Linux and Docker Desktop setups are).

## The `otto` CLI in the box

`/usr/local/bin/otto` runs `/opt/otto/otto.mjs` (copied from `apps/electron/resources/scripts/otto.mjs` at build time) on Bun. Each turn on a box gets its own run token (`createRunToken(..., { computer: true })`); `OTTO_API_URL` and `OTTO_RUN_TOKEN` reach only that turn's bash calls (`computer_exec.env`), and `DockerComputer.exec` passes them as `-e NAME` with the value in the docker client's environment, so they never show in the host's process list.

`OTTO_API_URL` for boxes is the computer API (`server-core/src/webui/computer-api.ts`), opened when `OTTO_COMPUTER=docker`:
- `OTTO_COMPUTER_API_URL` set: used as is, no listener.
- else a listener that serves `/api/agent/rpc` only, on `OTTO_COMPUTER_API_HOST` (default: the Docker bridge gateway on Linux, read with `docker network inspect bridge`, else `172.17.0.1`; `127.0.0.1` on macOS and Windows), on a free port. Boxes reach it as `http://host.docker.internal:<port>` (`--add-host host.docker.internal:host-gateway`). It fails soft: no address = box turns get no CLI, logged.

## Browser

`browser/`: `cdp.ts` (a small CDP client), `page.ts` (accessibility snapshot with `@eN` refs and actions, ported from the deleted pane's `BrowserCDP`), `fortress.ts` (find and launch Fortress on the host), `agent-browser.ts` (`getAgentBrowser(agentId, computer)`), `tool.ts` (`browser_tool`'s commands). `PiAgent.runBrowserTool` runs it.

- One Fortress per agent: in the box `start.sh` runs it on the screen (`:99`), CDP on the box's `127.0.0.1:9222`, `socat` on `9223` for Docker's publishing (`127.0.0.1::9223` on the host); on the host `launchFortress` runs it headless with `--remote-debugging-port=0` and reads `DevToolsActivePort`. The profile (site logins, Fortress's identity seed) is the agent's: `/home/agent/.config/otto-fortress`, or `CONFIG_DIR/agents/<id>/fortress-profile` on the host.
- Each chat gets its own browser context and page (`Target.createBrowserContext`, `newWindow`): parallel chats never share tabs or cookies. Limit: a chat context does not see the profile's cookies, so "the agent's site logins" are per chat until a chat signs in.
- Commands: `navigate`/`open`, `snapshot`, `find`, `click`, `click-at`, `fill`, `type`, `select`, `key`, `scroll`, `back`, `forward`, `wait`, `evaluate`, `screenshot [--full]`, `close` (guide: `apps/electron/resources/docs/browser-tools.md`, read before the first call). Dropped with the pane: windows, focus, hide, release, the overlay, drag, clipboard, upload, console, network, downloads, window-resize, annotated and region screenshots.
- The browser connection dropping during a call on a box returns `computer restarted; the action may have run`; the next call reconnects (the chat gets a fresh context).

## DockerComputer

| Thing | Value |
|---|---|
| Container, volume | `otto-agent-<agentId>`, `otto-agent-<agentId>-home` at `/home/agent`; labels `otto.agent`, `otto.workspace` |
| Flags | `--user agent --init --cap-drop ALL --security-opt no-new-privileges --memory 2g --cpus 1 --pids-limit 512 --shm-size 1g`, default seccomp, egress open, `--add-host host.docker.internal:host-gateway` |
| Mounts | skills at `/skills:ro`, sources at `/sources:ro`, docs at `/otto/docs:ro` |
| Ports | noVNC `6080` and CDP `9223` published as `127.0.0.1::<port>` (random free host port, loopback only); `hostPort(n)` reads it |
| Image | `otto-agent:latest`, or `OTTO_COMPUTER_IMAGE` |
| `ensureRunning` | missing: `docker run -d`; stopped: `docker start`; then wait for the image healthcheck (60 s, fails on `unhealthy`) |
| `exec` | `docker exec -i [-u user] [-w cwd] [-e NAME ...] <name> argv...`. Abort or `kill()` stops the client |
| Died under an exec | A non-zero exit is followed by one `docker inspect`. If the box is gone, stopped or has a new `StartedAt`, the exit code is `-1` and stderr ends with `computer restarted; the action may have run`. The next `ensureRunning` starts it again |
| Idle stop | `stopIfIdle(minutes, hasActiveRuns)` stops only with no turn using the box, no exec in flight, no viewer attached and the window passed; the server runs `runComputerIdleStop` every minute (15 minutes, `OTTO_COMPUTER_IDLE_MINUTES`) |

Limits: killing the `docker exec` client does not signal the process inside (long work belongs in tmux; a pid-recording wrapper is the fix if it bites). RAM state is lost on stop; the volume survives.

## Sharing one computer (C2)

`lifecycle.ts`, in memory per computer:
- **Run cap**: at most 4 turns use a box at once (`ComputerRuns`); the fifth shows the status "Waiting for the computer" and starts when a slot frees, in order; Stop while waiting leaves the queue. Idle stop counts waiting turns too.
- **Desktop lease** (`DesktopLease`): before a browser action that changes the page, the chat takes the screen if it is free, already its own, or idle for 2 minutes, and its window is brought to the front; otherwise it works in the background. While a person watches through the viewer no chat takes it.
- **Not built**: one Unix user per human (D3, private chat folders); chats of one agent can read each other's folders in the box.

## Viewing the desktop

`agents:screenUrl(agentId)` (RPC, any member of the agent's workspace; starts the box when stopped) returns a one-time link `/api/computer/<agentId>/screen?token=...` (60 s), plus the same on the server's own address for a client the server does not serve (desktop). Opening it trades the token for an HttpOnly, SameSite=Strict cookie scoped to that agent's screen path (8 h) and redirects to noVNC's page; its files and its WebSocket (`.../screen/websockify`) are proxied to the box's loopback noVNC with the cookie checked on each request (`server-core/src/webui/computer-screen.ts`, `WsRpcServer` `upgradeHandler`). An open viewer counts for idle stop and wins the desktop lease. Settings › Agents › an agent › Computer › Screen › Open.

## Image

```sh
docker build --build-context otto-resources=apps/electron/resources -t otto-agent:latest docker/otto-agent
bash scripts/docker-smoke-test.sh     # build + the checks below, on a machine with Docker and Bun
```

`node:22-bookworm-slim` plus Xvfb, Openbox, x11vnc, noVNC/websockify, Fortress (`/opt/fortress`), its libraries, tmux, git, ripgrep, uv, Bun, the `otto` CLI, `agent-browser` (for scripts in the box, `--cdp 9222` onto the same Fortress; `AGENT_BROWSER_EXECUTABLE_PATH` points at Fortress) and a non-root `agent` (uid 1000) with `/home/agent/{files,chats}`, `/skills`, `/sources` and `/otto/docs`. No `claude` (pi-only-plan).

- **Fortress**: `v153.0.8010.36`, `fortress-v153-linux-{x64,arm64}.tar.gz` from github.com/tiliondev/fortress releases (280 MB / 252 MB packed, about 774 MB extracted), checked against the release's `SHA256SUMS` (pinned as build args). The build fails when the download or the checksum fails, and when a stock Chromium is on the PATH. It runs through its `tilion` launcher (`TILION_NO_ACTIVATE=1`).
- `start.sh` is the entrypoint. Run with `--init` (DockerComputer does) so tini is PID 1, reaps zombies and forwards SIGTERM; `start.sh` traps SIGTERM/INT, stops its children and exits 0, and exits 1 if Xvfb, x11vnc or websockify die. It removes stale X locks and the profile's `Singleton*` files first, restarts Fortress if it crashes, and runs it with `--no-sandbox --disable-dev-shm-usage` and the backgrounding flags off (a covered window keeps rendering).
- File uploads: a session D-Bus with `xdg-desktop-portal` and `xdg-desktop-portal-gtk`, `portals.conf` set to `gtk`, `GTK_USE_PORTAL=1`.

## Fortress: facts and cautions

Read from the repository, its releases and PyPI on 7 Oct 2026, and run on this machine:
- **License: not BSD-3 any more.** Releases from v3 are under the "Fortress Source Available License 1.1" (Tilion Inc.): free in production only for individuals and organisations under US$500k funding and US$300k ARR; everyone else needs a subscription. The old BSD terms stay in `LICENSE-BSD-LEGACY`. The PyPI `tilion-fortress` metadata still says BSD-3; `tilion` says proprietary. **Decide before shipping.**
- **License key**: without `TILION_LICENSE_KEY` (or `tilion activate`) it runs in "v1 (public first-gen) mode": the per-launch persona system is off. The image passes no key.
- **Network calls**: its launcher asks `ipapi.co`/`ipinfo.io` for the egress IP's country and timezone at each start unless `TILION_NO_GEO=1` or `TILION_COUNTRY`/`TILION_TZ` are set (left on: it is the stealth feature).
- **CDP over TCP**: the launcher notes that a TCP debugging port is detectable by a third party and prefers `--remote-debugging-pipe`; Otto uses TCP on loopback (published on the host's loopback only) because the server drives a browser in another container.
- PyPI: `tilion-fortress` downloads the browser (`tilion get`, cache `~/.cache/tillion-fortress/`); `tilion` (0.1.16, mostly compiled `.pyc`) adds a fetch/crawl framework and an MCP server (`tilion-mcp`, extra `[mcp]`). Neither is used. Docker Hub has `tilion/fortress` (amd64 only), not used.

## Verified and not verified

Verified here, without a Docker daemon: the path map, `DirComputer`, the fake-docker `DockerComputer` tests (flags, mounts, `-e NAME`, death, idle), the run cap and the lease, the screen route against a fake noVNC (HTTP and WebSocket), the computer API listener, `browser_tool` against a real Fortress (headless, and the box's exact launch line headed on Xvfb), and one whole Pi turn (`server-core/src/webui/computer-turn.isolated.ts`): the real `PiAgent` and `pi-agent-server`, a scripted model, `DirComputer` as the box, bash and files in `/home/agent/chats/<id>`, `/skills` and `/otto/docs`, the real `otto` CLI against a real server, Fortress navigate and screenshot copied into the box and read back as an image, and the box killed mid-bash.

Not verified (needs Docker: run `scripts/docker-smoke-test.sh`): the image build (apt package names, the `oven/bun:1.4.2-slim` and `ghcr.io/astral-sh/uv:0.8` tags, the `--build-context`, `agent-browser` install, `userdel node`), `start.sh` in a container, the healthcheck, the portal fix, port publishing, `host-gateway` from a box to the computer API (Linux bridge address, Docker Desktop loopback), the `-e NAME` env passing, a real container death mid-exec, noVNC through the proxy in a real browser, Fortress's Xvfb window and screen size in the box, memory and start times. The Open screen button was typechecked, not looked at in a browser.

Rejected: Kasm (community edition is non-commercial, 5 sessions), Daytona (archived), gVisor until a Chromium smoke test passes.
