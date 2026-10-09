import { expect, test } from 'bun:test'

test('native resource operations preserve normal-cookie approval, storage and reload contracts', async () => {
  const command = [process.execPath, '--no-env-file', 'test', new URL('./native-resource-auth.isolated.ts', import.meta.url).pathname]
  if (process.platform === 'darwin') command.unshift('/usr/bin/sandbox-exec', '-p', '(version 1)(allow default)(deny network*)(allow network-inbound (local ip "localhost:*"))(allow network-outbound (remote ip "localhost:*"))')
  const child = Bun.spawn(command, { env: { PATH: process.env.PATH!, HOME: process.env.HOME!, TMPDIR: process.env.TMPDIR ?? '/tmp', ENCRYPTION_KEY: '0'.repeat(64) }, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (code !== 0) throw new Error(`${stdout}\n${stderr}`)
  expect(code).toBe(0)
}, 180_000)
