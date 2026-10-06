import {
  COMPUTER_RESTARTED,
  collect,
  failed,
  type Computer,
  type ComputerExecOptions,
  type Spawned,
} from './types'

export const DEFAULT_IMAGE = 'otto-agent:latest'
/** noVNC (websockify) inside the box. */
export const NOVNC_PORT = 6080
/** Chromium's CDP, forwarded to the box's network by socat (Chromium itself listens on loopback only). */
export const CDP_PORT = 9223

export interface DockerComputerOptions {
  agentId: string
  image?: string
  /** Host folder of the workspace skills; mounted read-only at /skills. */
  skillsDir?: string
  /** The docker CLI to run. */
  docker?: string
  /** How long to wait for the container's healthcheck. */
  readyTimeoutMs?: number
  pollMs?: number
  now?: () => number
}

interface State {
  status: string
  health: string
  startedAt: string
}

const STATE_FORMAT =
  '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.State.StartedAt}}'

/** One long-lived container per agent, driven through the `docker` CLI. */
export class DockerComputer implements Computer {
  readonly id: string
  readonly name: string
  readonly volume: string
  private readonly image: string
  private readonly skillsDir?: string
  private readonly bin: string
  private readonly readyTimeoutMs: number
  private readonly pollMs: number
  private readonly now: () => number
  private running = false
  private startedAt = ''
  private starting?: Promise<void>
  private lastActivity: number
  private inflight = 0
  private viewers = 0

