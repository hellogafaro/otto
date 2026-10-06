import { afterAll, describe, expect, it } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getClaudeCodeStatus } from './claude-code-status'

const dir = mkdtempSync(join(tmpdir(), 'claude-status-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const script = (name: string, body: string) => {
  const path = join(dir, name)
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}

describe('getClaudeCodeStatus', () => {
  it('finds a claude that answers --version', async () => {
    const path = script('claude', 'echo "2.1.4 (Claude Code)"')
    expect(await getClaudeCodeStatus({ path })).toEqual({ found: true, path, version: '2.1.4 (Claude Code)' })
  })

  it('does not find one that is missing, fails, or hangs', async () => {
    const missing = join(dir, 'nope')
    expect(await getClaudeCodeStatus({ path: missing })).toEqual({ found: false, path: missing })
    const failing = script('failing', 'exit 1')
    expect(await getClaudeCodeStatus({ path: failing })).toEqual({ found: false, path: failing })
    const hanging = script('hanging', 'sleep 5')
    expect(await getClaudeCodeStatus({ path: hanging, timeoutMs: 200 })).toEqual({ found: false, path: hanging })
  })

  it('runs with no server secret in its env', async () => {
    process.env.ENCRYPTION_KEY = 'secret-for-the-test'
    const path = script('env', 'echo "${ENCRYPTION_KEY:-none}"')
    expect((await getClaudeCodeStatus({ path })).version).toBe('none')
    delete process.env.ENCRYPTION_KEY
  })
})
