/**
 * Home's pure rules: the greeting, and what each card lists (your open tasks, the chats that need you then the
 * recent ones, the routines of today). The cards read the stores the pages use; nothing here fetches.
 */

import { nextCronRun } from '@otto/shared/automations/cron-matcher'
import type { Routine, RoutineRunStatus } from '@otto/shared/automations/routine-types'
import type { Task } from '../../../shared/types'

export type DayPart = 'morning' | 'afternoon' | 'evening'

/** Morning from 5:00, afternoon from 12:00, evening from 18:00 (and through the night). */
export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 18) return 'afternoon'
  return 'evening'
}

/** The first word of a name ("Ana Lima" is "Ana"); empty for none. An email is not a name. */
export function firstName(name: string | null | undefined): string {
  const first = (name ?? '').trim().split(/\s+/)[0] ?? ''
  return first.includes('@') ? '' : first
}

/**
 * The Tasks card: the open tasks (to do or in progress) assigned to one of `mine` (you and your agents), the
 * soonest due first (no due date last), then the most recently updated.
 */
export function selectMyTasks(tasks: Task[], mine: ReadonlySet<string>): Task[] {
  return tasks
    .filter((task) => (task.status === 'todo' || task.status === 'doing') && task.assignees.some((actor) => mine.has(actor)))
    .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || b.updatedAt - a.updatedAt)
}

interface ChatLike {
  id: string
  isArchived?: boolean
  hasUnread?: boolean
  lastMessageAt?: number
}

/**
 * Chats as Home ranks them: the ones waiting on you (a permission or credential request), then the unread ones,
 * then the rest, each newest message first; archived chats are left out. The composer's Notifications list keeps
 * the first two kinds, the Chats card shows them all.
 */
export function rankChats<T extends ChatLike>(chats: Iterable<T>, isWaiting: (id: string) => boolean): { meta: T; waiting: boolean }[] {
  const rank = (entry: { meta: T; waiting: boolean }) => (entry.waiting ? 0 : entry.meta.hasUnread ? 1 : 2)
  return [...chats]
    .filter((meta) => !meta.isArchived)
    .map((meta) => ({ meta, waiting: isWaiting(meta.id) }))
    .sort((a, b) => rank(a) - rank(b) || (b.meta.lastMessageAt ?? 0) - (a.meta.lastMessageAt ?? 0))
}

export type RoutineTodayStatus = 'scheduled' | Exclude<RoutineRunStatus, 'skipped'>

export interface RoutineToday {
  routine: Routine
  /** When it runs (`scheduled`) or ran, epoch ms. */
  at: number
  status: RoutineTodayStatus
}

/**
 * The Routines card, a timeline of today in the local timezone: each routine's latest run since midnight that ran
 * or is running (any trigger; a skipped one did not run), and each active schedule's next run from now to the end
 * of the day (the cron in its own timezone, `nextCronRun`). A routine can have both. Earliest first.
 */
export function getRoutinesToday(routines: Routine[], now: Date): RoutineToday[] {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  const entries: RoutineToday[] = []
  for (const routine of routines) {
    const ran = routine.runs.find((run) => run.status !== 'skipped' && run.startedAt >= start.getTime() && run.startedAt <= now.getTime())
    if (ran && ran.status !== 'skipped') entries.push({ routine, at: ran.startedAt, status: ran.status })
    const schedule = routine.config.type === 'schedule' ? routine.config.schedule : undefined
    if (routine.pausedAt !== null || !schedule) continue
    const next = nextCronRun(schedule.cron, schedule.timezone, now)
    if (next && next.getTime() < end.getTime()) entries.push({ routine, at: next.getTime(), status: 'scheduled' })
  }
  return entries.sort((a, b) => a.at - b.at)
}
