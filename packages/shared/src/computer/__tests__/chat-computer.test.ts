import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ChatComputer } from '../chat-computer.ts'

test('unused allocations need no Docker daemon; missing exact resources are idempotent but cleanup failures stay visible and retryable', async () => {
  const scope = { workspaceId: crypto.randomUUID(), agentId: crypto.randomUUID(), chatId: crypto.randomUUID() }
  const unused = new ChatComputer(scope, { docker: 'no-such-docker-test' })
  await unused.dispose()
  await unused.dispose()
  await unused.terminate()
  await expect(unused.ensureRunning()).rejects.toThrow('blocked')

  const directory = mkdtempSync(join(tmpdir(), 'otto-cleanup-proof-'))
  const docker = join(directory, 'docker')
  const calls = join(directory, 'calls')
  const denied = join(directory, 'denied')
  const script = `#!/bin/sh
echo "$*" >> '${calls}'
case "$1" in
inspect) echo 'running|healthy|fixture';;
kill) echo stopped;;
rm) echo "Error response from daemon: No such container: $2" >&2; exit 1;;
volume) if [ -f '${denied}' ]; then echo "permission denied" >&2; else echo "Error response from daemon: get $3: no such volume" >&2; fi; exit 1;;
esac
`
  try {
    writeFileSync(docker, script, { mode: 0o755 })
    const computer = new ChatComputer(scope, { docker })
    await computer.ensureRunning()
    writeFileSync(docker, script.replace("echo 'running|healthy|fixture'", 'echo "Error: No such object: fixture" >&2; exit 1'), { mode: 0o755 })
    writeFileSync(denied, 'deny')
    await expect(computer.dispose()).rejects.toThrow('permission denied')
    await expect(computer.dispose()).rejects.toThrow('permission denied')
    await expect(computer.ensureRunning()).rejects.toThrow('blocked')
    rmSync(denied)
    await computer.dispose()
    const before = readFileSync(calls, 'utf8')
    await computer.dispose()
    expect(readFileSync(calls, 'utf8')).toBe(before)
    expect(before).toContain(`rm otto-agent-${computer.id}`)
    expect(before).toContain(`volume rm otto-agent-${computer.id}-home`)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
