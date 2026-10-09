import { afterEach, expect, mock, test } from 'bun:test'
import { PassThrough } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { openDb } from '../db/index.ts'
import { pushSchema } from '../db/push.ts'
import { createRoutine, getRoutine, updateRoutine } from './routines.ts'
import type { RoutineConfig } from './routine-types.ts'
import type { RoutineRunnerDeps } from './routine-runner.ts'
import type { AutomationMatcher, PendingPrompt, ScriptActionResult, WebhookActionResult } from './types.ts'

const effects = { script: 0, webhook: 0, secret: 0, model: 0, history: [] as Record<string, unknown>[] }
const database = await import('../db/index.ts')
mock.module('../db/index.ts', () => ({ ...database, initDb: () => { throw new Error('Fixture refuses real application data access.') } }))
mock.module('./script-executor.ts', () => ({
  executeScriptAction: async () => { effects.script++; return { success: true, stdout: '', stderr: '', exitCode: 0 } },
  createScriptHistoryEntry: (input: unknown) => input,
  clampScriptTimeout: () => 60000,
  DEFAULT_SCRIPT_TIMEOUT_MS: 60000,
  MAX_SCRIPT_TIMEOUT_MS: 900000,
}))
mock.module('./webhook-utils.ts', () => ({
  executeWebhookRequest: async () => { effects.webhook++; return { success: true, statusCode: 200 } },
  executeWithRetry: async () => { effects.webhook++; return { type: 'webhook', url: 'https://fixture.invalid', success: true, statusCode: 200 } },
  createWebhookHistoryEntry: (input: unknown) => input,
  createPromptHistoryEntry: (input: unknown) => input,
  redactUrl: () => 'redacted-fixture-url',
}))
mock.module('./history-store.ts', () => ({ appendAutomationHistoryEntry: async (_path: string, entry: Record<string, unknown>) => { effects.history.push(entry) } }))
mock.module('../../../server-core/src/decisions/automation-condition.ts', () => ({ checkAutomationCondition: async () => { effects.model++; return { run: true } } }))

const { runRoutine, tickRoutines, recordRoutineRun } = await import('./routine-runner.ts')
const { AutomationSystem } = await import('./automation-system.ts')
const { ScriptHandler } = await import('./handlers/script-handler.ts')
const { WebhookHandler } = await import('./handlers/webhook-handler.ts')
const { WorkspaceEventBus } = await import('./event-bus.ts')
const { createRoutineWebhookHandler } = await import('../../../server-core/src/webui/routine-webhook.ts')
const { routineRunnerDeps } = await import('../../../server-core/src/handlers/rpc/routines.ts')

afterEach(() => {
  effects.script = 0
  effects.webhook = 0
  effects.secret = 0
  effects.model = 0
  effects.history.length = 0
})

const workspaceId = 'native-routine-fixture'
const createdBy = 'user:fixture-human'
const schedule: RoutineConfig = { type: 'schedule', schedule: { cron: '* * * * *', timezone: 'UTC' }, actions: [{ type: 'prompt', prompt: 'Allowed native prompt' }] }

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Routine isolation fixture timed out.')), 1500) })])
  } finally {
    clearTimeout(timer)
  }
}

async function fixture() {
  const db = openDb(':memory:')
  await pushSchema(db)
  const prompts: { owner: string; prompt: string }[] = []
  const changes: string[] = []
  let judgments = 0, roots = 0
  const deps: RoutineRunnerDeps = {
    db,
    getWorkspaceRootPath: () => { roots++; return '/unused-native-routine-fixture' },
    getSecret: () => { effects.secret++; return 'fixture-token' },
    shouldRun: async () => { judgments++; return { run: true } },
    onChange: (id) => { changes.push(id) },
    runPrompt: async ({ routine, action }) => { prompts.push({ owner: routine.createdBy, prompt: action.prompt }); return { chatId: 'fixture-chat' } },
  }
  const add = (config: RoutineConfig, paused = false) => createRoutine({ workspaceId, createdBy, title: 'Stored fixture', config, paused }, db)
  return { db, deps, prompts, changes, add, judgments: () => judgments, roots: () => roots }
}

