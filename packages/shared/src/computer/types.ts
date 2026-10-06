/** A place where an agent runs commands: the host (`local`) or one container per agent (`docker`). */

export interface ComputerExecOptions {
  cwd?: string
  env?: Record<string, string>
  /** User inside the computer (docker only); defaults to the image's non-root `agent`. */
  user?: string
  /** Open stdin as a writable pipe. When false/omitted `stdin` is undefined. */
  stdin?: boolean
  /** Abort kills the process. */
  signal?: AbortSignal
}

/** Minimal writable pipe (Bun's FileSink satisfies it). */
export interface SpawnedStdin {
  write(chunk: string | Uint8Array): number | Promise<number>
  flush?(): number | Promise<number>
  end(error?: Error): number | Promise<number> | void
}

export interface Spawned {
  stdin?: SpawnedStdin
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
  /** Exit code. -1 when the computer itself went away (see COMPUTER_RESTARTED). */
  exited: Promise<number>
  kill(signal?: number | NodeJS.Signals): void
}

export interface Computer {
  id: string
  ensureRunning(): Promise<void>
  exec(argv: string[], o?: ComputerExecOptions): Spawned
  viewerUrl?(): Promise<string | null>
  stop(): Promise<void>
}

export interface Collected {
  code: number
  stdout: string
  stderr: string
}

/** Drain a Spawned to completion. */
export async function collect(spawned: Spawned): Promise<Collected> {
  const [stdout, stderr, code] = await Promise.all([
    new Response(spawned.stdout).text(),
    new Response(spawned.stderr).text(),
    spawned.exited,
  ])
  return { code, stdout, stderr }
}

/** What a tool result says when the computer died or restarted under a running exec. */
export const COMPUTER_RESTARTED = 'computer restarted; the action may have run'

const encoder = new TextEncoder()

function textStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      if (text) controller.enqueue(encoder.encode(text))
      controller.close()
    },
  })
}

/** A Spawned that already finished: used when the process could not even be started. */
export function failed(message: string, code = 127): Spawned {
  return {
    stdout: textStream(''),
    stderr: textStream(`${message}\n`),
    exited: Promise.resolve(code),
    kill() {},
  }
}
