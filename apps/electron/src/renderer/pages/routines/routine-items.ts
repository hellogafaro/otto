/**
 * Routines as the pages see them, and the pure rules over them: the server's `routines` rows with their runs (newest
 * first), their kind (Scheduled, Event, Agent event: the groups of the index, in this order), their state (active,
 * paused, failing: the last run that ran failed) and their trigger in words. `useRoutines` loads them.
 */

import type { TFunction } from 'i18next'
import type { AutomationFilter, Routine, RoutineAction } from '../../../shared/types'

export type { Routine, RoutineAction }
export type RoutineType = AutomationFilter['automationType']
export type RoutineState = 'active' | 'paused' | 'failing'

/** The groups of the index, in order. */
export const ROUTINE_TYPES: RoutineType[] = ['scheduled', 'event', 'agentic']

/** The events Otto raises itself; every other one comes from the agent. */
const APP_EVENTS = ['LabelAdd', 'LabelRemove', 'LabelConfigChange', 'PermissionModeChange', 'FlagChange', 'SessionStatusChange']

/** The events with a name in `routines.event_*`. */
const NAMED_EVENTS = [
  ...APP_EVENTS,
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Notification', 'UserPromptSubmit', 'SessionStart', 'SessionEnd',
  'Stop', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PermissionRequest', 'Setup',
]

/** Which group a routine is in: a schedule is Scheduled; an event of Otto's own is an Event; any other (and a webhook) an Agent event or Event. */
export function routineType(routine: Routine): RoutineType {
  const { type, event } = routine.config
  if (type === 'schedule') return 'scheduled'
  return type === 'event' && event && !APP_EVENTS.includes(event) ? 'agentic' : 'event'
}

/** The last run that ran (a skipped or running one did not finish a job). */
export function lastRun(routine: Routine): Routine['runs'][number] | undefined {
  return routine.runs.find((run) => run.status === 'ok' || run.status === 'error')
}

export function routineState(routine: Routine): RoutineState {
  if (routine.pausedAt !== null) return 'paused'
  return lastRun(routine)?.status === 'error' ? 'failing' : 'active'
}

/** The routines of each group, oldest first. */
export function groupRoutines(routines: Routine[]): Record<RoutineType, Routine[]> {
  const groups: Record<RoutineType, Routine[]> = { scheduled: [], event: [], agentic: [] }
  for (const routine of routines) groups[routineType(routine)].push(routine)
  return groups
}

/** The routines the index shows under its type filter, in its order: what Previous / Next step through. */
export function getVisibleRoutines(routines: Routine[], type?: RoutineType): Routine[] {
  const groups = groupRoutines(routines)
  return ROUTINE_TYPES.filter((group) => !type || group === type).flatMap((group) => groups[group])
}

/** The distinct kinds of action, in a fixed order (the row's badges). */
export function actionTypes(routine: Routine): RoutineAction['type'][] {
  return (['prompt', 'script', 'webhook'] as const).filter((type) => routine.config.actions.some((action) => action.type === type))
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
  const { type, schedule, event, matcher } = routine.config
  if (type === 'schedule') {
    if (!schedule) return t('routines.type_scheduled')
    const when = describeCron(schedule.cron, t, language)
    return schedule.timezone ? `${when} (${timezoneCity(schedule.timezone)})` : when
  }
  if (type === 'webhook') return t('routines.triggerWebhook')
  if (!event) return t('routines.type_event')
  const name = eventName(event, t)
  return matcher ? t('routines.eventMatching', { event: name, matcher }) : name
}
