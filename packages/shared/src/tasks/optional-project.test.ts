import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createComment, getComments } from '../comments/index.ts'
import { openDb } from '../db/index.ts'
import { pushSchema } from '../db/push.ts'
import { getNotifications } from '../notifications/index.ts'
import { createProjectsStore } from '../projects/index.ts'
import { createTasksStore } from './index.ts'

const workspaceId = crypto.randomUUID()
const actor = `user:${crypto.randomUUID()}`
const assignee = `user:${crypto.randomUUID()}`
const resource = { type: 'url' as const, title: 'Brief', ref: 'https://example.test/brief' }

test('workspace tasks need no projects and preserve their fields through scoped linking and unlinking', async () => {
  const db = openDb(':memory:')
  await pushSchema(db)
  const projects = createProjectsStore(db)
  const tasks = createTasksStore(db, projects)
  expect(projects.getProjects(workspaceId)).toEqual([])
  const created = tasks.createTask({ workspaceId, title: 'Unlinked launch', description: 'Original brief', assignees: [assignee], dueAt: 1_800_000_000_000, resources: [resource], createdBy: actor })
  const explicit = tasks.createTask({ workspaceId, projectId: null, title: 'Explicitly unlinked', createdBy: actor })
  expect(created.projectId).toBeNull()
  expect(explicit.projectId).toBeNull()
  expect(projects.getProjects(workspaceId)).toEqual([])
  const started = tasks.setTaskStatus(workspaceId, created.id, 'doing', actor)
  const comment = createComment({ workspaceId, entity: `task:${created.id}`, content: 'Original comment', createdBy: actor }, db)
  const sheet = tasks.createTimesheet({ workspaceId, taskId: created.id, time: 60_000, createdBy: actor })
  const project = projects.createProject({ workspaceId, title: 'Selected project', createdBy: actor })
  const foreign = projects.createProject({ workspaceId: crypto.randomUUID(), title: 'Foreign project', createdBy: actor })
  expect(() => tasks.updateTask(workspaceId, created.id, { projectId: foreign.id, expectedUpdatedAt: started.updatedAt }, actor)).toThrow('does not exist')
  expect(() => tasks.createTask({ workspaceId, projectId: foreign.id, title: 'Forbidden link', createdBy: actor })).toThrow('does not exist')
  expect(() => tasks.updateTask(foreign.id, created.id, { projectId: null }, actor)).toThrow('does not exist')
  expect(tasks.getTask(foreign.id, created.id)).toBeUndefined()
  const linked = tasks.updateTask(workspaceId, created.id, { projectId: project.id, expectedUpdatedAt: started.updatedAt }, actor)
  expect(() => tasks.updateTask(workspaceId, created.id, { projectId: null, expectedUpdatedAt: started.updatedAt }, actor)).toThrow('changed')
  const edited = tasks.updateTask(workspaceId, created.id, { description: 'Updated brief', expectedUpdatedAt: linked.updatedAt }, actor)
  expect(edited.projectId).toBe(project.id)
  const unlinked = tasks.updateTask(workspaceId, created.id, { projectId: null, expectedUpdatedAt: edited.updatedAt }, assignee)
  expect(unlinked).toEqual({ ...started, projectId: null, description: 'Updated brief', updatedAt: unlinked.updatedAt })
  expect(tasks.getTasks(workspaceId)).toContainEqual(unlinked)
  expect(tasks.getTasks(workspaceId, { assignee })).toEqual([unlinked])
  expect(tasks.getTasks(workspaceId, { projectId: project.id })).toEqual([])
  expect(tasks.searchTasks(workspaceId, 'launch')).toEqual([unlinked])
  expect(tasks.getTimesheets(workspaceId, created.id)).toEqual([sheet])
  expect(getNotifications(assignee.slice(5), workspaceId, db)).toHaveLength(1)
  const comments = getComments(workspaceId, `task:${created.id}`, {}, db).items
  expect(comments).toContainEqual(comment)
  expect(comments.filter((item) => item.event?.kind === 'project').map((item) => item.event)).toEqual([
    { kind: 'project', from: null, to: project.id },
    { kind: 'project', from: project.id, to: null },
  ])
  projects.setProjectStatus(workspaceId, project.id, 'deleted')
  expect(tasks.getTask(workspaceId, created.id)).toEqual(unlinked)
  expect(() => tasks.updateTask(workspaceId, created.id, { projectId: project.id }, actor)).toThrow('does not exist')
})

