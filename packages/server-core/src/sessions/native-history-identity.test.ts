import { expect, test } from 'bun:test'

test('canonical native identity persistence keeps every role and refuses conflicting duplicates', async () => {
  const child = Bun.spawn([process.execPath, 'test', new URL('./native-history-identity.isolated.ts', import.meta.url).pathname], { env: { ...Bun.env, ENCRYPTION_KEY: '0'.repeat(64) }, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (code !== 0) throw new Error(`${stdout}\n${stderr}`)
  expect(code).toBe(0)
}, 45_000)
