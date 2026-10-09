import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('provider endpoint identity and consent pass in a disposable process', async () => {
  const configDir = mkdtempSync(join(tmpdir(), 'otto-provider-identity-'))
  try {
    const process = Bun.spawn(['bun', 'test', new URL('./llm-connections-identity.isolated.ts', import.meta.url).pathname], {
      env: { ...Bun.env, OTTO_CONFIG_DIR: configDir, ENCRYPTION_KEY: '0'.repeat(64) },
      stdout: 'pipe', stderr: 'pipe',
    })
    const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited])
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`)
    expect(code).toBe(0)
  } finally { rmSync(configDir, { recursive: true, force: true }) }
}, 120000)