test('a physical old-row schema push makes project_id nullable without force or losing task-related data', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'otto-test-optional-project-'))
  const path = join(directory, 'compatibility.db')
  let db = openDb(path)
  const close = () => (db as unknown as { $client: { close(): void } }).$client.close()
  try {
    await pushSchema(db)
    const projects = createProjectsStore(db)
    const project = projects.createProject({ workspaceId, title: 'Original project', createdBy: actor })
    const id = crypto.randomUUID()
    db.run(sql.raw('DROP TABLE tasks'))
    db.run(sql.raw("CREATE TABLE tasks (id text PRIMARY KEY NOT NULL, workspace_id text NOT NULL, project_id text NOT NULL, title text NOT NULL, description text DEFAULT '' NOT NULL, status text DEFAULT 'todo' NOT NULL, due_at integer, assignees text DEFAULT '[]' NOT NULL, resources text DEFAULT '[]' NOT NULL, created_by text NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL)"))
    db.run(sql.raw('CREATE INDEX tasks_workspace_project ON tasks (workspace_id, project_id, status)'))
    db.run(sql`INSERT INTO tasks VALUES (${id}, ${workspaceId}, ${project.id}, 'Old assigned launch', 'Keep this brief', 'doing', 1800000000000, ${JSON.stringify([assignee])}, ${JSON.stringify([resource])}, ${actor}, 100, 200)`)
    const before = createTasksStore(db, projects).getTask(workspaceId, id)!
    const comment = createComment({ workspaceId, entity: `task:${id}`, content: 'Keep this comment', createdBy: actor }, db)
    const sheet = createTasksStore(db, projects).createTimesheet({ workspaceId, taskId: id, time: 1000, createdBy: actor })
    const labelId = crypto.randomUUID()
    db.run(sql`INSERT INTO labels (id, workspace_id, slug, title, position) VALUES (${labelId}, ${workspaceId}, 'important', 'Important', 0)`)
    db.run(sql`INSERT INTO labels_entities (workspace_id, label_id, entity) VALUES (${workspaceId}, ${labelId}, ${`task:${id}`})`)
    const labels = db.all(sql`SELECT * FROM labels_entities WHERE entity = ${`task:${id}`}`)
    const activity = getComments(workspaceId, `task:${id}`, {}, db).items
    const statements = await pushSchema(db)
    expect(statements.join('\n')).toContain('INSERT INTO `__new_tasks`')
    expect(db.all(sql`PRAGMA table_info(tasks)`).find((column: any) => column.name === 'project_id')).toMatchObject({ notnull: 0 })
    expect(createTasksStore(db, projects).getTask(workspaceId, id)).toEqual(before)
    expect(getComments(workspaceId, `task:${id}`, {}, db).items).toEqual(activity)
    expect(activity).toContainEqual(comment)
    expect(createTasksStore(db, projects).getTimesheets(workspaceId, id)).toEqual([sheet])
    expect(db.all(sql`SELECT * FROM labels_entities WHERE entity = ${`task:${id}`}`)).toEqual(labels)
    expect((await pushSchema(db)).filter((statement) => statement.includes('`tasks`') || statement.includes('`__new_tasks`'))).toEqual([])
    const zeroWorkspace = crypto.randomUUID()
    const store = createTasksStore(db, projects)
    const unlinked = store.createTask({ workspaceId: zeroWorkspace, title: 'Zero project task', createdBy: actor })
    expect(projects.getProjects(zeroWorkspace)).toEqual([])
    expect(unlinked.projectId).toBeNull()
    expect(() => store.updateTask(zeroWorkspace, unlinked.id, { projectId: project.id }, actor)).toThrow('does not exist')
    const selected = projects.createProject({ workspaceId: zeroWorkspace, title: 'Selected after creation', createdBy: actor })
    const linked = store.updateTask(zeroWorkspace, unlinked.id, { projectId: selected.id, expectedUpdatedAt: unlinked.updatedAt }, actor)
    const edited = store.updateTask(zeroWorkspace, unlinked.id, { title: 'Zero project task updated', expectedUpdatedAt: linked.updatedAt }, actor)
    expect(edited.projectId).toBe(selected.id)
    expect(() => store.updateTask(zeroWorkspace, unlinked.id, { projectId: null, expectedUpdatedAt: linked.updatedAt }, actor)).toThrow('changed')
    const final = store.updateTask(zeroWorkspace, unlinked.id, { projectId: null, expectedUpdatedAt: edited.updatedAt }, actor)
    close()
    db = openDb(path)
    const reopened = createTasksStore(db, createProjectsStore(db))
    expect(reopened.getTask(workspaceId, id)).toEqual(before)
    expect(reopened.getTask(zeroWorkspace, unlinked.id)).toEqual(final)
    expect(reopened.getTasks(zeroWorkspace)).toEqual([final])
    expect(reopened.searchTasks(zeroWorkspace, 'Zero')).toEqual([final])
    expect(db.all(sql`SELECT * FROM labels_entities WHERE entity = ${`task:${id}`}`)).toEqual(labels)
  } finally {
    close()
    rmSync(directory, { recursive: true, force: true })
  }
})
