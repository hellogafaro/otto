import { expect, test } from 'bun:test'
import { openDb } from '../db/index.ts'
import { pushSchema } from '../db/push.ts'
import { createProjectsStore } from '../projects/index.ts'
import { createTasksStore, MAX_ASSIGNEES, MAX_NOTES, MAX_TIME, type TaskErrorCode } from './index.ts'
import { isDomainError } from '../utils/errors.ts'

const W = 'ws1'
const ME = 'user:aaaaaaaaaaaa'
const OTHER = 'ws2'

async function setup() {
  const db = openDb(':memory:')
  await pushSchema(db)
  const projects = createProjectsStore(db)
  const tasks = createTasksStore(db, projects)
  return { projects, tasks, project: projects.createProject({ createdBy: ME, workspaceId: W, title: 'P' }) }
}

function failsWith(code: TaskErrorCode, run: () => unknown) {
  let error: unknown
  try {
    run()
  } catch (e) {
    error = e
  }
  expect(isDomainError(error) && error.code).toBe(code)
}

test('create needs an existing, non-deleted project of the same workspace', async () => {
  const { projects, tasks, project } = await setup()
  const task = tasks.createTask({ createdBy: ME, workspaceId: W, projectId: project.id, title: ' Write ' })
  expect(task.id).toMatch(/^[0-9a-z]{12}$/)
  expect(task).toMatchObject({ projectId: project.id, title: 'Write', description: '', status: 'todo', dueAt: null, assignees: [], resources: [], createdBy: ME })
  expect(task.createdAt).toBe(task.updatedAt)
  expect(tasks.getTask(W, task.id)).toEqual(task)
  failsWith('not_found', () => tasks.createTask({ createdBy: ME, workspaceId: W, projectId: 'nope', title: 'A' }))
  failsWith('not_found', () => tasks.createTask({ createdBy: ME, workspaceId: OTHER, projectId: project.id, title: 'A' }))
  projects.setProjectStatus(W, project.id, 'archived')
  expect(tasks.createTask({ createdBy: ME, workspaceId: W, projectId: project.id, title: 'In archive' }).status).toBe('todo')
  projects.setProjectStatus(W, project.id, 'deleted')
  failsWith('not_found', () => tasks.createTask({ createdBy: ME, workspaceId: W, projectId: project.id, title: 'A' }))
})

test('create validates title, due date, creator and resources', async () => {
  const { tasks, project } = await setup()
  const make = (extra: object) => () => tasks.createTask({ createdBy: ME, workspaceId: W, projectId: project.id, title: 'A', ...extra })
  failsWith('invalid', () => tasks.createTask({ createdBy: ME, workspaceId: W, projectId: project.id, title: '' }))
  failsWith('invalid', make({ dueAt: 1.5 }))
  failsWith('invalid', make({ dueAt: -1 }))
  failsWith('invalid', make({ createdBy: 'bob' }))
  failsWith('invalid', make({ resources: [{ type: 'url', title: 'x', ref: 'nope' }] }))
  const ok = tasks.createTask({ workspaceId: W, projectId: project.id, title: 'A', dueAt: 1_700_000_000_000, createdBy: 'agent:default' })
  expect(ok).toMatchObject({ dueAt: 1_700_000_000_000, createdBy: 'agent:default' })
})

