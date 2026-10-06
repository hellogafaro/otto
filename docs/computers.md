# Computers: where an agent runs commands

Plan: [harness-plan.md](harness-plan.md) (b) and (d) "The computer (H2)"; background in [agent-computers.md](agent-computers.md). Code: `packages/shared/src/computer/` (`@otto/shared/computer/...`). Image: `docker/otto-agent/`.

## The interface

`Computer` (`types.ts`) is `id`, `ensureRunning()`, `exec(argv, { cwd, env, user, stdin, signal }) -> Spawned`, optional `viewerUrl()`, `stop()`. `Spawned` is `{ stdin?, stdout, stderr, exited, kill }`; `collect(spawned)` returns `{ code, stdout, stderr }`.

- `LocalComputer` runs on the host through `Bun.spawn` (`user` is ignored). A binary that cannot start is a result (exit 127, message on stderr), not a throw.
- `DockerComputer` is one container per agent through the `docker` CLI, no SDK. `createComputer('local' | 'docker', opts)` picks one.

```ts
const box = createComputer('docker', { agentId, skillsDir: '/path/to/workspace/skills' })
await box.ensureRunning()
const { code, stdout } = await collect(box.exec(['bash', '-c', 'ls'], { cwd: await ensureChatDir(box, chatId) }))
```

## DockerComputer

| Thing | Value |
|---|---|
| Container, volume | `otto-agent-<agentId>`, `otto-agent-<agentId>-home` at `/home/agent` |
| Flags | `--user agent --init --cap-drop ALL --security-opt no-new-privileges --memory 2g --cpus 1 --pids-limit 512 --shm-size 1g`, default seccomp, egress open |
| Skills | `skillsDir` bind-mounted read-only at `/skills` |
| Ports | noVNC `6080` and CDP `9223` published as `127.0.0.1::<port>` (random free host port, loopback only); `hostPort(n)` reads it |
| `ensureRunning` | missing: `docker run -d`; stopped: `docker start`; then wait for the image healthcheck (60 s, fails on `unhealthy`). Once ready it does nothing until `stop()` or a death is seen |
| `exec` | `docker exec -i [-u user] [-w cwd] [-e K=V ...] <name> argv...`. Abort or `kill()` stops the client |
| Died under an exec | A non-zero exit is followed by one `docker inspect`. If the box is gone, stopped or has a new `StartedAt`, the exit code is `-1` and stderr ends with `computer restarted; the action may have run` (`COMPUTER_RESTARTED`). The next `ensureRunning` starts it again |
| Idle stop | `touch()` records activity (every exec, viewer attach/detach and `viewerUrl()` do it). `stopIfIdle(minutes, hasActiveRuns)` stops only if no run is active (the caller's flag), no exec is in flight, no viewer is attached (`attachViewer()` returns the detach function) and the window has passed. The server calls it on a timer, 15 minutes by default |
| Chat folders | `chatDir(chatId)` is `/home/agent/chats/<chatId>`; `docker exec -w` fails on a missing directory, so call `ensureChatDir` first |

Limits to know:
- Killing the `docker exec` client does not signal the process inside the box. A runaway command keeps running until it ends or the box stops. Long-running work belongs in tmux anyway; a wrapper that records and kills the inner pid is the fix if this bites.
- `-e K=V` shows values in the host's `ps` for the life of the call. Do not pass secrets that way; tokens never enter the box (MCP stays server-side).
- RAM state is lost on stop; `/home/agent` survives on the volume.

## Viewing the desktop (auth proxy, not built)

`viewerUrl()` returns `http://127.0.0.1:<port>/vnc.html?autoconnect=true&resize=scale`, bound to the server host's loopback. Never give it to a browser. The server must serve it behind its own auth proxy: a short-lived token per viewer tied to the user and the agent, proxy HTTP and the websockify WebSocket to that URL, call `attachViewer()` on connect and the returned function on disconnect. A human in noVNC always wins over the agent's desktop lock.

## Image

```sh
docker build -t otto-agent:latest docker/otto-agent
docker build --build-arg INSTALL_CLAUDE=true -t otto-agent:latest docker/otto-agent   # adds Claude Code (H3)
```

`node:22-bookworm-slim` plus Xvfb, Openbox, x11vnc, noVNC/websockify, Chromium, tmux, git, ripgrep, uv, `agent-browser` and a non-root `agent` (uid 1000) with `/home/agent/{files,chats}`, `/skills` and `~/.claude/skills -> /skills`.

`start.sh` is the entrypoint. Run with `--init` (DockerComputer does) so tini is PID 1, reaps zombies and forwards SIGTERM; `start.sh` traps SIGTERM/INT, stops its children and exits 0, and exits 1 if Xvfb, x11vnc or websockify die. It removes stale X locks and Chromium `Singleton*` files first (a stopped container keeps `/tmp`).

- Chromium: `--no-sandbox --disable-dev-shm-usage`, CDP on `127.0.0.1:9222`, profile on the volume (the agent's site logins), restarted if it crashes. `socat` exposes `9223` for Docker's port publishing. x11vnc listens on loopback only.
- File uploads: a session D-Bus (`dbus-launch`) with `xdg-desktop-portal` and `xdg-desktop-portal-gtk` running and `portals.conf` set to `gtk`, plus `GTK_USE_PORTAL=1`. Without them the file chooser in Chromium hangs or never opens (the common fix; rakazo's approach is not in this repo).
- The `otto` CLI is not in the image yet; add its layer when it exists.

## Several people on one computer (multiplayer table)

Implemented: `exec` takes `user` and `cwd`; `chatDir`/`ensureChatDir`. Everything else below is the rule, built when the phase that needs it lands.

- **Chats**: cwd is `/home/agent/chats/<chatId>`, shared work goes in `/home/agent/files`. Each `bash` call is its own process; long-running ones go in tmux session `<chatId>`. Cap at 4 concurrent runs per agent, the rest queue ("waiting for the computer").
- **Browser**: one Chromium and one profile per agent; each chat uses `agent-browser --session <chatId>`.
- **Desktop**: one per agent under a lock with a 2 minute idle lease, a human in noVNC wins.
- **Credentials and privacy (H3, Claude route)**: one Unix user per human, their `CLAUDE_CONFIG_DIR` mode 0700, runs exec as `-u <that user>`, chat dirs 0700 owned by the creator, `/home/agent/files` group-shared. Open conflict: `--cap-drop ALL` removes root's `CAP_CHOWN`, `CAP_SETUID` and `CAP_DAC_OVERRIDE`, so `docker exec -u root useradd` fails. Decide then: create users at `docker run` time, or add back only those capabilities for that one setup step.
- **Dies mid-turn**: see "Died under an exec" above; the Pi turn continues with that result.

## Not verified

Written without a Docker daemon on the build machine. Verified only against a fake `docker` script (flags, naming, states, abort, idle rules, error mapping). Not run for real: the image build (apt package names, `ghcr.io/astral-sh/uv:0.8` tag, `agent-browser` with the system Chromium, `userdel node`), `start.sh`, the healthcheck, the portal fix, port publishing and `docker port` parsing, a real container death mid-exec (exit codes), noVNC, memory and start times.

Rejected: Kasm (community edition is non-commercial, 5 sessions), Daytona (archived), gVisor until a Chromium smoke test passes.
