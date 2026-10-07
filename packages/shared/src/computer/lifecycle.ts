/**
 * Sharing one agent's computer between chats (docs/final-plan.md 2.5, C2): at most `MAX_COMPUTER_RUNS` turns use it
 * at once and the rest wait in order ("Waiting for the computer"), and one chat at a time holds the visible screen
 * (the desktop lease; a person watching through the viewer always wins). Per computer id, in memory.
 */

export const MAX_COMPUTER_RUNS = 4
export const DESKTOP_LEASE_MS = 2 * 60_000

export class ComputerRuns {
  private active = 0
  private readonly waiting: Array<() => void> = []

  constructor(readonly max = MAX_COMPUTER_RUNS) {}

  get activeCount(): number {
    return this.active
  }

  get waitingCount(): number {
    return this.waiting.length
  }

  /**
   * Resolves with the release function once the turn may use the computer. `onWait` is called (once) when it has
   * to wait first. An abort while waiting leaves the queue and rejects.
   */
  async acquire(o: { signal?: AbortSignal; onWait?: (ahead: number) => void } = {}): Promise<() => void> {
    if (o.signal?.aborted) throw new Error('aborted')
    if (this.active < this.max) {
      this.active++
      return this.releaser()
    }
    o.onWait?.(this.waiting.length + 1)
    await new Promise<void>((resolve, reject) => {
      const go = () => {
        o.signal?.removeEventListener('abort', onAbort)
        resolve()
      }
      const onAbort = () => {
        const i = this.waiting.indexOf(go)
        if (i >= 0) this.waiting.splice(i, 1)
        reject(new Error('aborted'))
      }
      o.signal?.addEventListener('abort', onAbort, { once: true })
      this.waiting.push(go)
    })
    return this.releaser()
  }

  private releaser(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      const next = this.waiting.shift()
      if (next) next() // the slot passes straight to the next turn
      else this.active--
    }
  }
}

export class DesktopLease {
  private holder: { chatId: string; at: number } | null = null

  constructor(private readonly now: () => number = Date.now, readonly leaseMs = DESKTOP_LEASE_MS) {}

  /**
   * Whether `chatId` holds the screen now: it takes it when free, when it already holds it, or when the holder has
   * not used it for the lease time. While a person watches (`watched`) no chat takes it.
   */
  take(chatId: string, watched = false): { held: boolean; holder: string | null } {
    const now = this.now()
    if (this.holder && this.holder.chatId !== chatId && now - this.holder.at < this.leaseMs) {
      return { held: false, holder: this.holder.chatId }
    }
    if (watched) return { held: false, holder: null }
    this.holder = { chatId, at: now }
    return { held: true, holder: chatId }
  }

  release(chatId: string): void {
    if (this.holder?.chatId === chatId) this.holder = null
  }

  get current(): string | null {
    if (!this.holder || this.now() - this.holder.at >= this.leaseMs) return null
    return this.holder.chatId
  }
}

const runs = new Map<string, ComputerRuns>()
const desktops = new Map<string, DesktopLease>()

export function getComputerRuns(computerId: string): ComputerRuns {
  let r = runs.get(computerId)
  if (!r) runs.set(computerId, (r = new ComputerRuns()))
  return r
}

export function getDesktopLease(computerId: string): DesktopLease {
  let d = desktops.get(computerId)
  if (!d) desktops.set(computerId, (d = new DesktopLease()))
  return d
}

/** True while a turn uses (or waits for) the computer: idle stop must leave it running. */
export function hasActiveRuns(computerId: string): boolean {
  const r = runs.get(computerId)
  return !!r && (r.activeCount > 0 || r.waitingCount > 0)
}