test('statuses: archive, delete and restore to todo; lists hide archived and deleted', async () => {
  const { tasks, project } = await setup()
  const make = (title: string) => tasks.createTask({ createdBy: ME, workspaceId: W, projectId: project.id, title })
  const a = make('a')
  const b = make('b')
  const c = make('c')
  expect(tasks.setTaskStatus(W, a.id, 'doing').status).toBe('doing')
  expect(tasks.setTaskStatus(W, b.id, 'archived').status).toBe('archived')
  expect(tasks.setTaskStatus(W, c.id, 'deleted').status).toBe('deleted')
  expect(tasks.getTasks(W).map((t) => t.id)).toEqual([a.id])
  expect(tasks.getTasks(W, { status: 'archived' }).map((t) => t.id)).toEqual([b.id])
  expect(tasks.getTasks(W, { status: ['archived', 'deleted'] })).toHaveLength(2)
  failsWith('invalid', () => tasks.updateTask(W, c.id, { title: 'x' }))
  const restored = tasks.setTaskStatus(W, c.id, 'todo')
  expect(restored.status).toBe('todo')
  expect(restored.updatedAt).toBeGreaterThan(c.updatedAt)
  expect(tasks.getTask(W, c.id)?.status).toBe('todo')
  failsWith('invalid', () => tasks.setTaskStatus(W, a.id, 'blocked' as never))
  failsWith('not_found', () => tasks.setTaskStatus(OTHER, a.id, 'done'))
})

test('lists are ordered by status then most recently updated, and filter by project', async () => {
  const { projects, tasks, project } = await setup()
  const other = projects.createProject({ createdBy: ME, workspaceId: W, title: 'Q' })
  const make = (title: string, projectId = project.id) => tasks.createTask({ createdBy: ME, workspaceId: W, projectId, title })
  const todoOld = make('todo old')
  const done = make('done')
  const doing = make('doing')
  const todoNew = make('todo new')
  const elsewhere = make('elsewhere', other.id)
  tasks.setTaskStatus(W, done.id, 'done')
  tasks.setTaskStatus(W, doing.id, 'doing')
  tasks.updateTask(W, todoNew.id, { description: 'touched' })
  expect(tasks.getTasks(W, { projectId: project.id }).map((t) => t.title)).toEqual(['doing', 'todo new', 'todo old', 'done'])
  expect(tasks.getTasks(W, { projectId: other.id }).map((t) => t.id)).toEqual([elsewhere.id])
  expect(todoOld.status).toBe('todo')
})

test('assignees are validated, deduplicated and filterable', async () => {
  const { tasks, project } = await setup()
  const make = (title: string, assignees?: string[]) => tasks.createTask({ createdBy: ME, workspaceId: W, projectId: project.id, title, assignees })
  const mine = make('mine', [ME, ME, 'agent:default'])
  const agents = make('agents', ['agent:default'])
  const nobody = make('nobody')
  expect(mine.assignees).toEqual([ME, 'agent:default'])
  expect(tasks.getTasks(W, { assignee: ME }).map((t) => t.id)).toEqual([mine.id])
  expect(tasks.getTasks(W, { assignee: 'agent:default' }).map((t) => t.id).sort()).toEqual([mine.id, agents.id].sort())
  expect(tasks.getTasks(W, { assignee: 'agent:other' })).toEqual([])
  const updated = tasks.updateTask(W, nobody.id, { assignees: ['agent:x', 'agent:x', ME] })
  expect(updated.assignees).toEqual(['agent:x', ME])
  expect(tasks.updateTask(W, nobody.id, { assignees: [] }).assignees).toEqual([])
  failsWith('invalid', () => make('bad', ['bob']))
  failsWith('invalid', () => make('bad', ['agent:']))
  failsWith('invalid', () => make('bad', ME as never))
  failsWith('invalid', () => tasks.updateTask(W, nobody.id, { assignees: [1 as never] }))
  failsWith('invalid', () => make('many', Array.from({ length: MAX_ASSIGNEES + 1 }, (_, i) => `agent:a${i}`)))
})

test('update changes only what is given, can move to another project and clear the due date', async () => {
  const { projects, tasks, project } = await setup()
  const other = projects.createProject({ createdBy: ME, workspaceId: W, title: 'Q' })
  const task = tasks.createTask({ createdBy: ME, workspaceId: W, projectId: project.id, title: 'A', description: 'd', dueAt: 5 })
  const moved = tasks.updateTask(W, task.id, { projectId: other.id, dueAt: null, title: 'B' })
  expect(moved).toMatchObject({ projectId: other.id, dueAt: null, title: 'B', description: 'd' })
  expect(moved.updatedAt).toBeGreaterThan(task.updatedAt)
  failsWith('not_found', () => tasks.updateTask(W, task.id, { projectId: 'nope' }))
  failsWith('invalid', () => tasks.updateTask(W, task.id, { title: ' ' }))
  expect(tasks.getTask(W, task.id)).toEqual(moved)
})

