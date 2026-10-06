/**
 * Tasks, Projects, Library and Skills routes: route string ⇄ NavigationState, with the search each one carries.
 */

import { describe, test, expect } from 'bun:test'
import { isCompoundRoute, parseRouteToNavigationState, buildRouteFromNavigationState } from '../route-parser'
import { isLibraryNavigation, isProjectsNavigation, isTasksNavigation, type NavigationState } from '../types'
import { routes } from '../routes'
import { normalizeLibrarySearch, normalizeProjectsSearch, normalizeSkillsSearch, normalizeTasksSearch } from '../section-search'

const CASES: Array<[route: string, state: NavigationState]> = [
  ['tasks', { navigator: 'tasks', search: {}, details: null }],
  ['tasks/task/t1', { navigator: 'tasks', search: {}, details: { type: 'task', taskId: 't1' } }],
  [
    'tasks?project=p1&assignee=user%3Au1&status=todo&status=doing&archived=1',
    { navigator: 'tasks', search: { project: 'p1', assignee: 'user:u1', status: ['todo', 'doing'], archived: true }, details: null },
  ],
  ['tasks/task/t1?project=p1', { navigator: 'tasks', search: { project: 'p1' }, details: { type: 'task', taskId: 't1' } }],
  ['projects', { navigator: 'projects', search: {}, details: null }],
  ['projects?status=archived', { navigator: 'projects', search: { status: 'archived' }, details: null }],
  ['projects/project/p1', { navigator: 'projects', search: {}, details: { type: 'project', projectId: 'p1' } }],
  ['projects/project/p1?tab=documents', { navigator: 'projects', search: { tab: 'documents' }, details: { type: 'project', projectId: 'p1' } }],
  ['library', { navigator: 'library', search: {}, details: null }],
  ['library?tab=files&folder=f1&createdBy=agent%3Adefault', { navigator: 'library', search: { tab: 'files', folder: 'f1', createdBy: 'agent:default' }, details: null }],
  ['library/item/i1', { navigator: 'library', search: {}, details: { type: 'item', itemId: 'i1' } }],
  ['library/item/i1?folder=f1', { navigator: 'library', search: { folder: 'f1' }, details: { type: 'item', itemId: 'i1' } }],
  ['skills', { navigator: 'skills', search: {}, details: null }],
  ['skills?scope=global', { navigator: 'skills', search: { scope: 'global' }, details: null }],
  ['skills/skill/review', { navigator: 'skills', search: {}, details: { type: 'skill', skillSlug: 'review' } }],
  ['skills/skill/review?scope=workspace', { navigator: 'skills', search: { scope: 'workspace' }, details: { type: 'skill', skillSlug: 'review' } }],
  ['inbox', { navigator: 'inbox', search: {} }],
  ['inbox?unread=1', { navigator: 'inbox', search: { unread: true } }],
]

describe('tasks, projects and library routes', () => {
  for (const [route, state] of CASES) {
    test(`${route} parses and builds back`, () => {
      expect(parseRouteToNavigationState(route)).toEqual(state)
      expect(buildRouteFromNavigationState(state)).toBe(route)
    })
  }

  test('the prefixes are compound routes, the old pages one is gone', () => {
    for (const route of ['tasks', 'projects', 'library']) expect(isCompoundRoute(route)).toBe(true)
    expect(parseRouteToNavigationState('pages')).toBeNull()
    expect(parseRouteToNavigationState('pages/page/x')).toBeNull()
  })

  test('the type guards match their navigator', () => {
    expect(isTasksNavigation(parseRouteToNavigationState('tasks')!)).toBe(true)
    expect(isProjectsNavigation(parseRouteToNavigationState('projects')!)).toBe(true)
    expect(isLibraryNavigation(parseRouteToNavigationState('library')!)).toBe(true)
  })

  test('rejects a detail segment that is not the section\'s', () => {
    for (const route of ['tasks/project/x', 'projects/task/x', 'library/page/x', 'library/item', 'tasks/task/a/b', 'inbox/x', 'skills/item/x', 'skills/skill']) {
      expect(parseRouteToNavigationState(route), route).toBeNull()
    }
  })

  test('the route builders emit the same strings', () => {
    expect(routes.view.tasks()).toBe('tasks')
    expect(routes.view.tasks({ taskId: 't1', project: 'p1' })).toBe('tasks/task/t1?project=p1')
    expect(routes.view.projects({ status: 'archived' })).toBe('projects?status=archived')
    expect(routes.view.projects({ projectId: 'p1', tab: 'tasks' })).toBe('projects/project/p1?tab=tasks')
    expect(routes.view.library()).toBe('library')
    expect(routes.view.library({ itemId: 'i1', folder: 'f1' })).toBe('library/item/i1?folder=f1')
    expect(routes.view.skills()).toBe('skills')
    expect(routes.view.skills({ skillSlug: 'review', scope: 'project' })).toBe('skills/skill/review?scope=project')
    expect(routes.view.inbox()).toBe('inbox')
    expect(routes.view.inbox({ unread: true })).toBe('inbox?unread=1')
  })
})

describe('section search validators', () => {
  test('tasks: keeps valid keys in a fixed order, drops the rest', () => {
    expect(normalizeTasksSearch({ archived: '1', status: ['done', 'nope', 'todo', 'todo'], assignee: 'user:u1', project: 'p1', x: 'y' })).toEqual({
      project: 'p1',
      assignee: 'user:u1',
      status: ['todo', 'done'],
      archived: true,
    })
    expect(Object.keys(normalizeTasksSearch({ archived: true, project: 'p1' }))).toEqual(['project', 'archived'])
    expect(normalizeTasksSearch({ status: 'doing', archived: '0', project: '' })).toEqual({ status: ['doing'] })
    expect(normalizeTasksSearch()).toEqual({})
  })

  test('projects: a known tab, and only archived as a status', () => {
    expect(normalizeProjectsSearch({ tab: 'files', status: 'archived' })).toEqual({ tab: 'files', status: 'archived' })
    expect(normalizeProjectsSearch({ tab: 'nope', status: 'active' })).toEqual({})
  })

  test('skills: a known scope', () => {
    expect(normalizeSkillsSearch({ scope: 'project', x: '1' })).toEqual({ scope: 'project' })
    expect(normalizeSkillsSearch({ scope: 'nope' })).toEqual({})
  })

  test('library: a known tab, a folder and a creator', () => {
    expect(normalizeLibrarySearch({ tab: 'documents', folder: 'f1', createdBy: 'user:u1' })).toEqual({ tab: 'documents', folder: 'f1', createdBy: 'user:u1' })
    expect(normalizeLibrarySearch({ tab: 'pdf', folder: '' })).toEqual({})
  })
})
