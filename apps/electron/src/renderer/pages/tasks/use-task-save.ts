/**
 * Saving a task from several fields at once (title, description, assignees, due date, links, project): every
 * update of one task goes through one queue, so two fields saving together never race, and each sends the
 * newest `updatedAt` known (the list's, or the one the last save returned) as `expectedUpdatedAt`. A failure
 * throws an `Error` with the domain's `code` (what `useAutosave` reads: `conflict` reloads), its message the
 * toast's text. Discrete actions (`runTaskAction`) toast "Saved" themselves.
 */

import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@workspace/ui/components/sonner'
import type { MutationResult } from '@/lib/domain-result'
import type { useTasks } from '@/hooks/use-tasks'
import type { Task, TaskStatus, TaskUpdate } from '../../../shared/types'

const queues = new Map<string, Promise<unknown>>()
const versions = new Map<string, number>()

/** Remember the newest `updatedAt` seen for a task (from the list or a mutation's result). */
export function seeTask(task: Pick<Task, 'id' | 'updatedAt'>) {
  versions.set(task.id, Math.max(versions.get(task.id) ?? 0, task.updatedAt))
}

/** Runs `call` after the task's earlier saves, one at a time. */
function enqueue<T>(taskId: string, call: () => Promise<T>): Promise<T> {
  const next = (queues.get(taskId) ?? Promise.resolve()).then(call, call)
  queues.set(taskId, next.catch(() => undefined))
  return next
}

/** Takes the caller's `useTasks()` (one list subscription per page). */
export function useTaskSave({ updateTask, setTaskStatus, refresh }: Pick<ReturnType<typeof useTasks>, 'updateTask' | 'setTaskStatus' | 'refresh'>) {
  const { t } = useTranslation()

  const fail = useCallback((code: string) => {
    const key = code === 'invalid' ? 'tasks.errorInvalid' : code === 'not_found' ? 'tasks.errorNotFound' : 'tasks.errorUnknown'
    return Object.assign(new Error(t(key)), { code })
  }, [t])

  const unwrap = useCallback((result: MutationResult<Task>): Task => {
    if (!result.ok) throw fail(result.code)
    seeTask(result.value)
    return result.value
  }, [fail])

  /** Update fields of a task; throws on failure (for `useAutosave`). */
  const saveTask = useCallback((task: Task, patch: Omit<TaskUpdate, 'expectedUpdatedAt'>) => {
    seeTask(task)
    return enqueue(task.id, async () =>
      unwrap(await updateTask(task.id, { ...patch, expectedUpdatedAt: versions.get(task.id) })))
  }, [updateTask, unwrap])

  /** A discrete change (status, archive, project, links): applied at once with the "Saved" toast, a failure toasts. */
  const runTaskAction = useCallback(async (task: Task, action: { status: TaskStatus } | Omit<TaskUpdate, 'expectedUpdatedAt'>) => {
    try {
      if ('status' in action) {
        seeTask(task)
        await enqueue(task.id, async () => unwrap(await setTaskStatus(task.id, action.status)))
      } else {
        await saveTask(task, action)
      }
      toast.success(t('common.saved'), { id: 'saved' })
      return true
    } catch (error) {
      const code = (error as { code?: string }).code
      toast.error(code === 'conflict' ? t('common.changedElsewhere') : (error as Error).message, { id: 'saved' })
      if (code === 'conflict') void refresh()
      return false
    }
  }, [saveTask, setTaskStatus, unwrap, refresh, t])

  return { saveTask, runTaskAction, refresh, fail }
}
