/** What callers (including the renderer) see of tasks and timesheets; no database imports here. */
import type { Resource } from '../projects/types.ts'

export type TaskStatus = 'todo' | 'doing' | 'done' | 'archived' | 'deleted'
export type TaskErrorCode = 'not_found' | 'conflict' | 'invalid'

/** Timestamps are epoch milliseconds so a task survives JSON as is. */
export type Task = {
  id: string
  projectId: string
  title: string
  description: string
  status: TaskStatus
  dueAt: number | null
  /** 'user:<id>' or 'agent:<id>', no duplicates. */
  assignees: string[]
  resources: Resource[]
  createdBy: string
  createdAt: number
  updatedAt: number
}

/** Left out means everywhere. `status` left out hides archived and deleted tasks. `assignee` is an actor. */
export type TaskFilter = { projectId?: string; status?: TaskStatus | TaskStatus[]; assignee?: string }

/** `expectedUpdatedAt` is the `updatedAt` the caller last saw; a different stored value is a `conflict`. */
export type TaskUpdate = {
  projectId?: string
  title?: string
  description?: string
  dueAt?: number | null
  assignees?: string[]
  resources?: Resource[]
  expectedUpdatedAt?: number
}

/** One logged stretch of work on a task. `time` is milliseconds. */
export type Timesheet = {
  id: string
  taskId: string
  createdBy: string
  createdAt: number
  time: number
  notes: string
}
