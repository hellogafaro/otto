import { expect, test } from 'bun:test'
import { openDb } from '../db/index.ts'
import { pushSchema } from '../db/push.ts'
import { finishInterruptedRoutineRuns, isNativeRoutineConfigSupported, recordRoutineRun, runRoutine, startRoutineScheduler, tickRoutines, type RoutineRunnerDeps } from './routine-runner.ts'
import type { RoutineConfig } from './routine-types.ts'
import { createRoutine, getRoutine, startRoutineRun, updateRoutine } from './routines.ts'

const W = 'ws1'
const ME = 'user:aaaaaaaaaaaa'
// 2026-10-05 (a Monday) 09:00 in Berlin (UTC+2) is 07:00 UTC.
const MONDAY_9_BERLIN = Date.UTC(2026, 9, 5, 7, 0, 0)
const daily: RoutineConfig = { type: 'schedule', schedule: { cron: '0 9 * * 1-5', timezone: 'Europe/Berlin' }, actions: [{ type: 'prompt', prompt: 'Sum up' }] }

async function setup() {
  const db = openDb(':memory:')
  await pushSchema(db)
  const prompts: { routine: string; prompt: string; workspaceRootPath: string }[] = []
  const changes: string[] = []
  const deps: RoutineRunnerDeps = {
    db,
    getWorkspaceRootPath: () => '/tmp/ws1',
    onChange: (workspaceId) => void changes.push(workspaceId),
    runPrompt: async ({ routine, action, workspaceRootPath }) => {
      prompts.push({ routine: routine.id, prompt: action.prompt, workspaceRootPath })
      return { chatId: `chat-${prompts.length}` }
    },
  }
  return { db, deps, prompts, changes }
}
const make = (db: Awaited<ReturnType<typeof setup>>['db'], title: string, config: RoutineConfig = daily, paused = false) =>
  createRoutine({ workspaceId: W, title, config, createdBy: ME, paused }, db)
const settle = (handles: { done: Promise<void> }[]) => Promise.all(handles.map((handle) => handle.done))

test('a schedule fires once in its minute, across two ticks and two instances', async () => {
  const { db, deps, prompts } = await setup()
  const routine = make(db, 'Digest')
  const second: RoutineRunnerDeps = { ...deps, runPrompt: async () => ({ chatId: 'from-the-other-node' }) } // another instance on the same database

  const first = tickRoutines(MONDAY_9_BERLIN + 5_000, deps)
  expect(first).toHaveLength(1)
  expect(tickRoutines(MONDAY_9_BERLIN + 40_000, deps)).toHaveLength(0) // the same minute again
  expect(tickRoutines(MONDAY_9_BERLIN, second)).toHaveLength(0) // the other instance lost the insert
  await settle(first)

  expect(prompts).toEqual([{ routine: routine.id, prompt: 'Sum up', workspaceRootPath: '/tmp/ws1' }])
  const [run, ...rest] = getRoutine(W, routine.id, db)!.runs
  expect(rest).toEqual([])
  expect(run).toMatchObject({ status: 'ok', chatId: 'chat-1', error: null, scheduledFor: MONDAY_9_BERLIN })

  // the next due minute is a new run
  const tuesday = MONDAY_9_BERLIN + 24 * 3_600_000
  await settle(tickRoutines(tuesday, deps))
  expect(prompts).toHaveLength(2)
  expect(getRoutine(W, routine.id, db)!.runs).toHaveLength(2)
})

test('it fires only in the minutes its cron names, in its timezone', async () => {
  const { db, deps, prompts } = await setup()
  make(db, 'Digest')
  expect(tickRoutines(MONDAY_9_BERLIN - 60_000, deps)).toHaveLength(0) // 08:59 Berlin
  expect(tickRoutines(MONDAY_9_BERLIN + 60_000, deps)).toHaveLength(0) // 09:01
  expect(tickRoutines(MONDAY_9_BERLIN + 5 * 24 * 3_600_000, deps)).toHaveLength(0) // a Saturday
  expect(prompts).toEqual([])
})

test('a paused routine does not fire, and fires again once resumed', async () => {
  const { db, deps } = await setup()
  const routine = make(db, 'Digest', daily, true)
  expect(tickRoutines(MONDAY_9_BERLIN, deps)).toHaveLength(0)
  expect(getRoutine(W, routine.id, db)!.runs).toEqual([])
  updateRoutine(W, routine.id, { paused: false }, db)
  expect(tickRoutines(MONDAY_9_BERLIN, deps)).toHaveLength(1)
})

test('conditions that do not hold in the minute leave no run', async () => {
  const { db, deps } = await setup()
  make(db, 'Evenings', { ...daily, conditions: [{ condition: 'time', after: '18:00', before: '23:00', timezone: 'Europe/Berlin' }] })
  expect(tickRoutines(MONDAY_9_BERLIN, deps)).toHaveLength(0)
})

