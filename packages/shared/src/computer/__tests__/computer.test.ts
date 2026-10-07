import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { copyFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  COMPUTER_RESTARTED,
  DockerComputer,
  boxChatDir,
  collect,
  ensureChatDir,
} from '../index'

const FAKE = join(import.meta.dir, 'fake-docker.sh')
const FAKE_ENV = [
  'FAKE_DOCKER_DIR',
  'FAKE_DOCKER_UNHEALTHY',
  'FAKE_DOCKER_STARTING_POLLS',
  'FAKE_DOCKER_NO_HEALTHCHECK',
] as const

let dir: string
let savedPath: string | undefined

/** Every recorded docker call as an argv array. */
function calls(): string[][] {
  const file = join(dir, 'calls')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n--\n')
    .filter(Boolean)
    .map((c) => c.split('\n'))
}
const lastExec = () => calls().filter((c) => c[0] === 'exec').at(-1)
const verbs = () => calls().map((c) => c[0])
const status = () => readFileSync(join(dir, 'status'), 'utf8').trim()

function box(extra: Partial<ConstructorParameters<typeof DockerComputer>[0]> = {}) {
  return new DockerComputer({ agentId: 'abc123def456', pollMs: 5, readyTimeoutMs: 500, ...extra })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fake-docker-'))
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  copyFileSync(FAKE, join(bin, 'docker'))
  chmodSync(join(bin, 'docker'), 0o755)
  savedPath = process.env.PATH
  process.env.PATH = `${bin}:${savedPath}`
  process.env.FAKE_DOCKER_DIR = dir
})

afterEach(() => {
  process.env.PATH = savedPath
  for (const key of FAKE_ENV) delete process.env[key]
  rmSync(dir, { recursive: true, force: true })
})

