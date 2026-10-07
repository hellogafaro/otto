/**
 * Fortress on the server host: the agents' browser when they have no box (`OTTO_COMPUTER=local`). Fortress is a
 * stealth Chromium fork (github.com/tiliondev/fortress); it is the only browser agents get, so a missing Fortress
 * is an error with install help, never a fallback to another Chromium.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const FORTRESS_RELEASES = 'https://github.com/tiliondev/fortress/releases'

export const FORTRESS_INSTALL_HELP = [
  'Fortress is not installed, and agents browse only with Fortress.',
  `Install it on the server: download fortress-<version>-linux-x64.tar.gz (or -linux-arm64, -mac-arm64) from ${FORTRESS_RELEASES},`,
  'extract it, then either set OTTO_FORTRESS_PATH to the extracted `tilion` launcher (for example',
  '/opt/fortress-v153/tilion) or link it as `fortress` on the PATH (ln -s /opt/fortress-v153/tilion /usr/local/bin/fortress).',
  'Restart the server afterwards. With OTTO_COMPUTER=docker the browser runs in the agent\'s computer instead.',
].join('\n')

export class FortressNotInstalledError extends Error {
  constructor() {
    super(FORTRESS_INSTALL_HELP)
  }
}

/** `OTTO_FORTRESS_PATH`, else `fortress` on the PATH; null when neither is there. */
export function findFortress(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.OTTO_FORTRESS_PATH?.trim()
  if (configured) {
    try {
      return statSync(configured).isFile() ? configured : null
    } catch {
      return null
    }
  }
  return Bun.which('fortress', { PATH: env.PATH ?? '' })
}

export interface LocalFortress {
  /** `http://127.0.0.1:<port>`: the CDP HTTP endpoint (loopback only). */
  httpUrl: string
  stop(): void
}

/**
 * Starts Fortress headless with CDP on a free loopback port and the agent's own profile (its site logins and the
 * Fortress identity seed live there). Resolves once the port file appears.
 */
export async function launchFortress(o: { binary: string; profileDir: string; timeoutMs?: number; env?: NodeJS.ProcessEnv }): Promise<LocalFortress> {
  mkdirSync(o.profileDir, { recursive: true })
  const portFile = join(o.profileDir, 'DevToolsActivePort')
  rmSync(portFile, { force: true })
  for (const lock of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) rmSync(join(o.profileDir, lock), { force: true })
  const args = [
    '--headless=new',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    `--user-data-dir=${o.profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--window-size=1440,900',
    // Chromium's sandbox refuses to run as root.
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    'about:blank',
  ]
  const proc = Bun.spawn([o.binary, ...args], {
    // TILION_NO_ACTIVATE: the launcher must never stop to ask for a license key.
    env: { ...(o.env ?? process.env), TILION_NO_ACTIVATE: '1' },
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'pipe',
  })
  let stderr = ''
  void new Response(proc.stderr).text().then((text) => { stderr = text }).catch(() => {})
  const stop = () => { try { proc.kill() } catch { /* gone */ } }
  process.once('exit', stop)

  const deadline = Date.now() + (o.timeoutMs ?? 30_000)
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      await Bun.sleep(50)
      throw new Error(`Fortress exited (code ${proc.exitCode}) before it was ready: ${stderr.trim().split('\n').slice(-5).join('\n')}`)
    }
    if (existsSync(portFile)) {
      const port = Number(readFileSync(portFile, 'utf8').split('\n')[0])
      if (Number.isInteger(port) && port > 0) return { httpUrl: `http://127.0.0.1:${port}`, stop }
    }
    await Bun.sleep(100)
  }
  stop()
  throw new Error(`Fortress did not open its debugging port in ${o.timeoutMs ?? 30_000} ms`)
}
