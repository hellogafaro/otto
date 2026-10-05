/**
 * Tasks route: the section root only (no detail route yet). Route string ⇄ NavigationState ⇄ panel key.
 */

import { describe, test, expect } from 'bun:test'
import {
  isCompoundRoute,
  parseCompoundRoute,
  parseRouteToNavigationState,
  buildRouteFromNavigationState,
} from '../route-parser'
import { getNavigationStateKey, parseNavigationStateKey, isTasksNavigation } from '../types'
import { routes } from '../routes'

describe('tasks route', () => {
  test('the route builder emits the tasks prefix', () => {
    expect(routes.view.tasks()).toBe('tasks')
  })

  test('tasks is a compound route prefix', () => {
    expect(isCompoundRoute('tasks')).toBe(true)
  })

  test('parses to the tasks navigation state and builds back', () => {
    expect(parseCompoundRoute('tasks')).toEqual({ navigator: 'tasks', details: null })
    const state = parseRouteToNavigationState('tasks')
    expect(state).toEqual({ navigator: 'tasks' })
    expect(state && isTasksNavigation(state)).toBe(true)
    expect(buildRouteFromNavigationState(state!)).toBe('tasks')
  })

  test('has no detail route yet', () => {
    expect(parseCompoundRoute('tasks/task/t1')).toBeNull()
    expect(parseRouteToNavigationState('tasks/task/t1')).toBeNull()
  })

  test('panel key round-trip', () => {
    expect(getNavigationStateKey({ navigator: 'tasks' })).toBe('tasks')
    expect(parseNavigationStateKey('tasks')).toEqual({ navigator: 'tasks' })
  })
})