test('manual root dispatch denies script, webhook, and mixed actions before any executor, prompt, secret, or semantic model call', async () => {
  const f = await fixture()
  for (const actions of [
    [{ type: 'script' as const, script: 'scripts/preserved.ts', args: ['preserved-argument'] }],
    [{ type: 'webhook' as const, url: 'https://fixture.invalid', secretId: 'preserved-secret-id' }],
    [{ type: 'prompt' as const, prompt: 'Must not partially execute' }, { type: 'script' as const, script: 'scripts/preserved.ts' }],
  ]) {
    const routine = f.add({ ...schedule, semanticCondition: { question: 'Must not infer' }, actions })
    const before = JSON.stringify(routine.config)
    const handle = runRoutine(routine, f.deps)!
    expect(handle.run.status).toBe('error')
    await bounded(handle.done)
    const stored = getRoutine(workspaceId, routine.id, f.db)!
    expect(stored.runs[0]).toMatchObject({ status: 'error', chatId: null })
    expect(stored.runs[0]?.error).toContain('unsupported')
    expect(JSON.stringify(stored.config)).toBe(before)
    expect(stored.createdBy).toBe(createdBy)
  }
  expect(effects.script).toBe(0)
  expect(effects.webhook).toBe(0)
  expect(effects.secret).toBe(0)
  expect(f.prompts).toEqual([])
  expect(f.judgments()).toBe(0)
  expect(f.roots()).toBe(0)
  expect(f.changes).toEqual(Array(6).fill(workspaceId))
})

test('the actual scheduler denies unsupported actions while preserving paused state and allowing another native prompt routine', async () => {
  const f = await fixture()
  const unsupported = f.add({ ...schedule, actions: [{ type: 'script', script: 'scripts/preserved.ts' }] })
  const paused = f.add({ ...schedule, actions: [{ type: 'webhook', url: 'https://fixture.invalid' }] }, true)
  const allowed = f.add(schedule)
  const pausedAt = paused.pausedAt
  const handles = tickRoutines(Date.UTC(2026, 9, 9, 12, 0), f.deps)
  await bounded(Promise.all(handles.map((handle) => handle.done)))
  expect(handles).toHaveLength(2)
  expect(getRoutine(workspaceId, unsupported.id, f.db)?.runs[0]?.status).toBe('error')
  expect(getRoutine(workspaceId, paused.id, f.db)).toMatchObject({ pausedAt, runs: [] })
  expect(getRoutine(workspaceId, allowed.id, f.db)?.runs[0]).toMatchObject({ status: 'ok', chatId: 'fixture-chat' })
  expect(f.prompts).toEqual([{ owner: createdBy, prompt: 'Allowed native prompt' }])
  expect(effects.script + effects.webhook).toBe(0)
})

test('the actual RPC runner factory delegates supported prompts to the existing native human runner but never delegates unsupported actions or infers their condition', async () => {
  const f = await fixture()
  const nativeInputs: Record<string, unknown>[] = []
  const deps: RoutineRunnerDeps = {
    ...routineRunnerDeps({ sessionManager: { executePromptAutomation: async (input: Record<string, unknown>) => { nativeInputs.push(input); return { sessionId: 'rpc-native-fixture-chat' } } } as never }, (id) => { f.changes.push(id) }),
    db: f.db,
    getWorkspaceRootPath: f.deps.getWorkspaceRootPath,
  }
  for (const actions of [[{ type: 'script' as const, script: 'scripts/preserved.ts' }], [{ type: 'webhook' as const, url: 'https://fixture.invalid' }]]) {
    const routine = f.add({ ...schedule, semanticCondition: { question: 'Must not infer' }, actions })
    const handle = runRoutine(routine, deps)!
    expect(handle.run.status).toBe('error')
    await bounded(handle.done)
  }
  expect(nativeInputs).toEqual([])
  expect(effects.model + effects.script + effects.webhook).toBe(0)
  const routine = f.add({ ...schedule, permissionMode: 'safe' })
  await bounded(runRoutine(routine, deps)!.done)
  expect(nativeInputs).toMatchObject([{ createdBy, workspaceId, prompt: 'Allowed native prompt', permissionMode: 'safe', automationId: routine.id }])
  expect(getRoutine(workspaceId, routine.id, f.db)?.runs[0]).toMatchObject({ status: 'ok', chatId: 'rpc-native-fixture-chat' })
})