test('a stale expectedUpdatedAt is a conflict and changes nothing', async () => {
  const { tasks, project } = await setup()
  const task = tasks.createTask({ createdBy: ME, workspaceId: W, projectId: project.id, title: 'A' })
  const first = tasks.updateTask(W, task.id, { title: 'B', expectedUpdatedAt: task.updatedAt })
  failsWith('conflict', () => tasks.updateTask(W, task.id, { title: 'C', expectedUpdatedAt: task.updatedAt }))
  expect(tasks.getTask(W, task.id)).toEqual(first)
  expect(tasks.updateTask(W, task.id, { title: 'D', expectedUpdatedAt: first.updatedAt }).title).toBe('D')
})

test('workspaces do not see each other', async () => {
  const { projects, tasks, project } = await setup()
  const task = tasks.createTask({ createdBy: ME, workspaceId: W, projectId: project.id, title: 'A', assignees: [ME] })
  const foreign = projects.createProject({ createdBy: ME, workspaceId: OTHER, title: 'F' })
  tasks.createTask({ createdBy: ME, workspaceId: OTHER, projectId: foreign.id, title: 'B', assignees: [ME] })
  expect(tasks.getTasks(W, { assignee: ME }).map((t) => t.id)).toEqual([task.id])
  expect(tasks.getTask(OTHER, task.id)).toBeUndefined()
  failsWith('not_found', () => tasks.updateTask(OTHER, task.id, { title: 'x' }))
  failsWith('not_found', () => tasks.createTimesheet({ createdBy: ME, workspaceId: OTHER, taskId: task.id, time: 1 }))
  expect(tasks.getTimesheets(OTHER, task.id)).toEqual([])
})

test('timesheets: bounds, notes, sum and delete', async () => {
  const { tasks, project } = await setup()
  const task = tasks.createTask({ createdBy: ME, workspaceId: W, projectId: project.id, title: 'A' })
  const log = (time: number, notes?: string, taskId = task.id) => () => tasks.createTimesheet({ createdBy: ME, workspaceId: W, taskId, time, notes })
  expect(tasks.getTaskTime(W, task.id)).toBe(0)
  const a = log(90_000, 'first pass')()
  const b = log(MAX_TIME)()
  expect(a).toMatchObject({ taskId: task.id, time: 90_000, notes: 'first pass', createdBy: ME })
  expect(a.id).toMatch(/^[0-9a-z]{12}$/)
  expect(b.notes).toBe('')
  expect(tasks.getTaskTime(W, task.id)).toBe(90_000 + MAX_TIME)
  expect(tasks.getTimesheets(W, task.id).map((t) => t.id).sort()).toEqual([a.id, b.id].sort())
  failsWith('invalid', log(0))
  failsWith('invalid', log(-5))
  failsWith('invalid', log(1.5))
  failsWith('invalid', log(MAX_TIME + 1))
  failsWith('invalid', log(1, 'x'.repeat(MAX_NOTES + 1)))
  expect(log(1, 'x'.repeat(MAX_NOTES))).not.toThrow()
  failsWith('not_found', log(1, '', 'nope'))
  tasks.setTaskStatus(W, task.id, 'done')
  expect(log(1)).not.toThrow()
  tasks.deleteTimesheet(W, a.id)
  expect(tasks.getTimesheets(W, task.id).some((t) => t.id === a.id)).toBe(false)
  failsWith('not_found', () => tasks.deleteTimesheet(W, a.id))
  failsWith('not_found', () => tasks.deleteTimesheet(OTHER, b.id))
  tasks.setTaskStatus(W, task.id, 'deleted')
  failsWith('not_found', log(1))
})
