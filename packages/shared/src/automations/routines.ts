import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import { getAgent } from '../agents/index.ts'
import { userActor } from '../actors.ts'
import { initDb, type Db, type Tx } from '../db/index.ts'
import { createId } from '../id.ts'
import { domainError } from '../utils/errors.ts'
import { getMemberRole } from '../workspaces/members.ts'
import { ROUTINE_RUNS_KEPT, MAX_ROUTINE_TITLE, type Routine, type RoutineConfig, type RoutineInput, type RoutineRun, type RoutineRunStatus, type RoutineUpdate } from './routine-types.ts'
import { routines, routinesHistory } from './schema.ts'
import { RoutineConfigSchema } from './schemas.ts'

/**
 * Routines: what runs on a schedule or an event, and its run history (docs/schema.md, docs/final-plan.md 2.8).
 *
 *   routines(id, workspace_id, agent_id, title, config, paused_at, created_by, created_at)
 *   routines_history(id, workspace_id, routine_id, scheduled_for, status, chat_id, error, started_at)   (schema.ts)
 *
 * `paused_at` null = active; `agent_id` null = the workspace's default agent. Every function takes the workspace
 * explicitly and only sees its rows. Who may change one is `canEditRoutine`, applied by the guard
 * (`bootstrap/authorize.ts`); these functions do not know users. A routine runs as its `created_by` (its chats and
 * connections are that person's), so a change by anyone else (a workspace owner) makes it theirs (`updateRoutine`'s
 * `by`), and a person's Run now runs as that person. Running a routine is ./routine-runner.ts.
 */

type Row = typeof routines.$inferSelect
type RunRow = typeof routinesHistory.$inferSelect

const toRun = (row: RunRow): RoutineRun => ({
  id: row.id,
  routineId: row.routineId,
  scheduledFor: row.scheduledFor.getTime(),
  status: row.status as RoutineRunStatus,
  chatId: row.chatId,
  error: row.error,
  startedAt: row.startedAt.getTime(),
})

const toRoutine = (row: Row, runs: RoutineRun[]): Routine => ({
  id: row.id,
  workspaceId: row.workspaceId,
  agentId: row.agentId,
  title: row.title,
  config: row.config,
  pausedAt: row.pausedAt?.getTime() ?? null,
  createdBy: row.createdBy,
  createdAt: row.createdAt.getTime(),
  runs,
})

function assertTitle(title: unknown): string {
  if (typeof title !== 'string' || !title.trim()) throw domainError('invalid', 'A name is required')
  if (title.trim().length > MAX_ROUTINE_TITLE) throw domainError('invalid', `Names are limited to ${MAX_ROUTINE_TITLE} characters`)
  return title.trim()
}

