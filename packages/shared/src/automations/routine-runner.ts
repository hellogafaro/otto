import { eq } from 'drizzle-orm'
import { initDb, type Db } from '../db/index.ts'
import { getWorkspaceRootPath } from '../config/storage.ts'
import { evaluateConditions } from './conditions.ts'
import { matchesCron } from './cron-matcher.ts'
import { routinesHistory } from './schema.ts'
import { getScheduledRoutines, startRoutineRun, updateRoutineRun } from './routines.ts'
import type { Routine, RoutineConfig, RoutineRun } from './routine-types.ts'
import type { PromptAction } from './types.ts'

/**
 * Running a routine: one path for the scheduler's tick and for a person's "Run now". A run is its `routines_history`
 * row: `startRoutineRun` inserts it as `running` (the unique key on `(routine_id, scheduled_for)` lets exactly one
 * tick, restart or node win a schedule's minute), the actions run in the background, and the row ends `ok`, `error`
 * or `skipped`. Starting a chat is the host's (`runPrompt`): this domain does not know sessions.
 */

export interface RoutineRunnerDeps {
  /** Starts a chat for a prompt action of the routine (owned by its creator, on its agent) and resolves with its id once the chat's turn has ended. */
  runPrompt(input: { routine: Routine; action: PromptAction; workspaceRootPath: string }): Promise<{ chatId: string }>
  /** The decision model's verdict on the routine's `semanticCondition`; `run: false` skips the run with the reason. */
  shouldRun?(routine: Routine): Promise<{ run: boolean; reason?: string }>
  /** Called when a run starts and when it ends, so the host can tell the workspace's clients (`domain:changed`). */
  onChange?(workspaceId: string): void
  db?: Db
  /** Reads an existing incoming webhook credential for authentication; never executes a webhook action. */
  getSecret?: (id: string) => string | undefined
  /** A workspace's root folder for the native prompt runner; default the registry's. */
  getWorkspaceRootPath?: (workspaceId: string) => string | null
}

export interface RoutineRunHandle {
  run: RoutineRun
  /** Resolves when the run has ended and its row is final; never rejects. */
  done: Promise<void>
}

const ERROR_MAX = 2000

export const UNSUPPORTED_NATIVE_ROUTINE = 'Script actions and webhook actions or triggers are unsupported in the native runtime. Stored configurations are preserved; only prompt schedule and event routines can run.'

export function isNativeRoutineConfigSupported(config: Pick<RoutineConfig, 'type' | 'actions'>): boolean {
  return (config.type === 'schedule' || config.type === 'event') && Array.isArray(config.actions) && config.actions.length > 0 && config.actions.every((action) => action?.type === 'prompt')
}

const clip = (text: string) => text.slice(0, ERROR_MAX)

