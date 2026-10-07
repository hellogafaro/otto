import { expect, test } from 'bun:test'
import { createAgent } from '../agents/index.ts'
import { openDb } from '../db/index.ts'
import { pushSchema } from '../db/push.ts'
import { createWorkspaceMember } from '../workspaces/members.ts'
import { users } from '../users/schema.ts'
import { ROUTINE_RUNS_KEPT, type RoutineConfig } from './routine-types.ts'
import { canEditRoutine, createRoutine, deleteRoutine, getEventRoutines, getRoutine, getRoutines, getScheduledRoutines, startRoutineRun, updateRoutine, updateRoutineRun } from './routines.ts'

const W = 'ws1'
const ME = 'user:aaaaaaaaaaaa'
const schedule: RoutineConfig = { type: 'schedule', schedule: { cron: '0 9 * * 1-5', timezone: 'Europe/Berlin' }, actions: [{ type: 'prompt', prompt: 'Sum up', labels: ['bug'] }] }
const onEvent: RoutineConfig = { type: 'event', event: 'LabelAdd', matcher: '^urgent$', actions: [{ type: 'webhook', url: 'https://example.test/hook', secretId: 's1' }] }

async function setup() {
  const db = openDb(':memory:')
  await pushSchema(db)
  return db
}
const code = (run: () => unknown) => {
  try {
    run()
  } catch (error) {
    return (error as { code?: string }).code
  }
}
const make = (db: Awaited<ReturnType<typeof setup>>, title: string, config: RoutineConfig = schedule, extra: Partial<Parameters<typeof createRoutine>[0]> = {}) =>
  createRoutine({ workspaceId: W, title, config, createdBy: ME, ...extra }, db)

test('create writes every column and reads back with its runs', async () => {
  const db = await setup()
  const routine = make(db, ' Digest ')
  expect(routine.id).toMatch(/^[0-9a-z]{12}$/)
  expect(routine).toMatchObject({ workspaceId: W, agentId: null, title: 'Digest', pausedAt: null, createdBy: ME, runs: [], config: schedule })
  expect(getRoutine(W, routine.id, db)).toEqual(routine)
  expect(getRoutine('other', routine.id, db)).toBeUndefined()
  expect(getRoutines(W, db)).toEqual([routine])
})

test('refuses a bad name, a bad config and an agent of another workspace', async () => {
  const db = await setup()
  expect(code(() => make(db, '  '))).toBe('invalid')
  expect(code(() => make(db, 'x'.repeat(200)))).toBe('invalid')
  expect(code(() => make(db, 'x', { type: 'schedule', actions: [{ type: 'prompt', prompt: 'x' }] }))).toBe('invalid') // no schedule
  expect(code(() => make(db, 'x', { type: 'schedule', schedule: { cron: 'not a cron' }, actions: [{ type: 'prompt', prompt: 'x' }] }))).toBe('invalid')
  expect(code(() => make(db, 'x', { type: 'event', event: 'Nope', actions: [{ type: 'prompt', prompt: 'x' }] }))).toBe('invalid')
  expect(code(() => make(db, 'x', { type: 'event', event: 'LabelAdd', matcher: '(', actions: [{ type: 'prompt', prompt: 'x' }] }))).toBe('invalid')
  expect(code(() => make(db, 'x', { type: 'event', event: 'LabelAdd', actions: [] }))).toBe('invalid')
  expect(code(() => make(db, 'x', { ...onEvent, actions: [{ type: 'webhook', url: 'https://x.test', auth: { type: 'bearer', token: 't' } } as never] }))).toBe('invalid') // credentials are secrets
  const other = createAgent({ workspaceId: 'ws2', title: 'Other', provider: 'p', createdBy: ME }, db)
  expect(code(() => make(db, 'x', schedule, { agentId: other.id }))).toBe('invalid')
  expect(getRoutines(W, db)).toEqual([])
})

test('a routine runs on an agent of its workspace, the default when none', async () => {
  const db = await setup()
  const agent = createAgent({ workspaceId: W, title: 'Researcher', provider: 'p', createdBy: ME }, db)
  const routine = make(db, 'On B', schedule, { agentId: agent.id })
  expect(routine.agentId).toBe(agent.id)
  expect(updateRoutine(W, routine.id, { agentId: null }, db).agentId).toBeNull()
})

test('pause sets paused_at once, resume clears it, and nothing else changes', async () => {
  const db = await setup()
  const routine = make(db, 'Digest')
  const paused = updateRoutine(W, routine.id, { paused: true }, db)
  expect(paused.pausedAt).toBeGreaterThan(0)
  expect({ ...paused, pausedAt: null }).toEqual(routine)
  expect(updateRoutine(W, routine.id, { paused: true }, db).pausedAt).toBe(paused.pausedAt) // pausing a paused one keeps the first time
  expect(updateRoutine(W, routine.id, { paused: false }, db).pausedAt).toBeNull()
  expect(make(db, 'Born paused', schedule, { paused: true }).pausedAt).not.toBeNull()
})

test('update replaces the given fields and refuses an unknown routine', async () => {
  const db = await setup()
  const routine = make(db, 'Digest')
  const updated = updateRoutine(W, routine.id, { title: 'Weekly', config: onEvent }, db)
  expect(updated).toMatchObject({ title: 'Weekly', config: onEvent, createdAt: routine.createdAt })
  expect(code(() => updateRoutine(W, 'nope', { title: 'x' }, db))).toBe('not_found')
  expect(code(() => updateRoutine('other', routine.id, { title: 'x' }, db))).toBe('not_found')
  expect(code(() => updateRoutine(W, routine.id, { title: '' }, db))).toBe('invalid')
})

