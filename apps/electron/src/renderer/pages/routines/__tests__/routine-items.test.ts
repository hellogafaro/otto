import { describe, expect, it } from 'bun:test'
import type { TFunction } from 'i18next'
import {
  actionTypes,
  describeCron,
  describeTrigger,
  getVisibleRoutines,
  parseRoutines,
  routineState,
  routineType,
  type Routine,
} from '../routine-items'

// The key and its values, so the tests read what was asked for without the locale files.
const t = ((key: string, values?: Record<string, unknown>) =>
  values ? `${key}(${Object.entries(values).map(([k, v]) => `${k}=${v}`).join(',')})` : key) as unknown as TFunction

const config = {
  version: 2,
  automations: {
    SchedulerTick: [
      { id: 'aaaaaa', name: 'Digest', cron: '0 9 * * 1-5', timezone: 'Europe/Berlin', actions: [{ type: 'prompt', prompt: 'Sum up' }] },
      { id: 'bbbbbb', cron: '*/15 * * * *', enabled: false, actions: [{ type: 'script', script: 'scripts/sync.ts' }] },
      { name: 'No id', cron: '0 * * * *', actions: [{ type: 'prompt', prompt: 'x' }] },
    ],
    LabelAdd: [{ id: 'cccccc', name: 'Triage', matcher: '^urgent$', actions: [{ type: 'webhook', url: 'https://example.test/hook' }, { type: 'prompt', prompt: 'Look' }] }],
    PostToolUse: [{ id: 'dddddd', name: 'Audit', actions: [{ type: 'unknown' }] }, { id: 'eeeeee', name: 'Log', actions: [{ type: 'webhook', url: 'https://example.test/log' }] }],
  },
}

const withRuns = (routine: Omit<Routine, 'runs'>, runs: Routine['runs'] = []): Routine => ({ ...routine, runs })

describe('parseRoutines', () => {
  const routines = parseRoutines(config)

  it('keeps one routine per matcher with an id and a known action, with its index in its event', () => {
    expect(routines.map((r) => [r.id, r.event, r.matcherIndex, r.type])).toEqual([
      ['aaaaaa', 'SchedulerTick', 0, 'scheduled'],
      ['bbbbbb', 'SchedulerTick', 1, 'scheduled'],
      ['cccccc', 'LabelAdd', 0, 'event'],
      ['eeeeee', 'PostToolUse', 1, 'agentic'],
    ])
  })

  it('names a matcher without a name after its first action, and reads enabled', () => {
    expect(routines[1]).toMatchObject({ name: 'scripts/sync.ts', enabled: false })
    expect(routines[0]).toMatchObject({ name: 'Digest', enabled: true, labels: [] })
  })

  it('is empty without a file or without automations', () => {
    expect(parseRoutines(null)).toEqual([])
    expect(parseRoutines({ version: 2 })).toEqual([])
  })
})

describe('routine rules', () => {
  const [digest, sync, triage, log] = parseRoutines(config).map((r) => withRuns(r))

  it('sorts events into their kind', () => {
    expect([routineType('SchedulerTick'), routineType('FlagChange'), routineType('Stop')]).toEqual(['scheduled', 'event', 'agentic'])
  })

  it('is failing when the last run that ran failed; a skipped run does not count', () => {
    expect(routineState(digest)).toBe('active')
    expect(routineState(sync)).toBe('disabled')
    expect(routineState({ ...digest, runs: [{ ts: 2, ok: false }, { ts: 1, ok: true }] })).toBe('failing')
    expect(routineState({ ...digest, runs: [{ ts: 3, ok: false, skipped: 'no' }, { ts: 1, ok: true }] })).toBe('active')
    expect(routineState({ ...sync, runs: [{ ts: 2, ok: false }] })).toBe('disabled')
  })

  it('lists the kinds of action once, in a fixed order', () => {
    expect(actionTypes(triage)).toEqual(['prompt', 'webhook'])
  })

  it('shows the groups in order, or only the filtered one (the Previous / Next order)', () => {
    const shuffled = [log, triage, sync, digest]
    expect(getVisibleRoutines(shuffled).map((r) => r.id)).toEqual(['bbbbbb', 'aaaaaa', 'cccccc', 'eeeeee'])
    expect(getVisibleRoutines(shuffled, 'event').map((r) => r.id)).toEqual(['cccccc'])
  })

  it('describes the trigger: the schedule and its city, or the event and its match', () => {
    expect(describeTrigger(digest, t, 'en-US')).toBe('routines.cronWeekdays(time=9:00 AM) (Berlin)')
    expect(describeTrigger(triage, t, 'en-US')).toBe('routines.eventMatching(event=routines.event_LabelAdd,matcher=^urgent$)')
    expect(describeTrigger(log, t, 'en-US')).toBe('routines.event_PostToolUse')
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