async function runActions(routine: Routine, deps: RoutineRunnerDeps): Promise<{ status: 'ok' | 'error'; chatId?: string; error?: string }> {
  if (!isNativeRoutineConfigSupported(routine.config)) return { status: 'error', error: UNSUPPORTED_NATIVE_ROUTINE }
  const rootPath = (deps.getWorkspaceRootPath ?? getWorkspaceRootPath)(routine.workspaceId)
  if (!rootPath) return { status: 'error', error: 'The workspace is gone' }
  const errors: string[] = []
  let chatId: string | undefined
  for (const action of routine.config.actions) {
    if (action.type !== 'prompt') return { status: 'error', chatId, error: UNSUPPORTED_NATIVE_ROUTINE }
    try {
      const started = await deps.runPrompt({ routine, action, workspaceRootPath: rootPath })
      chatId ??= started.chatId
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  return errors.length ? { status: 'error', chatId, error: clip(errors.join('; ')) } : { status: 'ok', chatId }
}

async function finishRun(routine: Routine, run: RoutineRun, deps: RoutineRunnerDeps): Promise<void> {
  const db = deps.db ?? initDb()
  try {
    if (!isNativeRoutineConfigSupported(routine.config)) throw new Error(UNSUPPORTED_NATIVE_ROUTINE)
    const verdict = routine.config.semanticCondition ? await deps.shouldRun?.(routine) : undefined
    const outcome = verdict && !verdict.run ? { status: 'skipped' as const, error: verdict.reason ?? null } : await runActions(routine, deps)
    updateRoutineRun(run.id, outcome, db)
  } catch (error) {
    updateRoutineRun(run.id, { status: 'error', error: clip(error instanceof Error ? error.message : String(error)) }, db)
  }
  deps.onChange?.(routine.workspaceId)
}

/**
 * Starts one run of a routine in the background. `scheduledFor` is the cron minute of a schedule run: a run that
 * exists for it already means another tick or node has it, and nothing starts (undefined). Without it (a person's
 * Run now, an event) the run is stamped with now and always starts.
 */
export function runRoutine(routine: Routine, deps: RoutineRunnerDeps, scheduledFor?: number): RoutineRunHandle | undefined {
  const run = startRoutineRun(routine, scheduledFor ?? Date.now(), { bump: scheduledFor === undefined }, deps.db ?? initDb())
  if (!run) return undefined
  deps.onChange?.(routine.workspaceId)
  if (!isNativeRoutineConfigSupported(routine.config)) {
    updateRoutineRun(run.id, { status: 'error', error: UNSUPPORTED_NATIVE_ROUTINE }, deps.db ?? initDb())
    deps.onChange?.(routine.workspaceId)
    return { run: { ...run, status: 'error', error: UNSUPPORTED_NATIVE_ROUTINE }, done: Promise.resolve() }
  }
  return { run, done: finishRun(routine, run, deps) }
}

/**
 * Records the prompt run of an event routine (the session manager's event bus runs it, not `runRoutine`) around `work`:
 * a `running` row now, `ok` with its chat or `error` when `work` settles, and `onChange` at both ends so the page
 * follows live. Rethrows what `work` threw, after the row ends.
 */
export async function recordRoutineRun(routine: Pick<Routine, 'id' | 'workspaceId' | 'config'>, work: () => Promise<{ chatId: string }>, onChange?: (workspaceId: string) => void, db: Db = initDb()): Promise<void> {
  const run = startRoutineRun(routine, Date.now(), { bump: true }, db)
  onChange?.(routine.workspaceId)
  try {
    if (!isNativeRoutineConfigSupported(routine.config)) throw new Error(UNSUPPORTED_NATIVE_ROUTINE)
    const { chatId } = await work()
    if (run) updateRoutineRun(run.id, { status: 'ok', chatId }, db)
  } catch (error) {
    if (run) updateRoutineRun(run.id, { status: 'error', error: clip(error instanceof Error ? error.message : String(error)) }, db)
    throw error
  } finally {
    onChange?.(routine.workspaceId)
  }
}

/** The minute `now` falls in (ms). */
const minuteOf = (now: number) => Math.floor(now / 60_000) * 60_000

/**
 * One tick: starts every active schedule routine due in the minute of `now`, once (see `runRoutine`). A routine whose
 * conditions do not hold in that minute does not run and leaves no row.
 */
export function tickRoutines(now: number, deps: RoutineRunnerDeps): RoutineRunHandle[] {
  const minute = minuteOf(now)
  const started: RoutineRunHandle[] = []
  for (const routine of getScheduledRoutines(deps.db ?? initDb())) {
    const { cron, timezone } = routine.config.schedule!
    if (!matchesCron(cron, timezone, new Date(minute))) continue
    const { conditions } = routine.config
    if (conditions?.length && !evaluateConditions(conditions, { payload: {}, now: new Date(minute), matcherTimezone: timezone })) continue
    const handle = runRoutine(routine, deps, minute)
    if (handle) started.push(handle)
  }
  return started
}

/** Ends the runs a restart left `running` (their process is gone). */
export function finishInterruptedRoutineRuns(db: Db = initDb()): number {
  return db
    .update(routinesHistory)
    .set({ status: 'error', error: 'Interrupted by a restart' })
    .where(eq(routinesHistory.status, 'running'))
    .returning({ id: routinesHistory.id })
    .all().length
}

/**
 * The scheduler: one in-process ticker, aligned to the minute, that fires the due schedule routines of every
 * workspace. Returns its stop function. Runs a restart interrupted are ended first.
 */
export function startRoutineScheduler(deps: RoutineRunnerDeps, log: { warn: (message: string, error?: unknown) => void } = console): () => void {
  finishInterruptedRoutineRuns(deps.db ?? initDb())
  const tick = () => {
    try {
      for (const handle of tickRoutines(Date.now(), deps)) void handle.done
    } catch (error) {
      log.warn('[routines] tick failed', error)
    }
  }
  let interval: ReturnType<typeof setInterval> | undefined
  const align = setTimeout(() => {
    tick()
    interval = setInterval(tick, 60_000)
  }, 60_000 - (Date.now() % 60_000))
  return () => {
    clearTimeout(align)
    if (interval) clearInterval(interval)
  }
}