test("a change by someone other than the creator makes the routine theirs; the creator's own change keeps it", async () => {
  const db = await setup()
  const routine = make(db, 'Digest')
  expect(routine.createdBy).toBe(ME)
  expect(updateRoutine(W, routine.id, { title: 'Mine still', by: ME }, db).createdBy).toBe(ME)
  const OWNER = 'user:owner'
  expect(updateRoutine(W, routine.id, { paused: true, by: OWNER }, db).createdBy).toBe(OWNER)
  expect(getRoutine(W, routine.id, db)?.createdBy).toBe(OWNER)
  // without an actor (the importer, a test) nothing moves
  expect(updateRoutine(W, routine.id, { paused: false }, db).createdBy).toBe(OWNER)
})

test('delete removes the routine and its runs, in its workspace only', async () => {
  const db = await setup()
  const routine = make(db, 'Digest')
  startRoutineRun(routine, 1000, {}, db)
  expect(code(() => deleteRoutine('other', routine.id, db))).toBe('not_found')
  deleteRoutine(W, routine.id, db)
  expect(getRoutines(W, db)).toEqual([])
  expect(db.$client.query('select count(*) as n from routines_history').get()).toEqual({ n: 0 })
  expect(code(() => deleteRoutine(W, routine.id, db))).toBe('not_found')
})

test('the scheduler sees active schedule routines of every workspace, an event listener its active routines for the event', async () => {
  const db = await setup()
  const a = make(db, 'A')
  const b = createRoutine({ workspaceId: 'ws2', title: 'B', config: schedule, createdBy: ME }, db)
  const paused = make(db, 'Paused', schedule, { paused: true })
  const event = make(db, 'Event', onEvent)
  const pausedEvent = make(db, 'Paused event', onEvent, { paused: true })
  expect(getScheduledRoutines(db).map((r) => r.id).sort()).toEqual([a.id, b.id].sort())
  expect(getEventRoutines(W, 'LabelAdd', db).map((r) => r.id)).toEqual([event.id])
  expect(getEventRoutines(W, 'LabelRemove', db)).toEqual([])
  expect(getEventRoutines('ws2', 'LabelAdd', db)).toEqual([])
  expect([paused.id, pausedEvent.id].some((id) => getScheduledRoutines(db).some((r) => r.id === id))).toBe(false)
})

test('a run is unique per routine and time: the second insert for a minute does not start', async () => {
  const db = await setup()
  const routine = make(db, 'Digest')
  const first = startRoutineRun(routine, 60_000, {}, db)
  expect(first).toMatchObject({ routineId: routine.id, scheduledFor: 60_000, status: 'running', chatId: null, error: null })
  expect(startRoutineRun(routine, 60_000, {}, db)).toBeUndefined()
  expect(startRoutineRun(routine, 120_000, {}, db)).toBeDefined()
  expect(startRoutineRun({ id: 'other', workspaceId: W }, 60_000, {}, db)).toBeDefined() // per routine
  // a run with no schedule is never refused: its time moves on by a millisecond
  expect(startRoutineRun(routine, 60_000, { bump: true }, db)?.scheduledFor).toBe(60_001)
  updateRoutineRun(first!.id, { status: 'ok', chatId: 'chat1' }, db)
  expect(getRoutine(W, routine.id, db)!.runs.find((run) => run.id === first!.id)).toMatchObject({ status: 'ok', chatId: 'chat1' })
})

test('only the newest 20 runs of a routine are kept, newest first', async () => {
  const db = await setup()
  const routine = make(db, 'Digest')
  const other = make(db, 'Other')
  startRoutineRun(other, 1, {}, db)
  for (let i = 1; i <= ROUTINE_RUNS_KEPT + 5; i++) {
    startRoutineRun(routine, i * 60_000, {}, db)
    await Bun.sleep(2) // started_at orders the history
  }
  const runs = getRoutine(W, routine.id, db)!.runs
  expect(runs).toHaveLength(ROUTINE_RUNS_KEPT)
  expect(runs[0]!.scheduledFor).toBe((ROUTINE_RUNS_KEPT + 5) * 60_000)
  expect(runs.at(-1)!.scheduledFor).toBe(6 * 60_000)
  expect(getRoutine(W, other.id, db)!.runs).toHaveLength(1) // another routine's history is not trimmed
})

test('who may change a routine: its creator or an owner of its workspace', async () => {
  const db = await setup()
  const now = new Date()
  for (const id of ['aaaaaaaaaaaa', 'bbbbbbbbbbbb', 'cccccccccccc']) db.insert(users).values({ id, name: id, email: `${id}@x.test`, createdAt: now, updatedAt: now }).run()
  createWorkspaceMember(W, 'aaaaaaaaaaaa', 'owner', db)
  createWorkspaceMember(W, 'bbbbbbbbbbbb', 'member', db)
  createWorkspaceMember(W, 'cccccccccccc', 'member', db)
  const routine = createRoutine({ workspaceId: W, title: 'Mine', config: schedule, createdBy: 'user:bbbbbbbbbbbb' }, db)
  expect(canEditRoutine(W, routine, 'bbbbbbbbbbbb', db)).toBe(true) // its creator
  expect(canEditRoutine(W, routine, 'aaaaaaaaaaaa', db)).toBe(true) // an owner
  expect(canEditRoutine(W, routine, 'cccccccccccc', db)).toBe(false) // another member
  expect(canEditRoutine('ws2', routine, 'aaaaaaaaaaaa', db)).toBe(false) // an owner elsewhere
})
