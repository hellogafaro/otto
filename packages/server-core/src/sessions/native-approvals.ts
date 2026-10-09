export type NativeApprovalValue = null | boolean | number | string | readonly NativeApprovalValue[] | { readonly [key: string]: NativeApprovalValue }

export interface NativeApprovalSummary {
  readonly title: string
  readonly summary?: string
  readonly details?: readonly string[]
  readonly artifact?: { readonly id: string; readonly title: string }
}

export interface NativeApprovalRequest {
  readonly chatId: string
  readonly runId: string
  readonly toolCallId: string
  readonly toolName: string
  readonly agentId: string
  readonly requesterId: string
  readonly args: { readonly [key: string]: NativeApprovalValue }
  readonly payloadHash: string
  readonly targetVersion?: string
  readonly summary: NativeApprovalSummary
}

export interface NativeApprovalRecord extends NativeApprovalRequest {
  readonly createdAt: number
}

export type NativeApprovalFailure = 'storage-failed' | 'invalidated' | 'release-failed' | 'stopped' | 'expired' | 'run-failed' | 'restart'

export interface NativeApprovalState {
  readonly status: 'pending' | 'resolving' | 'approved' | 'declined' | 'cancelled' | 'expired' | 'failed'
  readonly time: number
  readonly actorId?: string
  readonly result?: 'approve' | 'decline'
  readonly reason?: NativeApprovalFailure
}

export interface NativeApprovalCallbacks {
  assertLive(chatId: string, runId: string, agentId: string): void
  canResolve(record: NativeApprovalRecord, userId: string): boolean | Promise<boolean>
  validate(record: NativeApprovalRecord, userId: string): void | Promise<void>
  persist(record: NativeApprovalRecord, state: NativeApprovalState): Promise<void>
  release(record: NativeApprovalRecord, approve: boolean, response?: NativeApprovalValue): boolean | Promise<boolean>
  abort(record: NativeApprovalRecord, reason: NativeApprovalFailure): void | Promise<void>
  now?: () => number
}

interface PendingNativeApproval {
  record: NativeApprovalRecord
  ready: boolean
  claimed: boolean
  closed: boolean
  writes: Promise<void>
  intent?: Pick<NativeApprovalState, 'actorId' | 'result'>
  response?: NativeApprovalValue
  stopping?: Promise<void>
}

function freezeClone<T>(value: T): T {
  const cloned = structuredClone(value)
  const freeze = (item: unknown): void => {
    if (item === null || typeof item !== 'object') return
    if (Object.isFrozen(item)) return
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype) throw new Error('Native approval data must be plain values.')
    Object.freeze(item)
    for (const child of Object.values(item)) freeze(child)
  }
  freeze(cloned)
  return cloned
}

export class NativeApprovalController {
  private readonly requests = new Map<string, PendingNativeApproval | undefined>()

  constructor(private readonly callbacks: NativeApprovalCallbacks) {}

  private now(): number {
    return this.callbacks.now?.() ?? Date.now()
  }

  private persist(entry: PendingNativeApproval, state: NativeApprovalState): Promise<void> {
    const writing = entry.writes.then(() => this.callbacks.persist(entry.record, Object.freeze(state)))
    entry.writes = writing.catch(() => {})
    return writing
  }

  private stop(entry: PendingNativeApproval, reason: NativeApprovalFailure): Promise<void> {
    if (entry.stopping) return entry.stopping
    entry.closed = true
    const status = reason === 'expired' ? 'expired' : reason === 'storage-failed' || reason === 'release-failed' || reason === 'run-failed' ? 'failed' : 'cancelled'
    const saved = this.persist(entry, { ...entry.intent, status, time: this.now(), reason }).catch(() => {})
    const aborted = Promise.withResolvers<void>()
    entry.stopping = Promise.all([saved, aborted.promise]).then(() => {
      this.requests.set(entry.record.toolCallId, undefined)
    }, () => {
      entry.stopping = undefined
      throw new Error('The native approval run could not be stopped.')
    })
    try {
      Promise.resolve(this.callbacks.abort(entry.record, reason)).then(aborted.resolve, aborted.reject)
    } catch {
      aborted.reject(new Error('The native approval run could not be stopped.'))
    }
    return entry.stopping
  }

