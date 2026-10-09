import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { NativeApprovalController, type NativeApprovalCallbacks, type NativeApprovalFailure, type NativeApprovalRecord, type NativeApprovalRequest, type NativeApprovalState } from './native-approvals.ts'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Native approval fixture timed out.')), 1000) })])
  } finally {
    clearTimeout(timer)
  }
}

function hash(args: NativeApprovalRequest['args']): string {
  return createHash('sha256').update(JSON.stringify(args)).digest('hex')
}

function fixture(overrides: Partial<NativeApprovalCallbacks> = {}) {
  const args = { title: 'Reviewed project', nested: { items: ['original'], credential: 'fixture-secret-not-for-storage' } }
  const request: NativeApprovalRequest = {
    chatId: 'chat-1', runId: 'run-1', toolCallId: 'tool-1', toolName: 'create_project', agentId: 'agent-1', requesterId: 'human-1',
    args, payloadHash: hash(args), targetVersion: 'version-1', summary: { title: 'Create reviewed project', summary: 'One project', details: ['Safe detail'] },
  }
  const roles = new Map([['human-1', 'human'], ['human-2', 'human'], ['agent-1', 'agent']])
  const allowed = new Set(['human-1', 'human-2'])
  const live = new Set(['run-1', 'run-2'])
  const saved: { record: Pick<NativeApprovalRecord, 'toolCallId' | 'summary'>; state: NativeApprovalState }[] = []
  const released: { record: NativeApprovalRecord; approve: boolean }[] = []
  const aborted: { toolCallId: string; reason: NativeApprovalFailure }[] = []
  const target = { version: 'version-1' }
  let time = 10
  const callbacks: NativeApprovalCallbacks = {
    assertLive: (_chatId, runId) => { if (!live.has(runId)) throw new Error('Fixture run ended.') },
    canResolve: (_record, userId) => roles.get(userId) === 'human' && allowed.has(userId),
    validate: (record, userId) => {
      if (roles.get(userId) !== 'human' || !allowed.has(userId) || target.version !== record.targetVersion || hash(record.args) !== record.payloadHash) throw new Error('Fixture authority or reviewed target changed.')
    },
    persist: async (record, state) => { saved.push({ record: { toolCallId: record.toolCallId, summary: record.summary }, state }) },
    release: (record, approve) => { if (!live.has(record.runId)) return false; released.push({ record, approve }); return true },
    abort: (record, reason) => { live.delete(record.runId); aborted.push({ toolCallId: record.toolCallId, reason }) },
    now: () => time++,
    ...overrides,
  }
  const controller = new NativeApprovalController(callbacks)
  return { args, request, roles, allowed, live, saved, released, aborted, target, callbacks, controller }
}