function assertConfig(config: unknown): RoutineConfig {
  const parsed = RoutineConfigSchema.safeParse(config)
  if (!parsed.success) throw domainError('invalid', parsed.error.issues.map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`).join('; '))
  return parsed.data as RoutineConfig
}

function assertAgent(workspaceId: string, agentId: unknown, db: Db | Tx): string | null {
  if (agentId === null || agentId === undefined || agentId === '') return null
  if (typeof agentId !== 'string' || !getAgent(workspaceId, agentId, db)) throw domainError('invalid', 'The agent is not one of this workspace')
  return agentId
}

function runsOf(workspaceId: string, db: Db | Tx, routineIds?: string[]): Map<string, RoutineRun[]> {
  const rows = db
    .select()
    .from(routinesHistory)
    .where(routineIds ? and(eq(routinesHistory.workspaceId, workspaceId), inArray(routinesHistory.routineId, routineIds)) : eq(routinesHistory.workspaceId, workspaceId))
    .orderBy(desc(routinesHistory.startedAt), desc(routinesHistory.id))
    .all()
  const byRoutine = new Map<string, RoutineRun[]>()
  for (const row of rows) byRoutine.set(row.routineId, [...(byRoutine.get(row.routineId) ?? []), toRun(row)])
  return byRoutine
}

/** The workspace's routines with their runs (newest first), the oldest routine first. */
export function getRoutines(workspaceId: string, db: Db | Tx = initDb()): Routine[] {
  const rows = db.select().from(routines).where(eq(routines.workspaceId, workspaceId)).orderBy(asc(routines.createdAt), asc(routines.id)).all()
  const runs = runsOf(workspaceId, db)
  return rows.map((row) => toRoutine(row, runs.get(row.id) ?? []))
}

export function getRoutine(workspaceId: string, id: string, db: Db | Tx = initDb()): Routine | undefined {
  const row = db.select().from(routines).where(and(eq(routines.workspaceId, workspaceId), eq(routines.id, id))).get()
  return row ? toRoutine(row, runsOf(workspaceId, db, [id]).get(id) ?? []) : undefined
}

/** A webhook routine by its id alone (a hook URL names no workspace), without its runs. */
export function getWebhookRoutine(id: string, db: Db | Tx = initDb()): Routine | undefined {
  const row = db.select().from(routines).where(eq(routines.id, id)).get()
  return row?.config.type === 'webhook' ? toRoutine(row, []) : undefined
}

/** The active routines of every workspace that start on a schedule: what the ticker looks at, without their runs. */
export function getScheduledRoutines(db: Db | Tx = initDb()): Routine[] {
  return db.select().from(routines).where(isNull(routines.pausedAt)).all().filter((row) => row.config.type === 'schedule').map((row) => toRoutine(row, []))
}

/** The active event routines of a workspace listening to `event`, without their runs. */
export function getEventRoutines(workspaceId: string, event: string, db: Db | Tx = initDb()): Routine[] {
  return db
    .select()
    .from(routines)
    .where(and(eq(routines.workspaceId, workspaceId), isNull(routines.pausedAt)))
    .orderBy(asc(routines.createdAt), asc(routines.id))
    .all()
    .filter((row) => row.config.type === 'event' && row.config.event === event)
    .map((row) => toRoutine(row, []))
}

export function createRoutine(input: RoutineInput, db: Db | Tx = initDb()): Routine {
  if (typeof input.createdBy !== 'string' || !input.createdBy) throw domainError('invalid', 'A routine needs its creator')
  const now = new Date(input.createdAt ?? Date.now())
  const row = db
    .insert(routines)
    .values({
      id: createId(),
      workspaceId: input.workspaceId,
      agentId: assertAgent(input.workspaceId, input.agentId, db),
      title: assertTitle(input.title),
      config: assertConfig(input.config),
      pausedAt: input.paused ? now : null,
      createdBy: input.createdBy,
      createdAt: now,
    })
    .returning()
    .get()
  return toRoutine(row, [])
}

/**
 * Changes the given fields; `config` replaces the whole config. `paused: true` pauses (keeps the first time), `false`
 * resumes. `by` is the actor making the change: when it is not the creator, the routine becomes theirs (`created_by`
 * moves to them), so its runs never use the personal connections of someone who did not write it.
 */
export function updateRoutine(workspaceId: string, id: string, patch: RoutineUpdate & { by?: string }, db: Db | Tx = initDb()): Routine {
  return db.transaction((tx) => {
    const row = tx.select().from(routines).where(and(eq(routines.workspaceId, workspaceId), eq(routines.id, id))).get()
    if (!row) throw domainError('not_found', `Routine ${id} does not exist`)
    const changes: Partial<Row> = {}
    if (patch.title !== undefined) changes.title = assertTitle(patch.title)
    if (patch.agentId !== undefined) changes.agentId = assertAgent(workspaceId, patch.agentId, tx)
    if (patch.config !== undefined) changes.config = assertConfig(patch.config)
    if (patch.paused !== undefined) changes.pausedAt = patch.paused ? (row.pausedAt ?? new Date()) : null
    if (patch.by && patch.by !== row.createdBy) changes.createdBy = patch.by
    if (Object.keys(changes).length) tx.update(routines).set(changes).where(eq(routines.id, id)).run()
    return getRoutine(workspaceId, id, tx)!
  })
}

/** Removes a routine and its runs. */
export function deleteRoutine(workspaceId: string, id: string, db: Db | Tx = initDb()): void {
  db.transaction((tx) => {
    const gone = tx.delete(routines).where(and(eq(routines.workspaceId, workspaceId), eq(routines.id, id))).returning({ id: routines.id }).all()
    if (gone.length === 0) throw domainError('not_found', `Routine ${id} does not exist`)
    tx.delete(routinesHistory).where(and(eq(routinesHistory.workspaceId, workspaceId), eq(routinesHistory.routineId, id))).run()
  })
}

/** Whether a person may change or run a routine: its creator, or an owner of its workspace. */
export function canEditRoutine(workspaceId: string, routine: Pick<Routine, 'createdBy'>, userId: string, db: Db | Tx = initDb()): boolean {
  return routine.createdBy === userActor(userId) || getMemberRole(workspaceId, userId, db) === 'owner'
}

/**
 * Starts a run: inserts its `running` row, and trims the routine's history to the newest `ROUTINE_RUNS_KEPT`.
 * Returns undefined when a run of this routine for `scheduledFor` exists already (another node or an earlier tick
 * won it): that is how a schedule fires once. With `bump`, a taken time moves on by a millisecond instead (runs
 * with no schedule: several in the same millisecond are all kept).
 */
export function startRoutineRun(routine: Pick<Routine, 'id' | 'workspaceId'>, scheduledFor: number, { bump = false } = {}, db: Db | Tx = initDb()): RoutineRun | undefined {
  return db.transaction((tx) => {
    for (let time = scheduledFor, attempt = 0; attempt < 50; time++, attempt++) {
      const row = tx
        .insert(routinesHistory)
        .values({ id: createId(), workspaceId: routine.workspaceId, routineId: routine.id, scheduledFor: new Date(time), status: 'running', startedAt: new Date() })
        .onConflictDoNothing()
        .returning()
        .get()
      if (row) {
        const old = tx
          .select({ id: routinesHistory.id })
          .from(routinesHistory)
          .where(eq(routinesHistory.routineId, routine.id))
          .orderBy(desc(routinesHistory.startedAt), desc(routinesHistory.id))
          .limit(1000)
          .offset(ROUTINE_RUNS_KEPT)
          .all()
        if (old.length) tx.delete(routinesHistory).where(inArray(routinesHistory.id, old.map((run) => run.id))).run()
        return toRun(row)
      }
      if (!bump) return undefined
    }
    return undefined
  })
}

/** Ends a run with its outcome. */
export function updateRoutineRun(runId: string, outcome: { status: Exclude<RoutineRunStatus, 'running'>; chatId?: string | null; error?: string | null }, db: Db | Tx = initDb()): void {
  db.update(routinesHistory)
    .set({ status: outcome.status, chatId: outcome.chatId ?? null, error: outcome.error ?? null })
    .where(eq(routinesHistory.id, runId))
    .run()
}
