import { describe, expect, it } from 'bun:test'
import type { TFunction } from 'i18next'
import {
  actionTypes,
  describeCron,
  describeTrigger,
  getVisibleRoutines,
  lastRun,
  routineState,
  routineType,
  type Routine,
} from '../routine-items'

// The key and its values, so the tests read what was asked for without the locale files.
const t = ((key: string, values?: Record<string, unknown>) =>
  values ? `${key}(${Object.entries(values).map(([k, v]) => `${k}=${v}`).join(',')})` : key) as unknown as TFunction

const make = (id: string, title: string, config: Routine['config'], extra: Partial<Routine> = {}): Routine => ({
  id,
  workspaceId: 'ws',
  agentId: null,
  title,
  config,
  pausedAt: null,
  createdBy: 'user:aaaaaaaaaaaa',
  createdAt: 1,
  runs: [],
  ...extra,
})
const run = (id: string, status: Routine['runs'][number]['status'], startedAt: number): Routine['runs'][number] =>
  ({ id, routineId: 'x', scheduledFor: startedAt, status, chatId: null, error: null, startedAt })

const digest = make('aaaaaaaaaaaa', 'Digest', { type: 'schedule', schedule: { cron: '0 9 * * 1-5', timezone: 'Europe/Berlin' }, actions: [{ type: 'prompt', prompt: 'Sum up' }] })
const sync = make('bbbbbbbbbbbb', 'Sync', { type: 'schedule', schedule: { cron: '*/15 * * * *' }, actions: [{ type: 'script', script: 'scripts/sync.ts' }] }, { pausedAt: 5 })
const triage = make('cccccccccccc', 'Triage', { type: 'event', event: 'LabelAdd', matcher: '^urgent$', actions: [{ type: 'webhook', url: 'https://example.test/hook' }, { type: 'prompt', prompt: 'Look' }] })
const log = make('dddddddddddd', 'Log', { type: 'event', event: 'PostToolUse', actions: [{ type: 'webhook', url: 'https://example.test/log' }] })
const incoming = make('eeeeeeeeeeee', 'Incoming', { type: 'webhook', webhook: { secretId: 's' }, actions: [{ type: 'prompt', prompt: 'x' }] })

describe('routine rules', () => {
  it('sorts routines into their kind', () => {
    expect([digest, triage, log, incoming].map(routineType)).toEqual(['scheduled', 'event', 'agentic', 'event'])
  })

  it('is paused from paused_at, and failing when the last run that ran failed; a skipped or running run does not count', () => {
    expect(routineState(digest)).toBe('active')
    expect(routineState(sync)).toBe('paused')
    expect(routineState({ ...digest, runs: [run('2', 'error', 2), run('1', 'ok', 1)] })).toBe('failing')
    expect(routineState({ ...digest, runs: [run('3', 'skipped', 3), run('2', 'running', 2), run('1', 'ok', 1)] })).toBe('active')
    expect(routineState({ ...sync, runs: [run('2', 'error', 2)] })).toBe('paused')
    expect(lastRun({ ...digest, runs: [run('3', 'running', 3), run('2', 'ok', 2)] })?.id).toBe('2')
  })

  it('lists the kinds of action once, in a fixed order', () => {
    expect(actionTypes(triage)).toEqual(['prompt', 'webhook'])
  })

  it('shows the groups in order, or only the filtered one (the Previous / Next order)', () => {
    const shuffled = [log, triage, sync, digest]
    expect(getVisibleRoutines(shuffled).map((r) => r.id)).toEqual(['bbbbbbbbbbbb', 'aaaaaaaaaaaa', 'cccccccccccc', 'dddddddddddd'])
    expect(getVisibleRoutines(shuffled, 'event').map((r) => r.id)).toEqual(['cccccccccccc'])
  })

  it('describes the trigger: the schedule and its city, or the event and its match', () => {
    expect(describeTrigger(digest, t, 'en-US')).toBe('routines.cronWeekdays(time=9:00 AM) (Berlin)')
    expect(describeTrigger(triage, t, 'en-US')).toBe('routines.eventMatching(event=routines.event_LabelAdd,matcher=^urgent$)')
    expect(describeTrigger(log, t, 'en-US')).toBe('routines.event_PostToolUse')
    expect(describeTrigger(incoming, t, 'en-US')).toBe('routines.triggerWebhook')
  })
})

describe('describeCron', () => {
  const cases: [string, string][] = [
    ['* * * * *', 'routines.cronEveryMinute'],
    ['*/15 * * * *', 'routines.cronEveryMinutes(minutes=15)'],
    ['5 * * * *', 'routines.cronHourly(minute=05)'],
    ['30 18 * * *', 'routines.cronDaily(time=6:30 PM)'],
    ['0 9 * * 0,6', 'routines.cronWeekends(time=9:00 AM)'],
    ['0 9 * * 1', 'routines.cronWeekly(day=Monday,time=9:00 AM)'],
    ['0 9 * * 7', 'routines.cronWeekly(day=Sunday,time=9:00 AM)'],
    ['0 9 1 * *', 'routines.cronMonthly(day=1,time=9:00 AM)'],
    ['0 9 1,15 * *', '0 9 1,15 * *'],
    ['0 9 * 1 *', '0 9 * 1 *'],
    ['0 9-17 * * *', '0 9-17 * * *'],
    ['nonsense', 'nonsense'],
  ]
  for (const [cron, words] of cases) {
    it(cron, () => expect(describeCron(cron, t, 'en-US')).toBe(words))
  }
})
