import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm'
import { isActor } from '../actors.ts'
import { initDb, type Db } from '../db/index.ts'
import { createId } from '../id.ts'
import { domainError } from '../utils/errors.ts'
import { initProjectsStore, MAX_DESCRIPTION, MAX_TITLE, parseResources, type ProjectsStore, type Resource } from '../projects/index.ts'
import { tasks, timesheets } from './schema.ts'
import type { Task, TaskFilter, TaskStatus, TaskUpdate, Timesheet } from './types.ts'

/**
 * Tasks: the work inside a project, and the time logged on it.
 *
 *   tasks(id, workspaceId, projectId, title, description, status, dueAt, assignees, resources, createdBy, createdAt, updatedAt)
 *   timesheets(id, workspaceId, taskId, createdBy, createdAt, time, notes)                                    (schema.ts)
 *
 * A task belongs to one project of the same workspace, which must exist and not be deleted
 * when the task is created or moved there. `status` is 'todo', 'doing', 'done', 'archived' or
 * 'deleted'; archiving and deleting only set it, rows are never removed (there is no hard
 * delete), lists hide both unless asked for with `status`, and restoring is setting 'todo'.
 * `assignees` are actors ('user' or 'agent:<id>'). A timesheet is one logged stretch of work:
 * `time` in milliseconds, so a timer can fill it later; timesheets have no status and are
 * deleted for real. Every function takes the workspace explicitly and only sees its rows.
 */

export type * from './types.ts'

/** Longest single timesheet entry. */
export const MAX_TIME = 24 * 60 * 60 * 1000
export const MAX_NOTES = 4_000
export const MAX_ASSIGNEES = 20

const STATUSES: TaskStatus[] = ['todo', 'doing', 'done', 'archived', 'deleted']

type Row = typeof tasks.$inferSelect
type SheetRow = typeof timesheets.$inferSelect

