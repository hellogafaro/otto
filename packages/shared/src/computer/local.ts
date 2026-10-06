import { failed, type Computer, type ComputerExecOptions, type Spawned } from './types'

/** Runs commands on the host. `user` is ignored: the host process keeps its own identity. */
export class LocalComputer implements Computer {
  readonly id: string

  constructor(id = 'local') {
    this.id = id
  }

  async ensureRunning(): Promise<void> {}

  exec(argv: string[], o: ComputerExecOptions = {}): Spawned {
    if (o.signal?.aborted) return failed('aborted', 130)
    let proc: ReturnType<typeof Bun.spawn<'pipe' | 'ignore', 'pipe', 'pipe'>>
    try {
      proc = Bun.spawn(argv, {
        cwd: o.cwd,
        env: o.env ? { ...process.env, ...o.env } : process.env,
        stdin: o.stdin ? 'pipe' : 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        signal: o.signal,
      }) as typeof proc
    } catch (error) {
      return failed(error instanceof Error ? error.message : String(error))
    }
    return {
      stdin: o.stdin ? (proc.stdin as unknown as Spawned['stdin']) : undefined,
      stdout: proc.stdout,
      stderr: proc.stderr,
      exited: proc.exited,
      kill: (signal) => proc.kill(signal),
    }
  }

  async stop(): Promise<void> {}
}