test('the run row follows the run: running, then ok with its chat, and the workspace is told twice', async () => {
  const { db, deps, changes } = await setup()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const routine = make(db, 'Slow')
  const handle = runRoutine(routine, { ...deps, runPrompt: async () => (await gate, { chatId: 'c1' }) })!
  expect(getRoutine(W, routine.id, db)!.runs[0]).toMatchObject({ id: handle.run.id, status: 'running', chatId: null })
  expect(changes).toEqual([W])
  release()
  await handle.done
  expect(getRoutine(W, routine.id, db)!.runs[0]).toMatchObject({ status: 'ok', chatId: 'c1' })
  expect(changes).toEqual([W, W])
})

test('Run now always starts, even twice in the same millisecond', async () => {
  const { db, deps } = await setup()
  const routine = make(db, 'Digest')
  const a = runRoutine(routine, deps)
  const b = runRoutine(routine, deps)
  expect(a && b).toBeTruthy()
  await settle([a!, b!])
  expect(getRoutine(W, routine.id, db)!.runs).toHaveLength(2)
})

test('a failing prompt ends the run as error with the message, and the others still run', async () => {
  const { db, deps } = await setup()
  const routine = make(db, 'Two', { ...daily, actions: [{ type: 'prompt', prompt: 'bad' }, { type: 'prompt', prompt: 'good' }] })
  const seen: string[] = []
  const handle = runRoutine(routine, { ...deps, runPrompt: async ({ action }) => { seen.push(action.prompt); if (action.prompt === 'bad') throw new Error('No connection'); return { chatId: 'c2' } } })!
  await handle.done
  expect(seen).toEqual(['bad', 'good'])
  expect(getRoutine(W, routine.id, db)!.runs[0]).toMatchObject({ status: 'error', error: 'No connection', chatId: 'c2' })
})

test('scripts and webhooks are unsupported through the common run path without reading their secret', async () => {
  const { db, deps } = await setup()
  let secretsRead = 0
  const script = runRoutine(make(db, 'Script', { ...daily, actions: [{ type: 'script', script: 'scripts/missing.ts' }] }), { ...deps, getWorkspaceRootPath: () => '/nonexistent' })!
  const hook = runRoutine(make(db, 'Hook', { type: 'event', event: 'LabelAdd', actions: [{ type: 'webhook', url: 'https://example.test', secretId: 'gone' }] }), { ...deps, getSecret: () => { secretsRead++; return undefined } })!
  await settle([script, hook])
  for (const routine of [getRoutine(W, script.run.routineId, db)!, getRoutine(W, hook.run.routineId, db)!]) {
    expect(routine.runs[0]!.status).toBe('error')
    expect(routine.runs[0]!.error).toContain('unsupported')
  }
  expect(secretsRead).toBe(0)
})

test('a semantic condition that says no skips the run with its reason', async () => {
  const { db, deps, prompts } = await setup()
  const routine = make(db, 'Judged', { ...daily, semanticCondition: { question: 'Anything new?' } })
  await settle(tickRoutines(MONDAY_9_BERLIN, { ...deps, shouldRun: async () => ({ run: false, reason: 'condition not met' }) }))
  expect(prompts).toEqual([])
  expect(getRoutine(W, routine.id, db)!.runs[0]).toMatchObject({ status: 'skipped', error: 'condition not met' })
})

test('native eligibility rejects stored webhook credentials without converting or discarding them', () => {
  const config: RoutineConfig = { ...daily, actions: [{ type: 'webhook', url: 'https://x.test', secretId: 's1' }] }
  expect(isNativeRoutineConfigSupported(config)).toBe(false)
  expect(config.actions).toEqual([{ type: 'webhook', url: 'https://x.test', secretId: 's1' }])
  expect(isNativeRoutineConfigSupported(daily)).toBe(true)
})

test('the scheduler ends the runs a restart left running, and stops', async () => {
  const { db, deps } = await setup()
  const routine = make(db, 'Digest')
  startRoutineRun(routine, 1000, {}, db)
  const stop = startRoutineScheduler(deps)
  expect(getRoutine(W, routine.id, db)!.runs[0]).toMatchObject({ status: 'error', error: 'Interrupted by a restart' })
  stop()
  expect(finishInterruptedRoutineRuns(db)).toBe(0)
})

test('an event routine\'s prompt run is a running row at its start and ok or error at its end, and the page is told both times', async () => {
  const { db, changes } = await setup()
  const routine = make(db, 'On label', { type: 'event', event: 'LabelAdd', actions: [{ type: 'prompt', prompt: 'Look' }] })

  let release: (value: { chatId: string }) => void = () => {}
  const working = recordRoutineRun(routine, () => new Promise((resolve) => (release = resolve)), (workspaceId) => void changes.push(workspaceId), db)
  expect(getRoutine(W, routine.id, db)!.runs[0]).toMatchObject({ status: 'running', chatId: null })
  expect(changes).toEqual([W])
  release({ chatId: 'chat-9' })
  await working
  expect(getRoutine(W, routine.id, db)!.runs[0]).toMatchObject({ status: 'ok', chatId: 'chat-9' })
  expect(changes).toEqual([W, W])

  await expect(recordRoutineRun(routine, async () => { throw new Error('Connect Claude') }, (workspaceId) => void changes.push(workspaceId), db)).rejects.toThrow('Connect Claude')
  expect(getRoutine(W, routine.id, db)!.runs[0]).toMatchObject({ status: 'error', error: 'Connect Claude' })
  expect(changes).toHaveLength(4)
})
