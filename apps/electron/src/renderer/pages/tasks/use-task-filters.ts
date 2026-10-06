/**
 * The Tasks index's filters: Project and Assignee (one value each), Status (several), Archived (on / off);
 * fields combine (all must match). They live in the route's search (`tasks?project=p1&status=todo`, see
 * `shared/section-search.ts`), so Back from a task returns to the same filters. Mirrors `useChatFilters`.
 */

import { useCallback } from 'react'
import { routes } from '@/lib/navigate'
import { isTasksNavigation, useNavigation, useNavigationState } from '@/contexts/navigation-context'
import { normalizeTasksSearch, type TasksSearch } from '../../../shared/section-search'
import type { Task, TaskStatus } from '../../../shared/types'

/** The groups of the list, in lifecycle order; Archived is the last, folded one. */
export const TASK_GROUPS = ['todo', 'doing', 'done', 'archived'] as const satisfies readonly TaskStatus[]
export type TaskGroupStatus = (typeof TASK_GROUPS)[number]

export function hasTaskFilters(f: TasksSearch): boolean {
  return Boolean(f.project || f.assignee || f.status?.length || f.archived)
}

/** Whether a task matches the filters, archived or not (Archived on keeps only archived tasks). */
export function matchesTaskFilters(task: Task, f: TasksSearch): boolean {
  if (f.project && task.projectId !== f.project) return false
  if (f.assignee && !task.assignees.includes(f.assignee)) return false
  if (f.status?.length && !(f.status as string[]).includes(task.status)) return false
  if (f.archived && task.status !== 'archived') return false
  return true
}

/** The tasks per group in the order given (the backend's: newest update first within a status); empty groups stay. */
export function groupTasks(tasks: Task[]): Record<TaskGroupStatus, Task[]> {
  const groups: Record<TaskGroupStatus, Task[]> = { todo: [], doing: [], done: [], archived: [] }
  for (const task of tasks) {
    if (task.status in groups) groups[task.status as TaskGroupStatus].push(task)
  }
  return groups
}

/** The open route's task filters and a setter that navigates to the index with new ones. */
export function useTaskFilters(): [TasksSearch, (next: TasksSearch) => void] {
  const { navigate } = useNavigation()
  const navState = useNavigationState()
  const filters = isTasksNavigation(navState) ? navState.search : {}
  const setFilters = useCallback((next: TasksSearch) => { void navigate(routes.view.tasks(normalizeTasksSearch({ ...next }))) }, [navigate])
  return [filters, setFilters]
}