  async create(request: NativeApprovalRequest): Promise<NativeApprovalRecord | undefined> {
    if (this.requests.has(request.toolCallId)) throw new Error('This native approval request already exists.')
    const record = freezeClone({ ...request, createdAt: this.now() })
    const entry: PendingNativeApproval = { record, ready: false, claimed: false, closed: false, writes: Promise.resolve() }
    this.requests.set(record.toolCallId, entry)
    try {
      this.callbacks.assertLive(record.chatId, record.runId, record.agentId)
    } catch {
      await this.stop(entry, 'invalidated')
      return
    }
    try {
      await this.persist(entry, { status: 'pending', time: record.createdAt })
    } catch {
      await this.stop(entry, 'storage-failed')
      return
    }
    if (entry.closed) return
    try {
      this.callbacks.assertLive(record.chatId, record.runId, record.agentId)
    } catch {
      await this.stop(entry, 'invalidated')
      return
    }
    entry.ready = true
    return record
  }

  async resolve(toolCallId: string, userId: string, approve: boolean, response?: NativeApprovalValue): Promise<boolean> {
    const entry = this.requests.get(toolCallId)
    if (!entry?.ready || entry.claimed || entry.closed) return false
    let eligible: boolean
    try {
      const permission = this.callbacks.canResolve(entry.record, userId)
      eligible = typeof permission === 'boolean' ? permission : await permission
    } catch {
      return false
    }
    if (!eligible || entry.claimed || entry.closed) return false
    let immutableResponse: NativeApprovalValue | undefined
    try { immutableResponse = response === undefined ? undefined : freezeClone(response) } catch { return false }
    entry.claimed = true
    entry.response = immutableResponse
    entry.intent = { actorId: userId, result: approve ? 'approve' : 'decline' }
    try {
      await this.persist(entry, { ...entry.intent, status: 'resolving', time: this.now() })
    } catch {
      await this.stop(entry, 'storage-failed')
      return false
    }
    if (entry.closed) return false
    try {
      this.callbacks.assertLive(entry.record.chatId, entry.record.runId, entry.record.agentId)
      const permission = this.callbacks.canResolve(entry.record, userId)
      if (!(typeof permission === 'boolean' ? permission : await permission)) throw new Error('Native approval authority changed.')
      const validation = this.callbacks.validate(entry.record, userId)
      if (validation) await validation
    } catch {
      await this.stop(entry, 'invalidated')
      return false
    }
    if (entry.closed) return false
    try {
      await this.persist(entry, { ...entry.intent, status: approve ? 'approved' : 'declined', time: this.now() })
    } catch {
      await this.stop(entry, 'storage-failed')
      return false
    }
    if (entry.closed) return false
    try {
      const permission = this.callbacks.canResolve(entry.record, userId)
      if (!(typeof permission === 'boolean' ? permission : await permission)) throw new Error('Native approval authority changed.')
      const validation = this.callbacks.validate(entry.record, userId)
      if (validation) await validation
      const currentPermission = this.callbacks.canResolve(entry.record, userId)
      if (!(typeof currentPermission === 'boolean' ? currentPermission : await currentPermission)) throw new Error('Native approval authority changed.')
      if (entry.closed) return false
      this.callbacks.assertLive(entry.record.chatId, entry.record.runId, entry.record.agentId)
    } catch {
      await this.stop(entry, 'invalidated')
      return false
    }
    let accepted: boolean
    try {
      accepted = await this.callbacks.release(entry.record, approve, entry.response)
    } catch {
      await this.stop(entry, 'release-failed')
      return false
    }
    if (entry.closed) return false
    if (!accepted) {
      await this.stop(entry, 'release-failed')
      return false
    }
    entry.closed = true
    this.requests.set(toolCallId, undefined)
    return true
  }

  async cancelRun(chatId: string, runId: string, reason: NativeApprovalFailure = 'stopped'): Promise<void> {
    await Promise.all([...this.requests.values()]
      .filter((entry): entry is PendingNativeApproval => !!entry && entry.record.chatId === chatId && entry.record.runId === runId)
      .map((entry) => this.stop(entry, reason)))
  }

  async cancelChat(chatId: string, reason: NativeApprovalFailure = 'stopped'): Promise<void> {
    await Promise.all([...this.requests.values()]
      .filter((entry): entry is PendingNativeApproval => !!entry && entry.record.chatId === chatId)
      .map((entry) => this.stop(entry, reason)))
  }

  async cancelAll(reason: NativeApprovalFailure = 'restart'): Promise<void> {
    await Promise.all([...this.requests.values()]
      .filter((entry): entry is PendingNativeApproval => !!entry)
      .map((entry) => this.stop(entry, reason)))
  }
}
