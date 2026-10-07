#!/usr/bin/env bash
# =============================================================================
# Smoke test for the agent's computer (docker/otto-agent, docs/computers.md).
#
# Run from the repository root on a machine with Docker (and Bun):
#   bash scripts/docker-smoke-test.sh            # builds otto-agent:smoke, then tests it
#   SKIP_BUILD=1 bash scripts/docker-smoke-test.sh otto-agent:latest
#
# It drives the box through Otto's own code (DockerComputer, the agent browser), not through hand-written docker
# flags, and checks:
#   1. the image builds (Fortress downloaded and checksummed, no stock Chromium, the otto CLI on Bun)
#   2. DockerComputer starts it (hardened flags, healthcheck) and `echo` runs as the non-root agent user
#   3. the browser: a page opened in this chat's Fortress context over the published CDP port, a PNG screenshot
#   4. the otto CLI inside the box reaches a server on the host through host.docker.internal (a stub server that
#      checks the run token; the real endpoint is tested by agent-rpc.isolated.ts)
#   5. noVNC answers on its loopback port, the file-picker portal runs
#   6. the box is killed in the middle of a bash command: the command ends with "computer restarted; the action may
#      have run" (exit -1), and the next ensureRunning brings it back
#   7. docker stop (SIGTERM) ends start.sh cleanly (exit code 0)
# Leaves nothing behind (container and volume removed). The screenshot stays in $OUT for you to look at.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${1:-otto-agent:smoke}"
AGENT_ID="smoke$(date +%s)"
OUT="${OUT:-$(mktemp -d)}"

command -v docker >/dev/null || { echo "docker is not installed" >&2; exit 1; }
command -v bun >/dev/null || { echo "bun is not installed" >&2; exit 1; }

cleanup() {
  docker rm -f "otto-agent-$AGENT_ID" >/dev/null 2>&1 || true
  docker volume rm "otto-agent-$AGENT_ID-home" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if [ -z "${SKIP_BUILD:-}" ]; then
  echo "=== [1/7] Building $IMAGE ==="
  docker build --build-context otto-resources="$ROOT/apps/electron/resources" -t "$IMAGE" "$ROOT/docker/otto-agent"
fi

cat > "$OUT/smoke.ts" <<TS
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DockerComputer, CDP_PORT, NOVNC_PORT, COMPUTER_RESTARTED, collect, ensureChatDir } from '$ROOT/packages/shared/src/computer/index.ts'
import { AgentBrowser, runBrowserCommand } from '$ROOT/packages/shared/src/browser/index.ts'