  constructor(o: DockerComputerOptions) {
    if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(o.agentId)) throw new Error(`invalid agent id: ${o.agentId}`)
    this.id = o.agentId
    this.name = `otto-agent-${o.agentId}`
    this.volume = `${this.name}-home`
    this.image = o.image ?? DEFAULT_IMAGE
    this.skillsDir = o.skillsDir
    this.bin = o.docker ?? 'docker'
    this.readyTimeoutMs = o.readyTimeoutMs ?? 60_000
    this.pollMs = o.pollMs ?? 500
    this.now = o.now ?? Date.now
    this.lastActivity = this.now()
  }

  /** Record activity (a tool call, a viewer) so the idle window restarts. */
  touch(): void {
    this.lastActivity = this.now()
  }

  /** A viewer (noVNC through the server's proxy) is connected; call the returned function on disconnect. */
  attachViewer(): () => void {
    this.viewers++
    this.touch()
    let released = false
    return () => {
      if (released) return
      released = true
      this.viewers--
      this.touch()
    }
  }

  ensureRunning(): Promise<void> {
    if (this.running) return Promise.resolve()
    return (this.starting ??= this.start().finally(() => (this.starting = undefined)))
  }

  private async start(): Promise<void> {
    const state = await this.inspect()
    if (!state) {
      await this.run(this.runArgs())
    } else if (state.status !== 'running') {
      await this.run(['start', this.name])
    }
    this.startedAt = (await this.waitReady()).startedAt
    this.running = true
    this.touch()
  }

  private runArgs(): string[] {
    return [
      'run', '-d',
      '--name', this.name,
      '--user', 'agent',
      '--init',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '--memory', '2g',
      '--cpus', '1',
      '--pids-limit', '512',
      '--shm-size', '1g',
      '-v', `${this.volume}:/home/agent`,
      ...(this.skillsDir ? ['-v', `${this.skillsDir}:/skills:ro`] : []),
      '-p', `127.0.0.1::${NOVNC_PORT}`,
      '-p', `127.0.0.1::${CDP_PORT}`,
      '--label', `otto.agent=${this.id}`,
      this.image,
    ]
  }

  private async waitReady(): Promise<State> {
    const deadline = this.now() + this.readyTimeoutMs
    for (;;) {
      const state = await this.inspect()
      if (!state || state.status === 'exited' || state.status === 'dead') {
        throw new Error(`computer ${this.name} stopped while starting`)
      }
      if (state.status === 'running') {
        if (state.health === 'healthy' || state.health === 'none') return state
        if (state.health === 'unhealthy') throw new Error(`computer ${this.name} is unhealthy`)
      }
      if (this.now() >= deadline) throw new Error(`computer ${this.name} was not ready in ${this.readyTimeoutMs} ms`)
      await Bun.sleep(this.pollMs)
    }
  }

  /** The container's state, or null when it does not exist. */
  private async inspect(): Promise<State | null> {
    const r = await collect(this.docker(['inspect', '-f', STATE_FORMAT, this.name]))
    if (r.code !== 0) {
      if (/no such (object|container)/i.test(r.stderr)) return null
      throw new Error(`docker inspect failed: ${r.stderr.trim()}`)
    }
    const [status = '', health = '', startedAt = ''] = r.stdout.trim().split('|')
    return { status, health, startedAt }
  }

  private async run(args: string[]): Promise<void> {
    const r = await collect(this.docker(args))
    if (r.code !== 0) throw new Error(`docker ${args[0]} failed: ${r.stderr.trim()}`)
  }

  private docker(args: string[], o: { stdin?: boolean } = {}): Spawned {
    try {
      const proc = Bun.spawn([this.bin, ...args], {
        env: process.env, // read live, so the docker binary is looked up on the current PATH
        stdin: o.stdin ? 'pipe' : 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      return {
        stdin: o.stdin ? (proc.stdin as unknown as Spawned['stdin']) : undefined,
        stdout: proc.stdout as ReadableStream<Uint8Array>,
        stderr: proc.stderr as ReadableStream<Uint8Array>,
        exited: proc.exited,
        kill: (signal) => proc.kill(signal),
      }
    } catch (error) {
      return failed(error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * `docker exec -i`. Limit: killing (or aborting) stops the docker client; Docker does not signal
   * the process inside, so a runaway command keeps running until it ends or the box stops.
   * If the box died under the command, stderr gets COMPUTER_RESTARTED and the exit code is -1.
   */
  exec(argv: string[], o: ComputerExecOptions = {}): Spawned {
    if (o.signal?.aborted) return failed('aborted', 130)
    const args = ['exec', '-i']
    if (o.user) args.push('-u', o.user)
    if (o.cwd) args.push('-w', o.cwd)
    for (const [key, value] of Object.entries(o.env ?? {})) args.push('-e', `${key}=${value}`)
    args.push(this.name, ...argv)

    const inner = this.docker(args, { stdin: o.stdin })
    this.inflight++
    this.touch()
    let killed = false
    let restarted = false
    const kill = (signal?: number | NodeJS.Signals) => {
      killed = true
      inner.kill(signal)
    }
    const onAbort = () => kill()
    o.signal?.addEventListener('abort', onAbort, { once: true })

    const exited = inner.exited.then(async (code) => {
      o.signal?.removeEventListener('abort', onAbort)
      this.inflight--
      this.touch()
      if (code === 0 || killed || !(await this.hasDied())) return code
      this.running = false
      restarted = true
      return -1
    })

    const encoder = new TextEncoder()
    const stderr = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          const reader = inner.stderr.getReader()
          for (let r = await reader.read(); !r.done; r = await reader.read()) controller.enqueue(r.value)
          await exited
          if (restarted) controller.enqueue(encoder.encode(`${COMPUTER_RESTARTED}\n`))
          controller.close()
        } catch (error) {
          controller.error(error)
        }
      },
    })
    return { stdin: inner.stdin, stdout: inner.stdout, stderr, exited, kill }
  }

  /** True when the container is gone, stopped, or was restarted since ensureRunning. */
  private async hasDied(): Promise<boolean> {
    try {
      const state = await this.inspect()
      return !state || state.status !== 'running' || (!!this.startedAt && state.startedAt !== this.startedAt)
    } catch {
      return true
    }
  }

  /** Host port that the box's port is published on (127.0.0.1 only), or null when not running. */
  async hostPort(containerPort: number): Promise<number | null> {
    const r = await collect(this.docker(['port', this.name, `${containerPort}/tcp`]))
    if (r.code !== 0) return null
    const port = Number(r.stdout.trim().split('\n')[0]?.split(':').pop())
    return Number.isInteger(port) && port > 0 ? port : null
  }

  /**
   * noVNC on the loopback of the server host. The server's auth proxy must front it
   * (short-lived token); never hand this URL to a browser directly.
   */
  async viewerUrl(): Promise<string | null> {
    const port = await this.hostPort(NOVNC_PORT)
    if (!port) return null
    this.touch()
    return `http://127.0.0.1:${port}/vnc.html?autoconnect=true&resize=scale`
  }

  async stop(): Promise<void> {
    this.running = false
    const r = await collect(this.docker(['stop', '-t', '10', this.name]))
    if (r.code !== 0 && !/no such (object|container)/i.test(r.stderr)) {
      throw new Error(`docker stop failed: ${r.stderr.trim()}`)
    }
  }

  /**
   * Stop the box when nothing needs it: no run active (the caller knows), no command in flight,
   * no viewer attached, and `minutes` passed since the last activity. Returns whether it stopped.
   * The server calls this on a timer.
   */
  async stopIfIdle(minutes: number, hasActiveRuns: boolean): Promise<boolean> {
    if (hasActiveRuns || this.inflight > 0 || this.viewers > 0) return false
    if (this.now() - this.lastActivity < minutes * 60_000) return false
    if ((await this.inspect())?.status !== 'running') return false
    await this.stop()
    return true
  }
}

/** The agent's folder for one chat: its cwd inside the box. */
export function chatDir(chatId: string): string {
  if (!/^[a-z0-9]+$/i.test(chatId)) throw new Error(`invalid chat id: ${chatId}`)
  return `/home/agent/chats/${chatId}`
}

/** `docker exec -w` fails on a missing directory, so create the chat's folder before its first command. */
export async function ensureChatDir(computer: Computer, chatId: string, user?: string): Promise<string> {
  const dir = chatDir(chatId)
  const r = await collect(computer.exec(['mkdir', '-p', dir], { user }))
  if (r.code !== 0) throw new Error(`could not create ${dir}: ${r.stderr.trim()}`)
  return dir
}