test('recorded event work rechecks unsupported configuration before invoking the native work callback', async () => {
  const f = await fixture()
  const routine = f.add({ type: 'event', event: 'LabelAdd', actions: [{ type: 'script', script: 'scripts/preserved.ts' }] })
  let work = 0
  await expect(bounded(recordRoutineRun(routine, async () => { work++; return { chatId: 'not-allowed' } }, f.deps.onChange, f.db))).rejects.toThrow('unsupported')
  expect(work).toBe(0)
  expect(getRoutine(workspaceId, routine.id, f.db)?.runs[0]).toMatchObject({ status: 'error', chatId: null })
  expect(f.changes).toEqual([workspaceId, workspaceId])
})

test('global event admission preserves supported prompt delivery while excluding unsupported or mixed stored configs and model checks', async () => {
  const f = await fixture()
  const unsafe = f.add({ type: 'event', event: 'LabelAdd', semanticCondition: { question: 'Must not infer' }, actions: [{ type: 'prompt', prompt: 'Do not convert this mixed routine' }, { type: 'script', script: 'scripts/preserved.ts' }, { type: 'webhook', url: 'https://fixture.invalid' }] })
  const allowed = f.add({ type: 'event', event: 'LabelAdd', actions: [{ type: 'prompt', prompt: 'Allowed event prompt' }] })
  const before = JSON.stringify(unsafe.config)
  const pending: PendingPrompt[] = []
  const errors: string[] = []
  const system = new AutomationSystem({ workspaceId, workspaceRootPath: '/unused-native-routine-fixture', db: f.db, onPromptsReady: (items) => { pending.push(...items) }, onError: (_event, error) => { errors.push(error.message) } })
  try {
    expect(system.getConfig().automations.LabelAdd?.map((matcher) => matcher.id)).toEqual([allowed.id])
    expect(system.getMatchersForEvent('LabelAdd').map((matcher) => matcher.id)).toEqual([allowed.id])
    await bounded(system.eventBus.emit('LabelAdd', { workspaceId, timestamp: Date.now(), label: 'fixture-label' }))
    expect(pending.map((item) => item.prompt)).toEqual(['Allowed event prompt'])
    expect(pending[0]?.matcherId).toBe(allowed.id)
    expect(pending[0]?.semanticCondition).toBeUndefined()
    expect(effects.script + effects.webhook + effects.secret).toBe(0)
    expect(JSON.stringify(getRoutine(workspaceId, unsafe.id, f.db)?.config)).toBe(before)
  } finally {
    await system.dispose()
  }
})

