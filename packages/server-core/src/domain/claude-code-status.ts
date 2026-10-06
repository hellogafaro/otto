/**
 * Is the user's own `claude` runnable here? A Claude subscription runs the CLI of the machine the server is on
 * (`OTTO_CLAUDE_PATH`, else `claude` on PATH), so Settings asks before it offers the sign-in. It runs
 * `claude --version` with a short timeout and an allow-listed env; no credential is read or passed.
 */
import { execFile } from 'node:child_process'
import type { ClaudeCodeStatus } from '@otto/shared/protocol'

const ENV_KEYS = ['PATH', 'PATHEXT', 'HOME', 'USERPROFILE', 'SystemRoot', 'APPDATA', 'LOCALAPPDATA', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'CLAUDE_CONFIG_DIR']

export function getClaudeCodeStatus(options: { path?: string; timeoutMs?: number } = {}): Promise<ClaudeCodeStatus> {
  const path = options.path ?? (process.env.OTTO_CLAUDE_PATH?.trim() || 'claude')
  const env = Object.fromEntries(ENV_KEYS.flatMap((key) => (process.env[key] === undefined ? [] : [[key, process.env[key]]])))
  return new Promise((resolve) => {
    // Limit: on Windows `claude.cmd` needs a shell, so only the native `claude.exe` is found.
    execFile(path, ['--version'], { timeout: options.timeoutMs ?? 3000, windowsHide: true, env }, (error, stdout) => {
      if (error) return resolve({ found: false, path })
      resolve({ found: true, path, version: stdout.trim().split('\n')[0]?.slice(0, 80) || undefined })
    })
  })
}