describe('native approval lifecycle', () => {
  it('persists pending before returning a publishable card and keeps exact arguments immutable and private', async () => {
    const f = fixture()
    const record = await bounded(f.controller.create(f.request))
    expect(record).toBeDefined()
    if (!record) throw new Error('Fixture approval did not persist.')
    expect(f.saved[0]?.state.status).toBe('pending')
    f.args.nested.items[0] = 'edited-after-request'
    const originalSummary = f.request.summary.details as string[]
    originalSummary[0] = 'edited-after-request'
    expect(record?.args).toEqual({ title: 'Reviewed project', nested: { items: ['original'], credential: 'fixture-secret-not-for-storage' } })
    expect(record?.summary.details).toEqual(['Safe detail'])
    expect(Object.isFrozen(record)).toBe(true)
    expect(Object.isFrozen(record?.args.nested)).toBe(true)
    expect(() => { (record!.args.nested as { items: string[] }).items[0] = 'mutation' }).toThrow()
    expect(await bounded(f.controller.resolve('tool-1', 'human-1', true))).toBe(true)
    expect(f.released[0]?.record).toBe(record)
    expect(hash(f.released[0]!.record.args)).toBe(f.request.payloadHash)
    expect(JSON.stringify(f.saved)).not.toContain('fixture-secret-not-for-storage')
    expect(f.saved.at(-1)?.state).toMatchObject({ status: 'approved', actorId: 'human-1', result: 'approve' })
    expect(f.saved.at(-1)!.state.time).toBeGreaterThan(f.saved[0]!.state.time)
  })

  it('does not publish or accept a click while the initial durable write is still pending', async () => {
    const started = deferred(), resume = deferred()
    const f = fixture({ persist: async (_record, state) => { if (state.status === 'pending') { started.resolve(); await resume.promise } } })
    const creating = f.controller.create(f.request)
    await bounded(started.promise)
    expect(await bounded(f.controller.resolve('tool-1', 'human-1', true))).toBe(false)
    expect(f.released).toHaveLength(0)
    resume.resolve()
    expect(await bounded(creating)).toBeDefined()
  })

  it('atomically claims between two genuinely concurrent human resolver calls before awaiting storage', async () => {
    const started = deferred(), resume = deferred()
    const f = fixture()
    const persist = f.callbacks.persist
    f.callbacks.persist = async (record, state) => {
      if (state.status === 'resolving') { started.resolve(); await resume.promise }
      await persist(record, state)
    }
    await bounded(f.controller.create(f.request))
    const first = f.controller.resolve('tool-1', 'human-1', true)
    const second = f.controller.resolve('tool-1', 'human-2', false)
    await bounded(started.promise)
    expect(await bounded(second)).toBe(false)
    expect(f.released).toHaveLength(0)
    resume.resolve()
    expect(await bounded(first)).toBe(true)
    expect(f.released).toHaveLength(1)
    expect(f.released[0]?.approve).toBe(true)
    expect(await bounded(f.controller.resolve('tool-1', 'human-2', false))).toBe(false)
    expect(f.released).toHaveLength(1)
  })

  it('allows the first eligible asynchronous authorization result to claim only once', async () => {
    const authority = deferred()
    const f = fixture()
    const canResolve = f.callbacks.canResolve
    let reads = 0
    f.callbacks.canResolve = async (record, userId) => { if (++reads <= 2) await authority.promise; return canResolve(record, userId) }
    await bounded(f.controller.create(f.request))
    const first = f.controller.resolve('tool-1', 'human-1', true)
    const second = f.controller.resolve('tool-1', 'human-2', false)
    authority.resolve()
    expect(await bounded(Promise.all([first, second]))).toEqual([true, false])
    expect(f.released).toHaveLength(1)
  })

  it('binds an immutable winning question answer to the atomic claim without persisting or accepting a losing answer', async () => {
    const started = deferred(), resume = deferred()
    const answers: unknown[] = []
    const f = fixture({ release: (_record, _approve, answer) => { answers.push(answer); return true } })
    const persist = f.callbacks.persist
    f.callbacks.persist = async (record, state) => { if (state.status === 'resolving') { started.resolve(); await resume.promise }; await persist(record, state) }
    await bounded(f.controller.create({ ...f.request, toolName: 'ask_user' }))
    const answer = ['winning-choice']
    const first = f.controller.resolve('tool-1', 'human-1', true, answer)
    await bounded(started.promise)
    answer[0] = 'caller-mutated'
    expect(await f.controller.resolve('tool-1', 'human-2', true, ['losing-choice'])).toBe(false)
    expect(await f.controller.resolve('tool-1', 'human-1', true, ['same-user-second-choice'])).toBe(false)
    expect(answers).toEqual([])
    resume.resolve()
    expect(await bounded(first)).toBe(true)
    expect(answers).toEqual([['winning-choice']])
    expect(Object.isFrozen(answers[0])).toBe(true)
    expect(JSON.stringify(f.saved)).not.toContain('winning-choice')
    expect(await f.controller.resolve('tool-1', 'human-2', true, ['late-choice'])).toBe(false)
    expect(answers).toHaveLength(1)
  })

  it('an agent or unrelated human cannot claim or persist a decision', async () => {
    const f = fixture()
    await bounded(f.controller.create(f.request))
    expect(await bounded(f.controller.resolve('tool-1', 'agent-1', true))).toBe(false)
    expect(await bounded(f.controller.resolve('tool-1', 'stranger', true))).toBe(false)
    expect(f.saved).toHaveLength(1)
    expect(f.aborted).toHaveLength(0)
    expect(await bounded(f.controller.resolve('tool-1', 'human-2', false))).toBe(true)
    expect(f.released).toHaveLength(1)
    expect(f.released[0]?.approve).toBe(false)
    expect(f.saved.at(-1)?.state).toMatchObject({ status: 'declined', actorId: 'human-2', result: 'decline' })
  })

  for (const status of ['resolving', 'approved'] as const) {
    it(`revoking the human role during the ${status} write never releases the gate`, async () => {
      const started = deferred(), resume = deferred()
      const f = fixture()
      const persist = f.callbacks.persist
      f.callbacks.persist = async (record, state) => { if (state.status === status) { started.resolve(); await resume.promise }; await persist(record, state) }
      await bounded(f.controller.create(f.request))
      const resolving = f.controller.resolve('tool-1', 'human-1', true)
      await bounded(started.promise)
      f.roles.set('human-1', 'agent')
      resume.resolve()
      expect(await bounded(resolving)).toBe(false)
      expect(f.released).toHaveLength(0)
      expect(f.aborted).toEqual([{ toolCallId: 'tool-1', reason: 'invalidated' }])
      expect(f.saved.at(-1)?.state.status).toBe('cancelled')
      expect(await bounded(f.controller.resolve('tool-1', 'human-2', true))).toBe(false)
    })
  }

  it('rechecks domain permission and target version after durable intent, without replaying tool effects', async () => {
    const started = deferred(), resume = deferred()
    const f = fixture()
    const persist = f.callbacks.persist
    f.callbacks.persist = async (record, state) => { if (state.status === 'approved') { started.resolve(); await resume.promise }; await persist(record, state) }
    await bounded(f.controller.create(f.request))
    const resolving = f.controller.resolve('tool-1', 'human-1', true)
    await bounded(started.promise)
    f.target.version = 'changed-version'
    resume.resolve()
    expect(await bounded(resolving)).toBe(false)
    expect(f.released).toHaveLength(0)
    expect(f.saved.at(-1)?.state.reason).toBe('invalidated')
  })

  it('revocation while the last asynchronous validation waits is checked again before gate release', async () => {
    const started = deferred(), resume = deferred()
    const f = fixture()
    const validate = f.callbacks.validate
    let validations = 0
    f.callbacks.validate = async (record, userId) => {
      await validate(record, userId)
      if (++validations === 2) { started.resolve(); await resume.promise }
    }
    await bounded(f.controller.create(f.request))
    const resolving = f.controller.resolve('tool-1', 'human-1', true)
    await bounded(started.promise)
    f.roles.set('human-1', 'agent')
    resume.resolve()
    expect(await bounded(resolving)).toBe(false)
    expect(f.released).toHaveLength(0)
    expect(f.aborted).toHaveLength(1)
  })

  it('validates the original payload hash and creator domain grant rather than trusting the click', async () => {
    for (const changed of ['hash', 'grant']) {
      const f = fixture()
      await bounded(f.controller.create(changed === 'hash' ? { ...f.request, payloadHash: 'wrong-hash' } : f.request))
      if (changed === 'grant') f.allowed.delete('human-1')
      expect(await bounded(f.controller.resolve('tool-1', 'human-1', true))).toBe(false)
      expect(f.released).toHaveLength(0)
    }
  })

  for (const failing of ['pending', 'resolving', 'approved'] as const) {
    it(`a failed ${failing} write stops the exact run without releasing or retaining an actionable gate`, async () => {
      const f = fixture()
      const persist = f.callbacks.persist
      f.callbacks.persist = async (record, state) => { if (state.status === failing) throw new Error('fixture-secret-error-body'); await persist(record, state) }
      const created = await bounded(f.controller.create(f.request))
      if (failing === 'pending') expect(created).toBeUndefined()
      else expect(await bounded(f.controller.resolve('tool-1', 'human-1', true))).toBe(false)
      expect(f.released).toHaveLength(0)
      expect(f.aborted).toEqual([{ toolCallId: 'tool-1', reason: 'storage-failed' }])
      expect(f.saved.at(-1)?.state).toMatchObject({ status: 'failed', reason: 'storage-failed' })
      expect(JSON.stringify(f.saved)).not.toContain('fixture-secret-error-body')
      expect(await bounded(f.controller.resolve('tool-1', 'human-2', true))).toBe(false)
    })
  }

  it('total storage failure still aborts rather than leaving the native run suspended', async () => {
    const f = fixture({ persist: async () => { throw new Error('Controlled fixture storage outage.') } })
    expect(await bounded(f.controller.create(f.request))).toBeUndefined()
    expect(f.aborted).toEqual([{ toolCallId: 'tool-1', reason: 'storage-failed' }])
    expect(f.live.has('run-1')).toBe(false)
    expect(await bounded(f.controller.resolve('tool-1', 'human-1', true))).toBe(false)
  })

  for (const failure of ['false', 'throw']) {
    it(`a ${failure} native response fails closed and is never tried again`, async () => {
      let attempts = 0
      const f = fixture({ release: () => { attempts++; if (failure === 'throw') throw new Error('fixture-secret-release-body'); return false } })
      await bounded(f.controller.create(f.request))
      expect(await bounded(f.controller.resolve('tool-1', 'human-1', true))).toBe(false)
      expect(await bounded(f.controller.resolve('tool-1', 'human-2', true))).toBe(false)
      expect(attempts).toBe(1)
      expect(f.aborted).toEqual([{ toolCallId: 'tool-1', reason: 'release-failed' }])
      expect(f.saved.at(-1)?.state).toMatchObject({ status: 'failed', reason: 'release-failed' })
      expect(JSON.stringify(f.saved)).not.toContain('fixture-secret-release-body')
    })
  }

  it('stop during decision persistence closes synchronously and serializes cancellation after the in-flight write', async () => {
    const started = deferred(), resume = deferred()
    const f = fixture()
    const persist = f.callbacks.persist
    f.callbacks.persist = async (record, state) => { if (state.status === 'approved') { started.resolve(); await resume.promise }; await persist(record, state) }
    await bounded(f.controller.create(f.request))
    const resolving = f.controller.resolve('tool-1', 'human-1', true)
    await bounded(started.promise)
    const stopping = f.controller.cancelRun('chat-1', 'run-1')
    expect(f.aborted).toHaveLength(1)
    expect(await bounded(f.controller.resolve('tool-1', 'human-2', true))).toBe(false)
    resume.resolve()
    expect(await bounded(resolving)).toBe(false)
    await bounded(stopping)
    expect(f.released).toHaveLength(0)
    expect(f.saved.map((row) => row.state.status)).toEqual(['pending', 'resolving', 'approved', 'cancelled'])
  })

  it('stop during initial persistence never returns a publishable historical pending request', async () => {
    const started = deferred(), resume = deferred()
    const f = fixture()
    const persist = f.callbacks.persist
    f.callbacks.persist = async (record, state) => { if (state.status === 'pending') { started.resolve(); await resume.promise }; await persist(record, state) }
    const creating = f.controller.create(f.request)
    await bounded(started.promise)
    const stopping = f.controller.cancelChat('chat-1')
    resume.resolve()
    expect(await bounded(creating)).toBeUndefined()
    await bounded(stopping)
    expect(f.saved.at(-1)?.state.status).toBe('cancelled')
    expect(f.released).toHaveLength(0)
  })

  it('stop while an asynchronous gate callback waits depends on the exact native gate being aborted', async () => {
    const started = deferred(), resume = deferred()
    const f = fixture()
    const release = f.callbacks.release
    f.callbacks.release = async (record, approve) => { started.resolve(); await resume.promise; return release(record, approve) }
    await bounded(f.controller.create(f.request))
    const resolving = f.controller.resolve('tool-1', 'human-1', true)
    await bounded(started.promise)
    await bounded(f.controller.cancelRun('chat-1', 'run-1'))
    resume.resolve()
    expect(await bounded(resolving)).toBe(false)
    expect(f.released).toHaveLength(0)
    expect(f.aborted).toHaveLength(1)
  })

  it('synchronous native stop hooks can signal cancellation again without invoking abort twice', async () => {
    const f = fixture()
    const abort = f.callbacks.abort
    let nested: Promise<void> | undefined
    f.callbacks.abort = (record, reason) => {
      nested = f.controller.cancelRun(record.chatId, record.runId, reason)
      return abort(record, reason)
    }
    await bounded(f.controller.create(f.request))
    await bounded(f.controller.cancelRun('chat-1', 'run-1'))
    if (nested) await bounded(nested)
    expect(f.aborted).toHaveLength(1)
    expect(f.released).toHaveLength(0)
  })

  it('expiry is run-scoped, failure is chat-scoped, and restart makes all old cards nonactionable', async () => {
    const f = fixture()
    await bounded(f.controller.create(f.request))
    await bounded(f.controller.create({ ...f.request, toolCallId: 'tool-2', runId: 'run-2' }))
    await bounded(f.controller.cancelRun('chat-1', 'run-1', 'expired'))
    expect(await bounded(f.controller.resolve('tool-1', 'human-1', true))).toBe(false)
    expect(f.saved.findLast((row) => row.record.toolCallId === 'tool-1')?.state.status).toBe('expired')
    expect(await bounded(f.controller.resolve('tool-2', 'human-1', true))).toBe(true)
    f.live.add('run-3')
    await bounded(f.controller.create({ ...f.request, toolCallId: 'tool-3', runId: 'run-3' }))
    await bounded(f.controller.cancelChat('chat-1', 'run-failed'))
    expect(f.saved.at(-1)?.state.status).toBe('failed')
    f.live.add('run-4')
    await bounded(f.controller.create({ ...f.request, toolCallId: 'tool-4', runId: 'run-4' }))
    await bounded(f.controller.cancelAll())
    expect(f.saved.at(-1)?.state.reason).toBe('restart')
    const restarted = new NativeApprovalController(f.callbacks)
    for (const toolCallId of ['tool-1', 'tool-2', 'tool-3', 'tool-4']) expect(await bounded(restarted.resolve(toolCallId, 'human-1', true))).toBe(false)
    expect(f.released).toHaveLength(1)
  })

  it('never registers a second gate for a completed native tool-call id', async () => {
    const f = fixture()
    await bounded(f.controller.create(f.request))
    expect(await bounded(f.controller.resolve('tool-1', 'human-1', true))).toBe(true)
    await expect(bounded(f.controller.create(f.request))).rejects.toThrow('already exists')
    expect(f.released).toHaveLength(1)
  })

  it('surfaces an abort failure with no credential body, so the owner must finish exact-run teardown', async () => {
    const f = fixture()
    const abort = f.callbacks.abort
    let failing = true
    f.callbacks.abort = (record, reason) => { if (failing) throw new Error('fixture-secret-abort-body'); return abort(record, reason) }
    await bounded(f.controller.create(f.request))
    await expect(bounded(f.controller.cancelRun('chat-1', 'run-1'))).rejects.toThrow('The native approval run could not be stopped.')
    expect(await bounded(f.controller.resolve('tool-1', 'human-1', true))).toBe(false)
    expect(f.released).toHaveLength(0)
    expect(JSON.stringify(f.saved)).not.toContain('fixture-secret-abort-body')
    failing = false
    await bounded(f.controller.cancelRun('chat-1', 'run-1'))
    expect(f.aborted).toHaveLength(1)
    expect(f.live.has('run-1')).toBe(false)
  })
})
