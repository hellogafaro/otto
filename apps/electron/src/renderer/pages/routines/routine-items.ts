/**
 * Routines as the pages see them, and the pure rules over them: one routine per matcher of `automations.json`
 * (the server's file today; `routines` + `routines_runs` later, behind the same RPCs), its runs newest first,
 * its kind (Scheduled, Event, Agent event: the groups of the index, in this order), its state (active,
 * disabled, failing: the last run that ran failed) and its trigger in words. `useRoutines` loads them.
 */

import type { TFunction } from 'i18next'
import type { AutomationFilter, PermissionMode, TestAutomationAction } from '../../../shared/types'

export type RoutineType = AutomationFilter['automationType']
export type RoutineAction = TestAutomationAction
export type RoutineState = 'active' | 'disabled' | 'failing'

export interface RoutineRun {
  ts: number
  ok: boolean
  /** The chat a prompt run created. */
  sessionId?: string
  error?: string
  /** Why it did not run (its condition was not met). */
  skipped?: string
}

export interface Routine {
  /** The matcher's 6-hex id. */
  id: string
  /** The event it listens to (`SchedulerTick` for a schedule); with `matcherIndex`, what the write RPCs take. */
  event: string
  matcherIndex: number
  name: string
  type: RoutineType
  cron?: string
  timezone?: string
  /** A regex on the event's data (events only). */
  matcher?: string
  labels: string[]
  enabled: boolean
  actions: RoutineAction[]
  /** How its chats run, and the Telegram topic they post to: passed on by Run now. */
  permissionMode?: PermissionMode
  telegramTopic?: string
  /** Newest first, at most the server's 20. */
  runs: RoutineRun[]
}

/** The groups of the index, in order. */
export const ROUTINE_TYPES: RoutineType[] = ['scheduled', 'event', 'agentic']

/** The events Otto raises itself; every other one comes from the agent. */
const APP_EVENTS = ['LabelAdd', 'LabelRemove', 'LabelConfigChange', 'PermissionModeChange', 'FlagChange', 'SessionStatusChange', 'SchedulerTick']

/** The events with a name in `routines.event_*`. */
const NAMED_EVENTS = [
  ...APP_EVENTS.filter((event) => event !== 'SchedulerTick'),
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Notification', 'UserPromptSubmit', 'SessionStart', 'SessionEnd',
  'Stop', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PermissionRequest', 'Setup',
]

export function routineType(event: string): RoutineType {
  return event === 'SchedulerTick' ? 'scheduled' : APP_EVENTS.includes(event) ? 'event' : 'agentic'
}

type RawMatcher = {
  id?: string
  name?: string
  cron?: string
  timezone?: string
  matcher?: string
  labels?: string[]
  enabled?: boolean
  permissionMode?: PermissionMode
  telegramTopic?: string
  actions?: { type?: string; prompt?: string; url?: string; script?: string }[]
}

/** A name for a matcher that has none: its first prompt's start, its webhook's URL or its script. */
function fallbackName(actions: RoutineAction[]): string {
  const first = actions[0]
  const text = first.type === 'prompt' ? first.prompt : first.type === 'webhook' ? first.url : first.script
  const line = text.trim().split('\n')[0] ?? ''
  return line.length > 60 ? `${line.slice(0, 60)}…` : line
}

/**
 * `automations.json` (as `getAutomations` returns it; null when there is none) as routines, in the file's order.
 * A matcher without an id or without a known action is left out: the write RPCs and the history need the id.
 */
export function parseRoutines(config: unknown): Omit<Routine, 'runs'>[] {
  const events = (config as { automations?: Record<string, unknown> } | null)?.automations
  if (!events || typeof events !== 'object') return []
  const routines: Omit<Routine, 'runs'>[] = []
  for (const [event, matchers] of Object.entries(events)) {
    if (!Array.isArray(matchers)) continue
    matchers.forEach((raw: RawMatcher, matcherIndex) => {
      const actions = (raw?.actions ?? []).filter((action): action is RoutineAction =>
        (action.type === 'prompt' && typeof action.prompt === 'string')
        || (action.type === 'webhook' && typeof action.url === 'string')
        || (action.type === 'script' && typeof action.script === 'string'))
      if (!raw?.id || actions.length === 0) return
      routines.push({
        id: raw.id,
        event,
        matcherIndex,
        name: raw.name?.trim() || fallbackName(actions),
        type: routineType(event),
        cron: raw.cron,
        timezone: raw.timezone,
        matcher: raw.matcher,
        labels: raw.labels ?? [],
        enabled: raw.enabled !== false,
        actions,
        permissionMode: raw.permissionMode,
        telegramTopic: raw.telegramTopic,
      })
    })
  }
  return routines
}

