import { DockerComputer } from './docker.ts'
import { boxChatDir } from './paths.ts'
import type { Computer, ComputerExecOptions, Spawned } from './types.ts'

export class ChatComputer implements Computer {
  readonly id: string
  readonly cwd: string
  private readonly computer: DockerComputer
  private blocked = false
  private starting?: Promise<void>
  private terminating?: Promise<void>
  private disposing?: Promise<void>
  private provisioningAttempted = false
  private disposed = false
  private readonly docker: string

  constructor(readonly scope: { workspaceId: string; agentId: string; chatId: string }, options: { docker?: string; image?: string } = {}) {
    for (const value of Object.values(scope)) {
      if (!/^[a-z0-9][a-z0-9-]*$/i.test(value)) throw new Error('Invalid chat computer scope.')
    }
    const allocationId = crypto.randomUUID()
    this.docker = options.docker ?? 'docker'
    this.computer = new DockerComputer({ agentId: allocationId, workspaceId: scope.workspaceId, network: 'none', hostAccess: false, publishPorts: false, ...options, image: options.image ?? 'otto-task:latest' })
    this.id = this.computer.id
    this.cwd = boxChatDir(scope.chatId)
  }

  async ensureRunning(): Promise<void> {
    if (this.blocked) throw new Error('Chat computer cancellation was not confirmed; this allocation is blocked.')
    await (this.starting ??= (async () => {
      this.provisioningAttempted = true
      await this.computer.ensureRunning()
      if (this.blocked) {
        await this.computer.terminate()
        throw new Error('Chat computer was cancelled while starting.')
      }
    })().finally(() => { this.starting = undefined }))
  }

  exec(argv: string[], options: ComputerExecOptions = {}): Spawned {
    if (this.blocked) throw new Error('This chat computer allocation is blocked.')
    options.signal?.throwIfAborted()
    if (options.user || Object.keys(options.env ?? {}).length) throw new Error('Chat computer tools cannot change their user or environment.')
    const inner = this.computer.exec(argv, { cwd: options.cwd ?? this.cwd, stdin: options.stdin })
    let cancellation: Promise<void> | undefined
    const kill = () => {
      cancellation ??= this.terminate().finally(() => inner.kill())
      void cancellation.catch(() => {})
    }
    options.signal?.addEventListener('abort', kill, { once: true })
    if (options.signal?.aborted) kill()
    const exited = inner.exited.finally(async () => {
      options.signal?.removeEventListener('abort', kill)
      await cancellation
    })
    return { ...inner, exited, kill }
  }

  hostPort(port: number): Promise<number | null> {
    return Promise.reject(new Error('The isolated chat computer has no host or peer network access. Browser access requires an approved confined egress boundary.'))
  }

  get watched(): boolean {
    return this.computer.watched
  }

  async terminate(): Promise<void> {
    this.blocked = true
    if (!this.provisioningAttempted || this.disposed) return
    await (this.terminating ??= (async () => {
      await this.starting?.catch(() => {})
      await this.computer.terminate()
    })().catch((error) => {
      this.terminating = undefined
      throw error
    }))
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    await (this.disposing ??= (async () => {
      await this.terminate()
      if (this.provisioningAttempted) {
        await this.runDocker(['rm', this.computer.name], this.computer.name)
        await this.runDocker(['volume', 'rm', this.computer.volume], this.computer.volume)
      }
      this.disposed = true
    })().catch((error) => {
      this.disposing = undefined
      throw error
    }))
  }

  private async runDocker(args: string[], resource: string): Promise<void> {
    const process = Bun.spawn([this.docker, ...args], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    const result = await new Response(process.stderr).text()
    await new Response(process.stdout).text()
    if (await process.exited !== 0) {
      const missing = args[0] === 'rm'
        ? new RegExp(`^(?:Error response from daemon: )?[Nn]o such (?:container|object): ${resource}$`)
        : new RegExp(`^(?:Error response from daemon: )?(?:[Nn]o such volume: ${resource}|get ${resource}: no such volume)$`)
      if (!missing.test(result.trim())) throw new Error(`Chat computer ${args[0]} failed: ${result.trim()}`)
    }
  }

  stop(): Promise<void> {
    return this.computer.stop()
  }
}