function toTask(row: Row): Task {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    status: row.status,
    dueAt: row.dueAt?.getTime() ?? null,
    assignees: row.assignees,
    resources: row.resources,
    createdBy: row.createdBy,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

const toTimesheet = (row: SheetRow): Timesheet => ({
  id: row.id,
  taskId: row.taskId,
  createdBy: row.createdBy,
  createdAt: row.createdAt.getTime(),
  time: row.time,
  notes: row.notes,
})

function assertTitle(title: unknown): string {
  if (typeof title !== 'string' || !title.trim()) throw domainError('invalid', 'A title is required')
  if (title.trim().length > MAX_TITLE) throw domainError('invalid', `Titles are limited to ${MAX_TITLE} characters`)
  return title.trim()
}

function assertDescription(description: unknown): string {
  if (typeof description !== 'string') throw domainError('invalid', 'The description must be text')
  if (description.length > MAX_DESCRIPTION) throw domainError('invalid', `Descriptions are limited to ${MAX_DESCRIPTION} characters`)
  return description
}

const assertResources = (resources: unknown): Resource[] => parseResources(resources, (message) => domainError('invalid', message))

function assertActor(actor: unknown): string {
  if (!isActor(actor)) throw domainError('invalid', `${String(actor)} is not an actor`)
  return actor
}

function assertAssignees(assignees: unknown): string[] {
  if (!Array.isArray(assignees)) throw domainError('invalid', 'assignees must be an array')
  const unique = [...new Set(assignees.map(assertActor))]
  if (unique.length > MAX_ASSIGNEES) throw domainError('invalid', `At most ${MAX_ASSIGNEES} assignees`)
  return unique
}

function assertDueAt(dueAt: unknown): Date | null {
  if (dueAt === null) return null
  if (typeof dueAt !== 'number' || !Number.isInteger(dueAt) || dueAt < 0) throw domainError('invalid', 'dueAt must be a timestamp in milliseconds or null')
  return new Date(dueAt)
}

export function createTasksStore(db: Db, projects: Pick<ProjectsStore, 'getProject'>) {
  const find = (workspaceId: string, id: string) =>
    db.select().from(tasks).where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.id, id))).get()

  function getRow(workspaceId: string, id: string): Row {
    const row = find(workspaceId, id)
    if (!row) throw domainError('not_found', `Task ${id} does not exist`)
    return row
  }

  function assertProject(workspaceId: string, projectId: string): string {
    const project = projects.getProject(workspaceId, projectId)
    if (!project || project.status === 'deleted') throw domainError('not_found', `Project ${projectId} does not exist`)
    return projectId
  }

  /** Strictly after the stored value, so two saves in one millisecond still tell apart. */
  const nextUpdatedAt = (row: Row) => new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1))

  return {
    createTask(input: {
      workspaceId: string
      projectId: string
      title: string
      description?: string
      dueAt?: number | null
      assignees?: string[]
      resources?: Resource[]
      createdBy?: string
    }): Task {
      const title = assertTitle(input.title)
      const description = assertDescription(input.description ?? '')
      const dueAt = assertDueAt(input.dueAt ?? null)
      const assignees = assertAssignees(input.assignees ?? [])
      const resources = assertResources(input.resources ?? [])
      const createdBy = assertActor(input.createdBy ?? 'user')
      const projectId = assertProject(input.workspaceId, input.projectId)
      const now = new Date()
      return toTask(
        db
          .insert(tasks)
          .values({ id: createId(), workspaceId: input.workspaceId, projectId, title, description, status: 'todo', dueAt, assignees, resources, createdBy, createdAt: now, updatedAt: now })
          .returning()
          .get(),
      )
    },

    getTask(workspaceId: string, id: string): Task | undefined {
      const row = find(workspaceId, id)
      return row && toTask(row)
    },

    /**
     * Without `status`, everything but archived and deleted. Open work first (doing, todo, done,
     * then archived and deleted), the most recently updated first within a status.
     */
    getTasks(workspaceId: string, filter: TaskFilter = {}): Task[] {
      const where = [
        eq(tasks.workspaceId, workspaceId),
        filter.projectId === undefined ? undefined : eq(tasks.projectId, filter.projectId),
        filter.status === undefined
          ? notInArray(tasks.status, ['archived', 'deleted'])
          : inArray(tasks.status, [filter.status].flat()),
        filter.assignee === undefined
          ? undefined
          : sql`exists (select 1 from json_each(${tasks.assignees}) where json_each.value = ${filter.assignee})`,
      ]
      return db
        .select()
        .from(tasks)
        .where(and(...where))
        .orderBy(
          sql`case ${tasks.status} when 'doing' then 0 when 'todo' then 1 when 'done' then 2 when 'archived' then 3 else 4 end`,
          desc(tasks.updatedAt),
        )
        .all()
        .map(toTask)
    },

    /**
     * Changes the given fields (`assignees` replaces the list). With `expectedUpdatedAt`, a
     * different stored `updatedAt` means someone saved in between, and nothing changes (`conflict`).
     * A deleted task cannot be changed.
     */
    updateTask(workspaceId: string, id: string, patch: TaskUpdate): Task {
      const row = getRow(workspaceId, id)
      if (row.status === 'deleted') throw domainError('invalid', `Task ${id} is deleted; restore it first`)
      if (patch.expectedUpdatedAt !== undefined && patch.expectedUpdatedAt !== row.updatedAt.getTime()) {
        throw domainError('conflict', `Task ${id} changed since it was loaded`)
      }
      const changes: Partial<Row> = {}
      if (patch.projectId !== undefined) changes.projectId = assertProject(workspaceId, patch.projectId)
      if (patch.title !== undefined) changes.title = assertTitle(patch.title)
      if (patch.description !== undefined) changes.description = assertDescription(patch.description)
      if (patch.dueAt !== undefined) changes.dueAt = assertDueAt(patch.dueAt)
      if (patch.assignees !== undefined) changes.assignees = assertAssignees(patch.assignees)
      if (patch.resources !== undefined) changes.resources = assertResources(patch.resources)
      changes.updatedAt = nextUpdatedAt(row)
      const updated = db
        .update(tasks)
        .set(changes)
        .where(and(eq(tasks.id, id), eq(tasks.updatedAt, row.updatedAt)))
        .returning()
        .get()
      if (!updated) throw domainError('conflict', `Task ${id} changed since it was loaded`)
      return toTask(updated)
    },

    /** Move along the board, archive ('archived'), soft delete ('deleted') or restore ('todo'). */
    setTaskStatus(workspaceId: string, id: string, status: TaskStatus): Task {
      if (!STATUSES.includes(status)) throw domainError('invalid', `${status} is not a task status`)
      const row = getRow(workspaceId, id)
      return toTask(db.update(tasks).set({ status, updatedAt: nextUpdatedAt(row) }).where(eq(tasks.id, id)).returning().get()!)
    },

    /** Logs time on a task; `createdAt` is when it was logged. */
    createTimesheet(input: { workspaceId: string; taskId: string; time: number; notes?: string; createdBy?: string }): Timesheet {
      if (!Number.isInteger(input.time) || input.time <= 0 || input.time > MAX_TIME) {
        throw domainError('invalid', `time must be a whole number of milliseconds, at most ${MAX_TIME}`)
      }
      const notes = input.notes ?? ''
      if (typeof notes !== 'string' || notes.length > MAX_NOTES) throw domainError('invalid', `Notes are limited to ${MAX_NOTES} characters`)
      const createdBy = assertActor(input.createdBy ?? 'user')
      const task = find(input.workspaceId, input.taskId)
      if (!task || task.status === 'deleted') throw domainError('not_found', `Task ${input.taskId} does not exist`)
      return toTimesheet(
        db
          .insert(timesheets)
          .values({ id: createId(), workspaceId: input.workspaceId, taskId: task.id, createdBy, createdAt: new Date(), time: input.time, notes })
          .returning()
          .get(),
      )
    },

    /** The most recently logged first. */
    getTimesheets(workspaceId: string, taskId: string): Timesheet[] {
      return db
        .select()
        .from(timesheets)
        .where(and(eq(timesheets.workspaceId, workspaceId), eq(timesheets.taskId, taskId)))
        .orderBy(desc(timesheets.createdAt), desc(timesheets.id))
        .all()
        .map(toTimesheet)
    },

    /** Total logged on the task, in milliseconds. */
    getTaskTime(workspaceId: string, taskId: string): number {
      const total = db
        .select({ total: sql<number>`coalesce(sum(${timesheets.time}), 0)` })
        .from(timesheets)
        .where(and(eq(timesheets.workspaceId, workspaceId), eq(timesheets.taskId, taskId)))
        .get()
      return total?.total ?? 0
    },

    deleteTimesheet(workspaceId: string, id: string): void {
      const removed = db
        .delete(timesheets)
        .where(and(eq(timesheets.workspaceId, workspaceId), eq(timesheets.id, id)))
        .returning()
        .get()
      if (!removed) throw domainError('not_found', `Timesheet ${id} does not exist`)
    },
  }
}