test('direct legacy script and webhook handlers report unsupported without accessing either executor or outbound endpoint', async () => {
  const matcher: AutomationMatcher = { id: 'stored-fixture', actions: [{ type: 'script', script: 'scripts/preserved.ts' }, { type: 'webhook', url: 'https://fixture.invalid' }] }
  const provider = { getMatchersForEvent: () => [matcher], getConfig: () => ({ automations: { LabelAdd: [matcher] } }) }
  const bus = new WorkspaceEventBus(workspaceId)
  const scripts: ScriptActionResult[] = [], webhooks: WebhookActionResult[] = []
  const script = new ScriptHandler({ workspaceId, workspaceRootPath: '/unused-native-routine-fixture', onScriptResults: (items) => { scripts.push(...items) } }, provider)
  const webhook = new WebhookHandler({ workspaceId, workspaceRootPath: '/unused-native-routine-fixture', onWebhookResults: (items) => { webhooks.push(...items) } }, provider)
  script.subscribe(bus)
  webhook.subscribe(bus)
  try {
    await bounded(bus.emit('LabelAdd', { workspaceId, timestamp: Date.now(), label: 'fixture-label' }))
    expect(effects.script + effects.webhook).toBe(0)
    expect(scripts).toMatchObject([{ success: false, blocked: true }])
    expect(webhooks).toMatchObject([{ success: false, attempts: 0, statusCode: 0 }])
    expect(scripts[0]?.stderr).toContain('unsupported')
    expect(webhooks[0]?.error).toContain('unsupported')
  } finally {
    script.dispose()
    webhook.dispose()
    bus.dispose()
  }
})

async function request(handler: ReturnType<typeof createRoutineWebhookHandler>, id: string, token = 'fixture-token') {
  const stream = new PassThrough()
  const incoming = stream as unknown as IncomingMessage
  incoming.method = 'POST'
  incoming.url = `/api/webhooks/${id}/${token}`
  incoming.headers = { 'content-length': '2' }
  Object.defineProperty(incoming, 'socket', { value: { remoteAddress: 'fixture-address' } })
  let status = 0
  let finish!: (body: string) => void
  const done = new Promise<string>((resolve) => { finish = resolve })
  const fakeResponse = {
    headersSent: false,
    writeHead(code: number): void { status = code; fakeResponse.headersSent = true },
    end(body: string) { finish(body) },
  }
  const response = fakeResponse as unknown as ServerResponse
  handler(incoming, response)
  stream.end('{}')
  const body = JSON.parse(await bounded(done)) as { error?: { code: string; message: string } }
  return { status, body }
}

test('authenticated provider webhook activation is unsupported metadata only, not 202, a prompt, or a mutated config/secret', async () => {
  const f = await fixture()
  const routine = f.add({ type: 'webhook', webhook: { secretId: 'stored-fixture-secret-id' }, actions: [{ type: 'prompt', prompt: 'Must never activate' }] })
  const before = JSON.stringify(routine.config)
  const audit: string[] = []
  const handler = createRoutineWebhookHandler({ runner: () => f.deps, audit: (line) => { audit.push(line) } })
  expect(await request(handler, routine.id)).toMatchObject({ status: 501, body: { error: { code: 'unsupported' } } })
  expect(await request(handler, routine.id, 'wrong-token')).toMatchObject({ status: 404 })
  expect(f.prompts).toEqual([])
  expect(getRoutine(workspaceId, routine.id, f.db)?.runs).toEqual([])
  expect(JSON.stringify(getRoutine(workspaceId, routine.id, f.db)?.config)).toBe(before)
  expect(audit.some((line) => line.includes('unsupported'))).toBe(true)
  expect(audit.join('\n')).not.toContain('fixture-token')
  updateRoutine(workspaceId, routine.id, { paused: true }, f.db)
  expect(await request(handler, routine.id)).toMatchObject({ status: 409 })
  expect(effects.script + effects.webhook).toBe(0)
})

test('manual root invocation cannot convert a stored provider webhook trigger into a supported prompt schedule', async () => {
  const f = await fixture()
  const routine = f.add({ type: 'webhook', webhook: { secretId: 'preserved-fixture-secret-id' }, actions: [{ type: 'prompt', prompt: 'Must not execute' }] })
  await bounded(runRoutine(routine, f.deps)!.done)
  expect(f.prompts).toEqual([])
  expect(getRoutine(workspaceId, routine.id, f.db)?.runs[0]).toMatchObject({ status: 'error', chatId: null })
  expect(effects.script + effects.webhook + effects.secret).toBe(0)
})