describe('DockerComputer', () => {
  test('first ensureRunning creates the container with the hardened flags', async () => {
    await box({ skillsDir: '/srv/skills', sourcesDir: '/srv/sources', docsDir: '/srv/docs', workspaceId: 'ws0000000001' }).ensureRunning()
    const run = calls().find((c) => c[0] === 'run')!
    expect(run).toEqual([
      'run', '-d',
      '--name', 'otto-agent-abc123def456',
      '--user', 'agent',
      '--init',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '--memory', '2g',
      '--cpus', '1',
      '--pids-limit', '512',
      '--shm-size', '1g',
      '-v', 'otto-agent-abc123def456-home:/home/agent',
      '-v', '/srv/skills:/skills:ro',
      '-v', '/srv/docs:/otto/docs:ro',
      '-v', '/srv/sources:/sources:ro',
      '--add-host', 'host.docker.internal:host-gateway',
      '-p', '127.0.0.1::6080',
      '-p', '127.0.0.1::9223',
      '--label', 'otto.agent=abc123def456',
      '--label', 'otto.workspace=ws0000000001',
      'otto-agent:latest',
    ])
    expect(status()).toBe('running')
  })

  test('no skills mount when no skills dir; custom image', async () => {
    await box({ image: 'otto-agent:dev' }).ensureRunning()
    const run = calls().find((c) => c[0] === 'run')!
    expect(run.some((a) => a.endsWith(':/skills:ro'))).toBe(false)
    expect(run.at(-1)).toBe('otto-agent:dev')
  })

  test('every published port is bound to 127.0.0.1', async () => {
    await box().ensureRunning()
    const run = calls().find((c) => c[0] === 'run')!
    const published = run.filter((_, i) => run[i - 1] === '-p')
    expect(published.length).toBe(2)
    for (const p of published) expect(p.startsWith('127.0.0.1::')).toBe(true)
  })

  test('an existing stopped container is started, not recreated', async () => {
    const c = box()
    await c.ensureRunning()
    await c.stop()
    expect(status()).toBe('exited')
    await box().ensureRunning() // a new server process
    expect(verbs().filter((v) => v === 'run').length).toBe(1)
    expect(calls().find((x) => x[0] === 'start')).toEqual(['start', 'otto-agent-abc123def456'])
    expect(status()).toBe('running')
  })

  test('a running container is left alone; the fast path skips docker entirely', async () => {
    const c = box()
    await c.ensureRunning()
    await c.ensureRunning()
    expect(verbs().filter((v) => v === 'run' || v === 'start').length).toBe(1)
    const before = calls().length
    await c.ensureRunning()
    expect(calls().length).toBe(before)

    await box().ensureRunning()
    expect(verbs().filter((v) => v === 'run' || v === 'start').length).toBe(1)
  })

  test('concurrent ensureRunning creates once', async () => {
    const c = box()
    await Promise.all([c.ensureRunning(), c.ensureRunning(), c.ensureRunning()])
    expect(verbs().filter((v) => v === 'run').length).toBe(1)
  })

  test('waits for the healthcheck', async () => {
    process.env.FAKE_DOCKER_STARTING_POLLS = '3'
    await box().ensureRunning()
    expect(verbs().filter((v) => v === 'inspect').length).toBeGreaterThanOrEqual(4)
  })

  test('unhealthy and docker failures become errors', async () => {
    process.env.FAKE_DOCKER_UNHEALTHY = '1'
    await expect(box().ensureRunning()).rejects.toThrow('unhealthy')
  })

  test('a missing docker binary is an error from ensureRunning', async () => {
    await expect(box({ docker: 'no-such-docker-bin' }).ensureRunning()).rejects.toThrow('docker inspect failed')
  })

  test('an image without healthcheck is ready once running', async () => {
    process.env.FAKE_DOCKER_NO_HEALTHCHECK = '1'
    await box().ensureRunning()
    expect(status()).toBe('running')
  })

  test('exec builds docker exec -i with user, cwd, env and the argv', async () => {
    const c = box()
    await c.ensureRunning()
    const r = await collect(
      c.exec(['fake-echo', 'a b', 'c'], { user: 'ana', cwd: '/home/agent/chats/x', env: { A: '1', B: 'two' } }),
    )
    expect(r).toEqual({ code: 0, stdout: 'a b c\n', stderr: '' })
    expect(lastExec()).toEqual([
      'exec', '-i', '-u', 'ana', '-w', '/home/agent/chats/x', '-e', 'A', '-e', 'B',
      'otto-agent-abc123def456', 'fake-echo', 'a b', 'c',
    ])
  })

  test('env values reach the docker client only by its environment, never its argv', async () => {
    const c = box()
    await c.ensureRunning()
    const r = await collect(c.exec(['fake-env', 'OTTO_RUN_TOKEN'], { env: { OTTO_RUN_TOKEN: 'run.secret' } }))
    expect(r.stdout).toBe('run.secret\n')
    expect(calls().flat().some((arg) => arg.includes('run.secret'))).toBe(false)
    const bad = await collect(c.exec(['fake-echo'], { env: { 'A=B': 'x' } }))
    expect(bad.code).toBe(2)
  })

  test('exec without options has no -u/-w/-e; exit codes and stderr pass through; stdin works', async () => {
    const c = box()
    await c.ensureRunning()
    const bad = await collect(c.exec(['fake-err', 'nope']))
    expect(bad).toEqual({ code: 3, stdout: '', stderr: 'nope\n' })
    expect(lastExec()).toEqual(['exec', '-i', 'otto-agent-abc123def456', 'fake-err', 'nope'])

    const spawned = c.exec(['fake-cat'], { stdin: true })
    spawned.stdin!.write('piped')
    await spawned.stdin!.end()
    expect((await collect(spawned)).stdout).toBe('piped')
  })

  test('abort kills the exec client and is not reported as a restart', async () => {
    const c = box()
    await c.ensureRunning()
    const ac = new AbortController()
    const spawned = c.exec(['fake-hang'], { signal: ac.signal })
    setTimeout(() => ac.abort(), 30)
    const r = await collect(spawned)
    expect(r.code).not.toBe(0)
    expect(r.stderr).not.toContain(COMPUTER_RESTARTED)
  })

  test('an already aborted signal never starts docker exec', async () => {
    const c = box()
    await c.ensureRunning()
    const before = calls().length
    const ac = new AbortController()
    ac.abort()
    expect((await c.exec(['fake-echo', 'x'], { signal: ac.signal }).exited)).toBe(130)
    expect(calls().length).toBe(before)
  })

  test('the container dying under an exec maps to the restart result', async () => {
    const c = box()
    await c.ensureRunning()
    const r = await collect(c.exec(['fake-die']))
    expect(r.code).toBe(-1)
    expect(r.stdout).toBe('partial output\n')
    expect(r.stderr).toBe(`${COMPUTER_RESTARTED}\n`)
    // the next ensureRunning does real work again
    await c.ensureRunning()
    expect(status()).toBe('running')
    expect(verbs().filter((v) => v === 'start').length).toBe(1)
  })

  test('a restart in between (new StartedAt) maps too; a plain failure does not', async () => {
    const c = box()
    await c.ensureRunning()
    const restarted = await collect(c.exec(['fake-restart']))
    expect(restarted.code).toBe(-1)
    expect(restarted.stderr).toContain(COMPUTER_RESTARTED)

    const c2 = box()
    await c2.ensureRunning()
    const plain = await collect(c2.exec(['fake-fail', '9']))
    expect(plain.code).toBe(9)
    expect(plain.stderr).toBe('')
  })

  test('exec on a stopped box maps to the restart result', async () => {
    const c = box()
    await c.ensureRunning()
    await c.stop()
    const r = await collect(c.exec(['fake-echo', 'x']))
    expect(r.code).toBe(-1)
    expect(r.stderr).toContain(COMPUTER_RESTARTED)
  })

  test('stop is docker stop; stopping a missing container is fine', async () => {
    const c = box()
    await c.stop()
    await c.ensureRunning()
    await c.stop()
    expect(calls().filter((x) => x[0] === 'stop').at(-1)).toEqual(['stop', '-t', '10', 'otto-agent-abc123def456'])
    expect(status()).toBe('exited')
  })

  test('viewerUrl returns the loopback noVNC url, null when stopped', async () => {
    const c = box()
    await c.ensureRunning()
    expect(await c.viewerUrl()).toBe('http://127.0.0.1:40080/vnc.html?autoconnect=true&resize=scale')
    expect(calls().at(-1)).toEqual(['port', 'otto-agent-abc123def456', '6080/tcp'])
    await c.stop()
    expect(await c.viewerUrl()).toBeNull()
  })

  test('agent ids that are not docker-safe are rejected', () => {
    expect(() => new DockerComputer({ agentId: '../x' })).toThrow('invalid agent id')
    expect(() => new DockerComputer({ agentId: 'a b' })).toThrow('invalid agent id')
  })

  describe('idle stop', () => {
    let t: number
    const clock = () => t
    beforeEach(() => {
      t = 1_000_000
    })

    test('stops only after the window, and not while a run, a command or a viewer is active', async () => {
      const c = box({ now: clock })
      await c.ensureRunning()

      t += 14 * 60_000
      expect(await c.stopIfIdle(15, false)).toBe(false) // window not passed

      t += 2 * 60_000
      expect(await c.stopIfIdle(15, true)).toBe(false) // a run is active
      expect(status()).toBe('running')

      const detach = c.attachViewer()
      t += 60 * 60_000
      expect(await c.stopIfIdle(15, false)).toBe(false) // viewer attached
      detach()
      expect(await c.stopIfIdle(15, false)).toBe(false) // detaching counts as activity

      const spawned = c.exec(['fake-hang'])
      t += 60 * 60_000
      expect(await c.stopIfIdle(15, false)).toBe(false) // command in flight
      spawned.kill()
      await spawned.exited

      t += 15 * 60_000
      expect(await c.stopIfIdle(15, false)).toBe(true)
      expect(status()).toBe('exited')
      expect(await c.stopIfIdle(15, false)).toBe(false) // already stopped
    })

    test('touch() restarts the window', async () => {
      const c = box({ now: clock })
      await c.ensureRunning()
      t += 10 * 60_000
      c.touch()
      t += 10 * 60_000
      expect(await c.stopIfIdle(15, false)).toBe(false)
      t += 5 * 60_000
      expect(await c.stopIfIdle(15, false)).toBe(true)
    })
  })

  test('chat folders: path rule and mkdir through exec', async () => {
    expect(boxChatDir('abc123')).toBe('/home/agent/chats/abc123')
    expect(boxChatDir('260101-brave-fox')).toBe('/home/agent/chats/260101-brave-fox')
    expect(() => boxChatDir('../etc')).toThrow('invalid chat id')
    const c = box()
    await c.ensureRunning()
    // the fake has no mkdir (exit 127); the recorded call is what we assert
    await expect(ensureChatDir(c, 'abc123', 'ana')).rejects.toThrow('could not create')
    expect(lastExec()).toEqual([
      'exec', '-i', '-u', 'ana', 'otto-agent-abc123def456', 'mkdir', '-p', '/home/agent/chats/abc123',
    ])
  })
})
