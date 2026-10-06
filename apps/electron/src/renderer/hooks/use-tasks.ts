/**
 * The workspace's tasks of every status but deleted (backend order: doing, todo, done, then newest update)
 * and their mutations; pages filter the list by `TasksSearch`. Same contract as `useProjects`: results,
 * not throws, and a reload after each mutation. Time logged on a task is read with
 * `window.electronAPI.getTimesheets(taskId)`.
 */

import { useMemo } from 'react'
import { tasksAtom } from '@/atoms/tasks'
import { toResult } from '@/lib/domain-result'
import type { Resource, Task, TaskStatus, TaskUpdate } from '../../shared/types'
import { useWorkspaceList } from './use-workspace-list'

const loadTasks = () => window.electronAPI.getTasks({ status: ['todo', 'doing', 'done', 'archived'] })

export function useTasks() {
  const { items: tasks, loaded, refresh, mutate } = useWorkspaceList(tasksAtom, loadTasks, 'tasks')

  const actions = useMemo(() => {
    const api = window.electronAPI
    return {
      createTask: (input: { projectId: string; title: string; description?: string; dueAt?: number | null; assignees?: string[]; resources?: Resource[] }) =>
        mutate(() => api.createTask(input)),
      updateTask: (id: string, patch: TaskUpdate) => mutate(() => api.updateTask(id, patch)),
      /** `archived` and `deleted` are statuses too (restoring is `todo`). */
      setTaskStatus: (id: string, status: TaskStatus) => mutate(() => api.setTaskStatus(id, status)),
      createTimesheet: (input: { taskId: string; time: number; notes?: string }) => toResult(() => api.createTimesheet(input)),
      deleteTimesheet: (id: string) => toResult(() => api.deleteTimesheet(id)),
    }
  }, [mutate])

  return { tasks: tasks as Task[], loaded, refresh, ...actions }
}