export type TasksStore = ReturnType<typeof createTasksStore>

let store: TasksStore | undefined

/** The process-wide store, on the shared database. */
export const initTasksStore = (): TasksStore => (store ??= createTasksStore(initDb(), initProjectsStore()))

export const createTask: TasksStore['createTask'] = (input) => initTasksStore().createTask(input)
export const getTask: TasksStore['getTask'] = (workspaceId, id) => initTasksStore().getTask(workspaceId, id)
export const getTasks: TasksStore['getTasks'] = (workspaceId, filter) => initTasksStore().getTasks(workspaceId, filter)
export const updateTask: TasksStore['updateTask'] = (workspaceId, id, patch) => initTasksStore().updateTask(workspaceId, id, patch)
export const setTaskStatus: TasksStore['setTaskStatus'] = (workspaceId, id, status) => initTasksStore().setTaskStatus(workspaceId, id, status)
export const createTimesheet: TasksStore['createTimesheet'] = (input) => initTasksStore().createTimesheet(input)
export const getTimesheets: TasksStore['getTimesheets'] = (workspaceId, taskId) => initTasksStore().getTimesheets(workspaceId, taskId)
export const getTaskTime: TasksStore['getTaskTime'] = (workspaceId, taskId) => initTasksStore().getTaskTime(workspaceId, taskId)
export const deleteTimesheet: TasksStore['deleteTimesheet'] = (workspaceId, id) => initTasksStore().deleteTimesheet(workspaceId, id)