/** Runs a host command to completion. */
const sh = async (argv: string[]) => {
  const p = Bun.spawn(argv, { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  return { code, stdout, stderr }
}
const step = (n: number, what: string) => console.log(\`=== [\${n}/7] \${what} ===\`)
const check = (ok: unknown, what: string) => { if (!ok) { console.error(\`FAIL: \${what}\`); process.exit(1) } console.log(\`  ok: \${what}\`) }

const skills = mkdtempSync(join(tmpdir(), 'otto-smoke-skills-'))
writeFileSync(join(skills, 'README.md'), 'skills mount')
const box = new DockerComputer({ agentId: '$AGENT_ID', image: '$IMAGE', skillsDir: skills, readyTimeoutMs: 120_000 })

step(2, 'start the box and run echo')
const started = Date.now()
await box.ensureRunning()
console.log(\`  started in \${Date.now() - started} ms\`)
const cwd = await ensureChatDir(box, 'chat00smoke1')
const echo = await collect(box.exec(['bash', '-c', 'echo hello; id -u; pwd; cat /skills/README.md'], { cwd }))
check(echo.code === 0 && echo.stdout === \`hello\\n1000\\n\${cwd}\\nskills mount\`, \`echo as uid 1000 in \${cwd} with /skills mounted (got \${JSON.stringify(echo)})\`)
const tools = await collect(box.exec(['bash', '-c', 'command -v chromium chromium-browser google-chrome || true; /opt/fortress/chrome --version; bun --version; command -v otto tmux git uv rg agent-browser']))
check(!/chromium|google-chrome/.test(tools.stdout.split('\\n')[0] ?? ''), 'no stock Chromium on the PATH')
check(/Chromium 15\\d/.test(tools.stdout), \`Fortress: \${tools.stdout.split('\\n').find((l) => l.includes('Chromium'))}\`)
check(tools.stdout.includes('/usr/local/bin/otto') && tools.stdout.includes('tmux') && tools.stdout.includes('uv'), 'otto, tmux, git, uv, rg, agent-browser on the PATH')

step(3, 'browser: a page and a screenshot through the published CDP port')
const cdpPort = await box.hostPort(CDP_PORT)
check(cdpPort, \`CDP published on 127.0.0.1:\${cdpPort}\`)
const browser = new AgentBrowser(async () => \`http://127.0.0.1:\${cdpPort}\`)
const ctx = { page: () => browser.page('chat00smoke1'), close: () => browser.close('chat00smoke1') }
const nav = await runBrowserCommand(['navigate', 'data:text/html,<title>Otto smoke</title><h1>Fortress in the box</h1>'], ctx)
check(nav.output.includes('Otto smoke'), 'navigate')
check((await runBrowserCommand('snapshot', ctx)).output.includes('Fortress in the box'), 'snapshot')
const shot = await runBrowserCommand('screenshot', ctx)
check(shot.screenshot?.subarray(1, 4).toString() === 'PNG', 'screenshot is a PNG')
writeFileSync('$OUT/screenshot.png', shot.screenshot!)
const ua = (await runBrowserCommand('evaluate navigator.userAgent', ctx)).output
check(!ua.includes('Headless'), \`user agent: \${ua}\`)
browser.dispose()

step(4, 'the otto CLI in the box reaches the host')
const token = 'smoke.' + crypto.randomUUID()
const host = process.platform === 'linux'
  ? ((await sh(['docker', 'network', 'inspect', 'bridge', '-f', '{{(index .IPAM.Config 0).Gateway}}'])).stdout.trim() || '172.17.0.1')
  : '127.0.0.1'
let seen: unknown = null
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    seen = { path: req.url, auth: req.headers.authorization === \`Bearer \${token}\`, body: JSON.parse(body || '{}') }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ result: 'pong' }))
  })
})
await new Promise<void>((resolve) => server.listen(0, host, () => resolve()))
const port = (server.address() as { port: number }).port
const cli = await collect(box.exec(['otto', 'tasks', 'list'], { env: { OTTO_API_URL: \`http://host.docker.internal:\${port}\`, OTTO_RUN_TOKEN: token } }))
server.close()
check(cli.code === 0 && cli.stdout.trim() === 'pong', \`otto tasks list -> \${JSON.stringify(cli)}\`)
check(JSON.stringify(seen) === JSON.stringify({ path: '/api/agent/rpc', auth: true, body: { argv: ['tasks', 'list'] } }), 'the server got the argv with the run token')
const noToken = await collect(box.exec(['otto', 'tasks', 'list']))
check(noToken.code === 2, 'without a token the CLI refuses (exit 2)')

step(5, 'noVNC and the file-picker portal')
const vnc = await box.viewerUrl()
check(vnc && (await fetch(vnc)).ok, \`noVNC answers on \${vnc}\`)
const procs = await collect(box.exec(['bash', '-c', 'pgrep -f xdg-desktop-portal-gtk >/dev/null && pgrep -x openbox >/dev/null && echo up']))
check(procs.stdout.trim() === 'up', 'portal and window manager running')

step(6, 'kill the box in the middle of a bash command')
const running = box.exec(['bash', '-c', 'echo started; sleep 30; echo late'])
await Bun.sleep(2000)
await sh(['docker', 'kill', box.name])
const died = await collect(running)
check(died.code === -1 && died.stderr.includes(COMPUTER_RESTARTED) && !died.stdout.includes('late'), \`the command ends with "\${COMPUTER_RESTARTED}" (got \${JSON.stringify(died)})\`)
await box.ensureRunning()
check((await collect(box.exec(['echo', 'back']))).stdout === 'back\\n', 'the next call starts the box again')

step(7, 'docker stop ends start.sh cleanly')
await box.stop()
const exit = await sh(['docker', 'inspect', '-f', '{{.State.ExitCode}}', box.name])
check(exit.stdout.trim() === '0', \`exit code \${exit.stdout.trim()}\`)
console.log('=== Smoke test passed ===')
process.exit(0)
TS

bun "$OUT/smoke.ts"
echo "Screenshot: $OUT/screenshot.png"
