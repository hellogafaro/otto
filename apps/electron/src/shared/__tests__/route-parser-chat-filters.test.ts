import { describe, expect, it } from 'bun:test'
import { buildRouteFromNavigationState, parseRouteToNavigationState } from '../route-parser'
import { routes } from '../routes'
import { EMPTY_CHAT_FILTERS, normalizeChatFilters } from '../chat-filters'
import { isSessionsNavigation } from '../types'

function sessions(route: string) {
  const state = parseRouteToNavigationState(route)
  if (!state || !isSessionsNavigation(state)) throw new Error(`expected a sessions state for ${route}`)
  return state
}

describe('Chats filters in the route string', () => {
  it('exposes the combined filters, with repeated keys', () => {
    const state = sessions('allSessions?status=todo&status=done&label=research&label=design&flagged=1&archived=1')
    expect(state.filters).toEqual({ status: ['todo', 'done'], label: ['research', 'design'], flagged: true, archived: true })
    expect(state.details).toBeNull()
  })

  it('keeps the filters with a chat open', () => {
    const state = sessions('allSessions/session/abc?status=todo&label=a')
    expect(state.filters).toEqual({ status: ['todo'], label: ['a'], flagged: false, archived: false })
    expect(state.details).toEqual({ type: 'session', sessionId: 'abc' })
  })

  it('has empty filters on the plain index', () => {
    expect(sessions('allSessions').filters).toEqual(EMPTY_CHAT_FILTERS)
  })

  it('keeps the older single filter field: the first status, label, flagged, archived', () => {
    expect(sessions('allSessions?status=todo&status=done').filter).toEqual({ kind: 'state', stateId: 'todo' })
    expect(sessions('allSessions?label=b&flagged=1').filter).toEqual({ kind: 'label', labelId: 'b' })
    expect(sessions('allSessions?flagged=1&archived=1').filter).toEqual({ kind: 'flagged' })
    expect(sessions('allSessions?archived=1').filter).toEqual({ kind: 'archived' })
    expect(sessions('allSessions').filter).toEqual({ kind: 'allSessions' })
  })

  it('round-trips the query, with repeated keys and encoding', () => {
    for (const route of [
      'allSessions?status=todo&status=done&label=a&flagged=1&archived=1',
      'allSessions/session/abc?status=todo&status=done&label=a',
      'allSessions?label=a+b%26c%3Dd&label=%C3%A9',
      'allSessions?archived=1',
    ]) {
      expect(buildRouteFromNavigationState(sessions(route))).toBe(route)
    }
  })

  it('normalizes: fixed key order, duplicates and empties dropped', () => {
    expect(buildRouteFromNavigationState(sessions('allSessions?archived=1&label=b&status=x&status=x&flagged=true&status='))).toBe(
      'allSessions?status=x&label=b&flagged=1&archived=1',
    )
  })

  it('translates the older single-value strings to the query form', () => {
    expect(sessions('state/todo').filters).toEqual(normalizeChatFilters({ status: ['todo'] }))
    expect(sessions('label/a%20b').filters).toEqual(normalizeChatFilters({ label: ['a b'] }))
    expect(sessions('flagged').filters).toEqual(normalizeChatFilters({ flagged: true }))
    expect(sessions('archived/session/x').filters).toEqual(normalizeChatFilters({ archived: true }))
    expect(buildRouteFromNavigationState(sessions('state/todo/session/abc'))).toBe('allSessions/session/abc?status=todo')
    expect(sessions('allSessions/state/todo').filters).toEqual(normalizeChatFilters({ status: ['todo'] }))
  })

  it('builds the query form from a state that has only the older filter', () => {
    expect(buildRouteFromNavigationState({ navigator: 'sessions', filter: { kind: 'state', stateId: 'todo' }, details: null })).toBe('allSessions?status=todo')
  })
})

describe('routes.view.allSessions', () => {
  it('keeps the chat id form', () => {
    expect(routes.view.allSessions()).toBe('allSessions')
    expect(routes.view.allSessions('abc')).toBe('allSessions/session/abc')
  })

  it('takes filters, with or without a chat', () => {
    expect(routes.view.allSessions({ status: ['todo', 'done'], label: ['a'], flagged: true })).toBe('allSessions?status=todo&status=done&label=a&flagged=1')
    expect(routes.view.allSessions('abc', { archived: true })).toBe('allSessions/session/abc?archived=1')
    expect(routes.view.allSessions({})).toBe('allSessions')
    expect(routes.view.allSessions('abc', { status: [] })).toBe('allSessions/session/abc')
  })

  it('builds strings that parse back to the filters', () => {
    const filters = { status: ['todo', 'a b'], label: ['x&y'], flagged: true, archived: false }
    expect(sessions(routes.view.allSessions('abc', filters)).filters).toEqual(filters)
  })
})
