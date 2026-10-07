import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { Routine, RoutineRun } from '@otto/shared/automations/routine-types'
import type { Task } from '../../../../shared/types'
import { dayPart, firstName, getRoutinesToday, rankChats, selectMyTasks } from '../home-rules'

const at = (h: number, m = 0, day = 7) => new Date(2026, 9, day, h, m).getTime()

function task(id: string, patch: Partial<Task> = {}): Task {
  return { id, projectId: 'p1', title: id, description: '', status: 'todo', dueAt: null, assignees: ['user:me'], resources: [], createdBy: 'user:me', createdAt: 0, updatedAt: 0, ...patch }
}

function routine(id: string, config: Partial<Routine['config']>, runs: Partial<RoutineRun>[] = [], pausedAt: number | null = null): Routine {
  return {
    id,
    workspaceId: 'w1',
    agentId: null,
    title: id,
    config: { type: 'schedule', actions: [], ...config },
    pausedAt,
    createdBy: 'user:me',
    createdAt: 0,
    runs: runs.map((run, i) => ({ id: `${id}-r${i}`, routineId: id, scheduledFor: run.startedAt ?? 0, status: 'ok', chatId: null, error: null, startedAt: 0, ...run })),
  }
}

describe('greeting', () => {
  it('splits the day at 5, 12 and 18', () => {
    expect([4, 5, 11, 12, 17, 18, 23, 0].map(dayPart)).toEqual(['evening', 'morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening', 'evening'])
  })
  it('greets by the first word of the name, never an email', () => {
    expect(firstName('Ana Lima')).toBe('Ana')
    expect(firstName('  Grace ')).toBe('Grace')
    expect(firstName('ana@example.test')).toBe('')
    expect(firstName(undefined)).toBe('')
  })
})

describe('the Tasks card', () => {
  const mine = new Set(['user:me', 'agent:a1'])
  it('keeps open tasks assigned to you or your agents', () => {
    const tasks = [
      task('mine'),
      task('agent', { assignees: ['agent:a1'], status: 'doing' }),
      task('other', { assignees: ['user:ada'] }),
      task('done', { status: 'done' }),
      task('archived', { status: 'archived' }),
      task('nobody', { assignees: [] }),
    ]
    expect(selectMyTasks(tasks, mine).map((t) => t.id)).toEqual(['mine', 'agent'])
  })
  it('orders by due date (none last), then the most recently updated', () => {
    const tasks = [
      task('no-due-old', { updatedAt: 1 }),
      task('due-late', { dueAt: at(20), updatedAt: 1 }),
      task('no-due-new', { updatedAt: 9 }),
      task('due-soon', { dueAt: at(9), updatedAt: 1 }),
      task('due-soon-newer', { dueAt: at(9), updatedAt: 5 }),
    ]
    expect(selectMyTasks(tasks, mine).map((t) => t.id)).toEqual(['due-soon-newer', 'due-soon', 'due-late', 'no-due-new', 'no-due-old'])
  })
})

describe('the Chats card', () => {
  it('ranks waiting, then unread, then the rest, newest first, without archived chats', () => {
    const chats = [
      { id: 'old', lastMessageAt: 1 },
      { id: 'unread', hasUnread: true, lastMessageAt: 2 },
      { id: 'waiting', lastMessageAt: 0 },
      { id: 'new', lastMessageAt: 9 },
      { id: 'archived', isArchived: true, hasUnread: true, lastMessageAt: 10 },
      { id: 'unread-newer', hasUnread: true, lastMessageAt: 5 },
    ]
    const ranked = rankChats(chats, (id) => id === 'waiting')
    expect(ranked.map((c) => c.meta.id)).toEqual(['waiting', 'unread-newer', 'unread', 'new', 'old'])
    expect(ranked[0]!.waiting).toBe(true)
  })
})

describe('the Routines today card', () => {
  // The local timezone here is Berlin (UTC+2 in October), so "today" and a routine's own timezone differ.
  const tz = process.env.TZ
  beforeAll(() => { process.env.TZ = 'Europe/Berlin' })
  afterAll(() => { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz })
  const ids = (routines: Routine[], date = new Date(at(10, 30))) => getRoutinesToday(routines, date).map((e) => `${e.routine.id}:${e.status}:${new Date(e.at).getHours()}:${String(new Date(e.at).getMinutes()).padStart(2, '0')}`)

  it('lists the next run of an active schedule later today, in local time', () => {
    expect(ids([routine('daily', { schedule: { cron: '0 14 * * *' } })])).toEqual(['daily:scheduled:14:00'])
  })
  it('reads the cron in its own timezone (9:00 in New York is 15:00 in Berlin)', () => {
    expect(ids([routine('ny', { schedule: { cron: '0 9 * * *', timezone: 'America/New_York' } })])).toEqual(['ny:scheduled:15:00'])
  })
  it('stops at midnight: a run tomorrow is not today', () => {
    const late = new Date(at(23, 30))
    expect(ids([routine('morning', { schedule: { cron: '0 9 * * *' } })], late)).toEqual([])
    expect(ids([routine('hourly', { schedule: { cron: '0 * * * *' } })], late)).toEqual([])
    expect(ids([routine('soon', { schedule: { cron: '45 23 * * *' } })], late)).toEqual(['soon:scheduled:23:45'])
  })
  it('leaves out paused routines and routines that are not scheduled, unless they ran today', () => {
    expect(ids([routine('paused', { schedule: { cron: '0 14 * * *' } }, [], at(8))])).toEqual([])
    expect(ids([routine('event', { type: 'event', event: 'LabelAdd' })])).toEqual([])
    expect(ids([routine('hook', { type: 'webhook' }, [{ status: 'error', startedAt: at(9, 5) }])])).toEqual(['hook:error:9:05'])
  })
  it('shows the latest run since midnight with its status, and the next run too', () => {
    const r = routine('both', { schedule: { cron: '0 9,14 * * *' } }, [
      { status: 'running', startedAt: at(10, 0) },
      { status: 'ok', startedAt: at(9, 0) },
    ])
    expect(ids([r])).toEqual(['both:running:10:00', 'both:scheduled:14:00'])
  })
  it('skips skipped runs and runs from yesterday', () => {
    const r = routine('night', { schedule: { cron: '59 23 * * *' } }, [
      { status: 'skipped', startedAt: at(1) },
      { status: 'ok', startedAt: at(23, 59, 6) },
    ])
    expect(ids([r])).toEqual(['night:scheduled:23:59'])
  })
  it('orders the day earliest first', () => {
    const routines = [
      routine('b', { schedule: { cron: '0 16 * * *' } }),
      routine('a', { schedule: { cron: '0 12 * * *' } }),
      routine('c', { type: 'event', event: 'LabelAdd' }, [{ status: 'ok', startedAt: at(7, 15) }]),
    ]
    expect(ids(routines)).toEqual(['c:ok:7:15', 'a:scheduled:12:00', 'b:scheduled:16:00'])
  })
})
