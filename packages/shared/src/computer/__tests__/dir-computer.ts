/**
 * Test double for an agent's box without a Docker daemon: a temp folder plays the box's root. Box paths in the argv
 * (`/home/agent/...`, `/skills/...`, `/otto/docs/...`) are rewritten under that folder, the mounts are symlinks to
 * the host folders, and the folder's prefix is taken out of the output again, so commands see and print box paths.
 * `crash()` kills what runs and makes it end like a box that died under a command (COMPUTER_RESTARTED, exit -1).
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { BOX_CHATS, BOX_FILES, BOX_HOME, DOCS_MOUNT, SKILLS_MOUNT } from '../paths'
import { COMPUTER_RESTARTED, failed, type Computer, type ComputerExecOptions, type Spawned } from '../types'

export interface DirComputerOptions {
  id?: string
  /** Host folders mounted in the box, by box path (e.g. `{ '/skills': '/tmp/ws/skills' }`). */
  mounts?: Record<string, string>
  /** Folders put first on the box's PATH (e.g. where `otto` is). */
  path?: string[]
}

const BOX_ROOTS = [BOX_HOME, SKILLS_MOUNT, DOCS_MOUNT]

export class DirComputer implements Computer {
  readonly id: string
  readonly root: string
  starts = 0
  private running = false
  private readonly live = new Set<{ proc: ReturnType<typeof Bun.spawn>; crashed: boolean }>()
  private readonly mounts: Record<string, string>
  private readonly path: string[]

  constructor(o: DirComputerOptions = {}) {
    this.id = o.id ?? 'dir'
    this.root = mkdtempSync(join(tmpdir(), 'otto-box-'))
    this.mounts = o.mounts ?? {}
    this.path = o.path ?? []
  }

  async ensureRunning(): Promise<void> {
    if (this.running) return
    for (const dir of [BOX_FILES, BOX_CHATS]) mkdirSync(this.root + dir, { recursive: true })
    for (const [box, host] of Object.entries(this.mounts)) {
      mkdirSync(dirname(this.root + box), { recursive: true })
      try { symlinkSync(host, this.root + box) } catch { /* already linked */ }
    }
    this.running = true
    this.starts++
  }

  /** A box path as the host sees it. */
  hostPath(boxPath: string): string {
    return this.root + boxPath
  }

  private toHost(text: string): string {
    let out = text
    for (const root of BOX_ROOTS) {
      out = out.replace(new RegExp(`(^|[\\s"'=:(])${root.replace(/\//g, '\\/')}(?=/|$|[\\s"';)])`, 'g'), `$1${this.root}${root}`)
    }
    return out
  }

  /** Takes the root's prefix out of the output, byte-wise (binary output such as an image passes unchanged). */
  private fromHost(stream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
    const root = Buffer.from(this.root)
    return stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        let buf = Buffer.from(chunk)
        const parts: Buffer[] = []
        for (let at = buf.indexOf(root); at >= 0; at = buf.indexOf(root)) {
          parts.push(buf.subarray(0, at))
          buf = buf.subarray(at + root.length)
        }
        parts.push(buf)
        controller.enqueue(new Uint8Array(Buffer.concat(parts)))
      },
    }))
  }

  exec(argv: string[], o: ComputerExecOptions = {}): Spawned {
    if (o.signal?.aborted) return failed('aborted', 130)
    if (!this.running) return failed('Error response from daemon: container is not running', 1)
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      HOME: this.root + BOX_HOME,
      PATH: [...this.path, process.env.PATH ?? ''].join(':'),
      ...o.env,
    }
    let proc: ReturnType<typeof Bun.spawn>
    try {
      proc = Bun.spawn(argv.map((arg) => this.toHost(arg)), {
        cwd: o.cwd ? this.toHost(o.cwd) : this.root + BOX_HOME,
        env,
        stdin: o.stdin ? 'pipe' : 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      })
    } catch (error) {
      return failed(error instanceof Error ? error.message : String(error))
    }
    const entry = { proc, crashed: false }
    this.live.add(entry)
    const onAbort = () => proc.kill()
    o.signal?.addEventListener('abort', onAbort, { once: true })
    const exited = proc.exited.then((code) => {
      this.live.delete(entry)
      o.signal?.removeEventListener('abort', onAbort)
      return entry.crashed ? -1 : code
    })
    const encoder = new TextEncoder()
    const inner = this.fromHost(proc.stderr as ReadableStream<Uint8Array>)
    const stderr = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = inner.getReader()
        for (let r = await reader.read(); !r.done; r = await reader.read()) controller.enqueue(r.value)
        await exited
        if (entry.crashed) controller.enqueue(encoder.encode(`${COMPUTER_RESTARTED}\n`))
        controller.close()
      },
    })
    return {
      stdin: o.stdin ? (proc.stdin as unknown as Spawned['stdin']) : undefined,
      stdout: this.fromHost(proc.stdout as ReadableStream<Uint8Array>),
      stderr,
      exited,
      kill: (signal) => proc.kill(signal),
    }
  }

  /** The box dies: running commands end with COMPUTER_RESTARTED; the next ensureRunning starts it again. */
  crash(): void {
    this.running = false
    for (const entry of this.live) {
      entry.crashed = true
      entry.proc.kill(9)
    }
  }

  async stop(): Promise<void> {
    this.running = false
  }

  dispose(): void {
    this.crash()
    rmSync(this.root, { recursive: true, force: true })
  }
}
