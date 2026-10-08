import { expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ChatComputer } from '../../../shared/src/computer/chat-computer.ts'
import { createMastraComputerTools } from './mastra-computer-tools.ts'

const enabled = process.env.OTTO_TEST_CHAT_COMPUTER_DOCKER === '1'
it.skipIf(!enabled)('proves real independent container volumes, offline network, tool IO and Stop of owned background descendants', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'otto-chat-computer-'))
  const image = process.env.OTTO_TEST_TASK_IMAGE ?? `otto-chat-proof:${crypto.randomUUID()}`
  const docker = async (...args: string[]) => {
    const process = Bun.spawn(['docker', ...args], { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
    const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited])
    if (code) throw new Error(`${args[0]} failed: ${stderr}`)
    return stdout.trim()
  }
  let first: ChatComputer | undefined
  let second: ChatComputer | undefined
  let built = false
  try {
    if (!process.env.OTTO_TEST_TASK_IMAGE) {
    writeFileSync(join(directory, 'Dockerfile'), 'FROM rift-rift:latest\nUSER root\nRUN printf "agent:x:17731:17731::/home/agent:/bin/bash\\n" >> /etc/passwd && printf "agent:x:17731:\\n" >> /etc/group && mkdir /home/agent && chown 17731:17731 /home/agent\nUSER agent\nWORKDIR /home/agent\nHEALTHCHECK NONE\nENTRYPOINT ["/bin/sh", "-c", "exec sleep 3600"]\n')
    await docker('build', '--pull=false', '-t', image, directory)
    built = true
    }
    const { addWorkspace, saveConfig } = await import('../../../shared/src/config/storage.ts')
    const { getLibraryItems, readLibraryContent } = await import('../../../shared/src/library/index.ts')
    saveConfig({ workspaces: [] })
    const workspace = addWorkspace({ name: 'Publish fixture', rootPath: join(directory, 'workspace') })
    const scope = { workspaceId: workspace.id, agentId: crypto.randomUUID(), chatId: crypto.randomUUID() }
    const unused = new ChatComputer(scope, { image })
    await unused.dispose()
    await unused.dispose()
    await unused.terminate()
    await expect(unused.ensureRunning()).rejects.toThrow('blocked')
    first = new ChatComputer(scope, { image })
    second = new ChatComputer(scope, { image })
    expect(first.id).not.toBe(second.id)
    let mode: 'ask' | 'safe' = 'ask'
    let allowed = true
    const abort = new AbortController()
    const input = { ...scope, mode: 'ask' as const, getMode: () => mode, signal: abort.signal, assertAccess: () => { if (!allowed) throw new Error('Access removed') } }
    const tools = createMastraComputerTools({ ...input, computer: first })
    const peer = createMastraComputerTools({ ...input, computer: second })
    const call = (name: keyof typeof tools, args: unknown) => tools[name].execute!(args as never, {} as never)
    expect(await call('write', { path: 'brief.txt', content: 'private first' })).toMatchObject({ code: 0 })
    expect(await call('read', { path: 'brief.txt' })).toMatchObject({ code: 0, stdout: 'private first' })
    expect(await call('edit', { path: 'brief.txt', oldText: 'first', newText: 'edited' })).toMatchObject({ code: 0 })
    expect(await call('read', { path: 'brief.txt' })).toMatchObject({ stdout: 'private edited' })
    expect(getLibraryItems(scope.workspaceId)).toHaveLength(0)
    const published = await call('publish_file', { path: 'brief.txt' }) as { libraryId: string }
    expect(published).toMatchObject({ title: 'brief.txt', mime: 'text/plain', size: 14 })
    expect(Buffer.from(await readLibraryContent(scope.workspaceId, published.libraryId)).toString()).toBe('private edited')
    expect(getLibraryItems(scope.workspaceId)[0]?.createdBy).toBe(`agent:${scope.agentId}`)
    expect(await call('read', { path: 'brief.txt' })).toMatchObject({ stdout: 'private edited' })
    const foreign = addWorkspace({ name: 'Foreign fixture', rootPath: join(directory, 'foreign') })
    expect(getLibraryItems(foreign.id)).toHaveLength(0)
    await call('bash', { command: 'printf "\\000\\377\\001\\002" > bytes.bin; ln -s brief.txt linked.txt; ln brief.txt hard.txt; mkdir nested; ln -s ../bytes.bin nested/linked.bin; mkfifo pipe; head -c 4194305 /dev/zero > large.bin' })
    const binary = await call('publish_file', { path: 'bytes.bin' }) as { libraryId: string }
    expect(Buffer.from(await readLibraryContent(scope.workspaceId, binary.libraryId))).toEqual(Buffer.from([0, 255, 1, 2]))
    for (const path of ['../elsewhere', '/etc/passwd', 'linked.txt', 'hard.txt', 'nested/linked.bin', 'pipe', 'large.bin', 'nested']) {
      await expect(call('publish_file', { path })).rejects.toThrow()
    }
    expect(getLibraryItems(scope.workspaceId)).toHaveLength(2)
    await expect(call('publish_file', { path: 'bytes.bin', title: 'fake.md' })).rejects.toThrow()
    await call('bash', { command: 'rm hard.txt' })
    const rollback = createMastraComputerTools({ ...input, computer: first, assertAccess: () => {
      if (getLibraryItems(scope.workspaceId).some((item) => item.title === 'cancelled.txt')) throw new Error('Publication access revoked')
    } })
    await expect(rollback.publish_file.execute!({ path: 'brief.txt', title: 'cancelled.txt' }, {} as never)).rejects.toThrow('revoked')
    expect(getLibraryItems(scope.workspaceId)).toHaveLength(2)
    const duringPublication = new AbortController()
    const aborting = createMastraComputerTools({ ...input, computer: first, signal: duringPublication.signal, assertAccess: () => {
      if (getLibraryItems(scope.workspaceId).some((item) => item.title === 'aborted.txt')) duringPublication.abort()
    } })
    await expect(aborting.publish_file.execute!({ path: 'brief.txt', title: 'aborted.txt' }, {} as never)).rejects.toThrow()
    expect(getLibraryItems(scope.workspaceId)).toHaveLength(2)
    const cancelled = new AbortController()
    cancelled.abort()
    await expect(tools.publish_file.execute!({ path: 'bytes.bin' }, { abortSignal: cancelled.signal } as never)).rejects.toThrow()
    expect(getLibraryItems(scope.workspaceId)).toHaveLength(2)
    expect(await peer.read.execute!({ path: `${first.cwd}/brief.txt` }, {} as never)).toMatchObject({ code: 1, stdout: '' })
    const inspect = JSON.parse(await docker('inspect', `otto-agent-${first.id}`))[0]
    expect(inspect.HostConfig.NetworkMode).toBe('none')
    expect(inspect.HostConfig.ExtraHosts).toBeNull()
    expect(Object.keys(inspect.HostConfig.PortBindings ?? {})).toHaveLength(0)
    expect(inspect.Mounts).toHaveLength(1)
    expect(inspect.Mounts[0]).toMatchObject({ Type: 'volume', Name: `otto-agent-${first.id}-home`, Destination: '/home/agent' })
    expect(await call('bash', { command: 'ls /sys/class/net' })).toMatchObject({ stdout: 'lo\n' })
    allowed = false
    await expect(call('write', { path: 'denied.txt', content: 'denied' })).rejects.toThrow('Access removed')
    allowed = true
    mode = 'safe'
    await expect(call('bash', { command: 'echo denied' })).rejects.toThrow('mode changed')
    await expect(call('publish_file', { path: 'bytes.bin' })).rejects.toThrow('mode changed')
    mode = 'ask'
    const hanging = call('bash', { command: 'sleep 300 & echo $! > descendant.pid; touch ready; wait' })
    let ready = false
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await docker('exec', `otto-agent-${first.id}`, 'test', '-f', `${first.cwd}/ready`); ready = true; break } catch { await Bun.sleep(20) }
    }
    expect(ready).toBe(true)
    abort.abort()
    await expect(hanging).rejects.toThrow()
    expect(await docker('inspect', '-f', '{{.State.Running}}', `otto-agent-${first.id}`)).toBe('false')
    expect(await docker('inspect', '-f', '{{.State.Running}}', `otto-agent-${second.id}`)).toBe('true')
    await expect(first.ensureRunning()).rejects.toThrow('blocked')
    expect(await docker('exec', `otto-agent-${second.id}`, 'echo', 'peer-survived')).toBe('peer-survived')
    await first.dispose()
    await first.dispose()
    await second.terminate()
    await docker('rm', `otto-agent-${second.id}`)
    await docker('volume', 'rm', `otto-agent-${second.id}-home`)
    await second.dispose()
    await second.dispose()
  } finally {
    await Promise.all([first?.dispose(), second?.dispose()])
    if (built) await docker('image', 'rm', image)
    rmSync(directory, { recursive: true, force: true })
  }
}, 120000)
