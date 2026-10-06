import { expect, test } from 'bun:test'
import { openDb } from '../db/index.ts'
import { pushSchema } from '../db/push.ts'
import { createProjectsStore, MAX_RESOURCES, MAX_TITLE, type ProjectErrorCode } from './index.ts'
import { isDomainError } from '../utils/errors.ts'

const W = 'ws1'
const OTHER = 'ws2'

async function setup() {
  const db = openDb(':memory:')
  await pushSchema(db)
  return createProjectsStore(db)
}

function failsWith(code: ProjectErrorCode, run: () => unknown) {
  let error: unknown
  try {
    run()
  } catch (e) {
    error = e
  }
  expect(isDomainError(error) && error.code).toBe(code)
}

test('create returns an active project and makes the creator a contributor', async () => {
  const projects = await setup()
  const project = projects.createProject({ workspaceId: W, title: '  Launch ', description: 'Ship it' })
  expect(project.id).toMatch(/^[0-9a-z]{12}$/)
  expect(project).toMatchObject({ title: 'Launch', description: 'Ship it', status: 'active', resources: [] })
  expect(project.createdAt).toBe(project.updatedAt)
  expect(projects.getProject(W, project.id)).toEqual(project)
  expect(projects.getProjectMembers(W, project.id)).toEqual([{ actor: 'user', role: 'contributor' }])
  const byAgent = projects.createProject({ workspaceId: W, title: 'B', createdBy: 'agent:default' })
  expect(projects.getProjectMembers(W, byAgent.id)).toEqual([{ actor: 'agent:default', role: 'contributor' }])
})

test('create validates the title, the description and the creator', async () => {
  const projects = await setup()
  failsWith('invalid', () => projects.createProject({ workspaceId: W, title: '  ' }))
  failsWith('invalid', () => projects.createProject({ workspaceId: W, title: 'x'.repeat(MAX_TITLE + 1) }))
  failsWith('invalid', () => projects.createProject({ workspaceId: W, title: 'A', description: 5 as never }))
  failsWith('invalid', () => projects.createProject({ workspaceId: W, title: 'A', createdBy: 'bob' }))
  expect(projects.getProjects(W)).toEqual([])
})

test('resources are validated: type, url, lengths, cap', async () => {
  const projects = await setup()
  const make = (resources: unknown) => () => projects.createProject({ workspaceId: W, title: 'A', resources: resources as never })
  const ok = projects.createProject({
    workspaceId: W,
    title: 'A',
    resources: [
      { type: 'url', title: ' Repo ', ref: ' https://example.com/repo ', extra: 1 } as never,
      { type: 'library', title: 'Spec', ref: 'does-not-exist' },
      { type: 'chat', title: 'Kickoff', ref: 'abc' },
    ],
  })
  expect(ok.resources).toEqual([
    { type: 'url', title: 'Repo', ref: 'https://example.com/repo' },
    { type: 'library', title: 'Spec', ref: 'does-not-exist' },
    { type: 'chat', title: 'Kickoff', ref: 'abc' },
  ])
  failsWith('invalid', make('nope'))
  failsWith('invalid', make([{ type: 'file', title: 'A', ref: 'b' }]))
  failsWith('invalid', make([{ type: 'url', title: 'A', ref: 'not a url' }]))
  failsWith('invalid', make([{ type: 'url', title: 'A', ref: 'javascript:alert(1)' }]))
  failsWith('invalid', make([{ type: 'chat', title: '', ref: 'b' }]))
  failsWith('invalid', make([{ type: 'chat', title: 'a'.repeat(201), ref: 'b' }]))
  failsWith('invalid', make([{ type: 'chat', title: 'a', ref: 'b'.repeat(2001) }]))
  failsWith('invalid', make([null]))
  const many = Array.from({ length: MAX_RESOURCES + 1 }, (_, i) => ({ type: 'chat', title: `c${i}`, ref: `${i}` }))
  failsWith('invalid', make(many))
  expect(make(many.slice(0, MAX_RESOURCES))).not.toThrow()
})