/** The last run that ran (a skipped one did nothing). */
export function lastRun(routine: Routine): RoutineRun | undefined {
  return routine.runs.find((run) => !run.skipped)
}

export function routineState(routine: Routine): RoutineState {
  if (!routine.enabled) return 'disabled'
  return lastRun(routine)?.ok === false ? 'failing' : 'active'
}

/** The routines of each group, in the file's order. */
export function groupRoutines(routines: Routine[]): Record<RoutineType, Routine[]> {
  const groups: Record<RoutineType, Routine[]> = { scheduled: [], event: [], agentic: [] }
  for (const routine of routines) groups[routine.type].push(routine)
  return groups
}

/** The routines the index shows under its type filter, in its order: what Previous / Next step through. */
export function getVisibleRoutines(routines: Routine[], type?: RoutineType): Routine[] {
  const groups = groupRoutines(routines)
  return ROUTINE_TYPES.filter((group) => !type || group === type).flatMap((group) => groups[group])
}

/** The distinct kinds of action, in a fixed order (the row's badges). */
export function actionTypes(routine: Routine): RoutineAction['type'][] {
  return (['prompt', 'script', 'webhook'] as const).filter((type) => routine.actions.some((action) => action.type === type))
}

const NUMBER = /^\d+$/

/**
 * A 5-field cron in words ("Weekdays at 9:00 AM"), in the UI language; the expression itself when it is not one of
 * the common shapes (every N minutes, hourly, daily, weekdays, weekends, one weekday, one day of the month).
 */
export function describeCron(cron: string, t: TFunction, language: string): string {
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5) return cron
  const [minute, hour, day, month, weekday] = fields as [string, string, string, string, string]
  if (month !== '*') return cron
  if (fields.every((field) => field === '*')) return t('routines.cronEveryMinute')
  const every = /^\*\/(\d+)$/.exec(minute)
  if (every && hour === '*' && day === '*' && weekday === '*') return t('routines.cronEveryMinutes', { minutes: Number(every[1]) })
  if (!NUMBER.test(minute)) return cron
  if (hour === '*' && day === '*' && weekday === '*') return t('routines.cronHourly', { minute: minute.padStart(2, '0') })
  if (!NUMBER.test(hour)) return cron
  const at = new Date(2000, 0, 2, Number(hour), Number(minute))
  const time = new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' }).format(at)
  if (day === '*' && weekday === '*') return t('routines.cronDaily', { time })
  if (day === '*' && (weekday === '1-5' || weekday === 'MON-FRI')) return t('routines.cronWeekdays', { time })
  if (day === '*' && (weekday === '0,6' || weekday === '6,0')) return t('routines.cronWeekends', { time })
  if (day === '*' && /^[0-7]$/.test(weekday)) {
    // Jan 2 2000 was a Sunday (cron's 0 and 7).
    const name = new Intl.DateTimeFormat(language, { weekday: 'long' }).format(new Date(2000, 0, 2 + (Number(weekday) % 7)))
    return t('routines.cronWeekly', { day: name, time })
  }
  if (weekday === '*' && NUMBER.test(day)) return t('routines.cronMonthly', { day: Number(day), time })
  return cron
}

/** A timezone's city ("Europe/Berlin" is "Berlin"). */
export function timezoneCity(timezone: string): string {
  return (timezone.split('/').pop() ?? timezone).replace(/_/g, ' ')
}

/** The event's name in words ("Label added"); an unknown event keeps its own name. */
export function eventName(event: string, t: TFunction): string {
  return NAMED_EVENTS.includes(event) ? t(`routines.event_${event}`) : event
}

/** What starts it, in words: the schedule (and its timezone's city), or the event (and what it must match). */
export function describeTrigger(routine: Routine, t: TFunction, language: string): string {
  if (routine.type === 'scheduled') {
    if (!routine.cron) return t('routines.type_scheduled')
    const when = describeCron(routine.cron, t, language)
    return routine.timezone ? `${when} (${timezoneCity(routine.timezone)})` : when
  }
  const event = eventName(routine.event, t)
  return routine.matcher ? t('routines.eventMatching', { event, matcher: routine.matcher }) : event
}
