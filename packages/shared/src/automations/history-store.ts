import { eq } from 'drizzle-orm'
import { getWorkspaceIdByRootPath } from '../config/storage.ts'
import { initDb, type Db } from '../db/index.ts'
import { routines } from './schema.ts'
import { startRoutineRun, updateRoutineRun } from './routines.ts'

/**
 * What the event handlers and the session manager record when an event routine runs a prompt, webhook or script: the
 * entries of `createPromptHistoryEntry`, `createWebhookHistoryEntry` and `createScriptHistoryEntry` (the JSON shape
 * the old history file held, `id` = the routine's id), written as one finished run of that routine.
 * (Schedules and Run now record through `runRoutine` instead.)
 */
export async function appendAutomationHistoryEntry(workspaceRootPath: string, entry: Record<string, unknown>, handle?: Db): Promise<void> {
  const workspaceId = getWorkspaceIdByRootPath(workspaceRootPath)
  const routineId = typeof entry.id === 'string' ? entry.id : undefined
  if (!workspaceId || !routineId) return
  const db = handle ?? initDb()
  if (!db.select({ id: routines.id }).from(routines).where(eq(routines.id, routineId)).get()) return
  const run = startRoutineRun({ id: routineId, workspaceId }, typeof entry.ts === 'number' ? entry.ts : Date.now(), { bump: true }, db)
  if (!run) return
  const detail = (entry.webhook ?? entry.script) as { error?: string } | undefined
  const error = (entry.skipped ?? entry.error ?? detail?.error) as string | undefined
  updateRoutineRun(run.id, { status: entry.skipped ? 'skipped' : entry.ok ? 'ok' : 'error', chatId: entry.sessionId as string | undefined, error }, db)
}