test('lists hide archived and deleted unless asked, newest update first, per workspace', async () => {
  const projects = await setup()
  const a = projects.createProject({ workspaceId: W, title: 'A' })
  const b = projects.createProject({ workspaceId: W, title: 'B' })
  const c = projects.createProject({ workspaceId: W, title: 'C' })
  projects.createProject({ workspaceId: OTHER, title: 'Elsewhere' })
  projects.setProjectStatus(W, b.id, 'archived')
  projects.setProjectStatus(W, c.id, 'deleted')
  expect(projects.getProjects(W).map((p) => p.id)).toEqual([a.id])
  expect(projects.getProjects(W, { status: 'archived' }).map((p) => p.id)).toEqual([b.id])
  expect(projects.getProjects(W, { status: 'deleted' }).map((p) => p.id)).toEqual([c.id])
  expect(projects.getProjects(W, { status: ['active', 'archived', 'deleted'] })).toHaveLength(3)
  expect(projects.getProjects(OTHER).map((p) => p.title)).toEqual(['Elsewhere'])
  expect(projects.getProject(OTHER, a.id)).toBeUndefined()
  failsWith('not_found', () => projects.updateProject(OTHER, a.id, { title: 'X' }))
})

test('archive, delete and restore are statuses; the row stays', async () => {
  const projects = await setup()
  const p = projects.createProject({ workspaceId: W, title: 'A' })
  const archived = projects.setProjectStatus(W, p.id, 'archived')
  expect(archived.status).toBe('archived')
  expect(archived.updatedAt).toBeGreaterThan(p.updatedAt)
  expect(projects.setProjectStatus(W, p.id, 'deleted').status).toBe('deleted')
  expect(projects.getProject(W, p.id)?.status).toBe('deleted')
  failsWith('invalid', () => projects.updateProject(W, p.id, { title: 'X' }))
  expect(projects.setProjectStatus(W, p.id, 'active').status).toBe('active')
  expect(projects.updateProject(W, p.id, { title: 'X' }).title).toBe('X')
  failsWith('invalid', () => projects.setProjectStatus(W, p.id, 'gone' as never))
  failsWith('not_found', () => projects.setProjectStatus(W, 'nope', 'archived'))
})

test('update changes only what is given and bumps updatedAt', async () => {
  const projects = await setup()
  const p = projects.createProject({ workspaceId: W, title: 'A', description: 'd' })
  const u = projects.updateProject(W, p.id, { title: 'B', resources: [{ type: 'chat', title: 'c', ref: '1' }] })
  expect(u).toMatchObject({ title: 'B', description: 'd', resources: [{ type: 'chat', title: 'c', ref: '1' }] })
  expect(u.updatedAt).toBeGreaterThan(p.updatedAt)
  expect(u.createdAt).toBe(p.createdAt)
  failsWith('invalid', () => projects.updateProject(W, p.id, { title: '' }))
  failsWith('invalid', () => projects.updateProject(W, p.id, { resources: [{ type: 'x' } as never] }))
  expect(projects.getProject(W, p.id)).toEqual(u)
})

test('a stale expectedUpdatedAt is a conflict and changes nothing', async () => {
  const projects = await setup()
  const p = projects.createProject({ workspaceId: W, title: 'A' })
  const first = projects.updateProject(W, p.id, { title: 'B', expectedUpdatedAt: p.updatedAt })
  failsWith('conflict', () => projects.updateProject(W, p.id, { title: 'C', expectedUpdatedAt: p.updatedAt }))
  expect(projects.getProject(W, p.id)).toEqual(first)
  expect(projects.updateProject(W, p.id, { title: 'D', expectedUpdatedAt: first.updatedAt }).title).toBe('D')
})

test('members: upsert, list, remove, validation', async () => {
  const projects = await setup()
  const p = projects.createProject({ workspaceId: W, title: 'A' })
  projects.setProjectMember(W, p.id, 'agent:default', 'viewer')
  projects.setProjectMember(W, p.id, 'agent:default', 'contributor')
  projects.setProjectMember(W, p.id, 'user', 'viewer')
  expect(projects.getProjectMembers(W, p.id)).toEqual([
    { actor: 'agent:default', role: 'contributor' },
    { actor: 'user', role: 'viewer' },
  ])
  projects.removeProjectMember(W, p.id, 'agent:default')
  expect(projects.getProjectMembers(W, p.id)).toEqual([{ actor: 'user', role: 'viewer' }])
  failsWith('not_found', () => projects.removeProjectMember(W, p.id, 'agent:default'))
  failsWith('invalid', () => projects.setProjectMember(W, p.id, 'bob', 'viewer'))
  failsWith('invalid', () => projects.setProjectMember(W, p.id, 'user', 'owner' as never))
  failsWith('not_found', () => projects.setProjectMember(OTHER, p.id, 'user', 'viewer'))
  failsWith('not_found', () => projects.getProjectMembers(OTHER, p.id))
})
