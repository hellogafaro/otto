import { describe, expect, it } from 'bun:test'
import { chatFiltersFromRoute, chatFiltersRoute, matchesChatFilters, NO_CHAT_FILTERS } from '../use-chat-filters'
import type { SessionMeta } from '@/atoms/sessions'

const all = { kind: 'allSessions' } as const

describe('chat filters in the route', () => {
  it('uses the one-filter routes for a single value', () => {
    expect(chatFiltersRoute(NO_CHAT_FILTERS)).toBe('allSessions')
    expect(chatFiltersRoute({ ...NO_CHAT_FILTERS, status: ['todo'] })).toBe('state/todo')
    expect(chatFiltersRoute({ ...NO_CHAT_FILTERS, label: ['bug'] })).toBe('label/bug')
    expect(chatFiltersRoute({ ...NO_CHAT_FILTERS, flagged: true })).toBe('flagged')
    expect(chatFiltersRoute({ ...NO_CHAT_FILTERS, archived: true })).toBe('archived')
  })

  it('puts combined and repeated values in a query part, and reads them back', () => {
    const filters = { status: ['todo', 'done'], label: ['research'], flagged: true, archived: false }
    const route = chatFiltersRoute(filters)
    expect(route).toBe('allSessions?status=todo&status=done&label=research&flagged=true')
    expect(chatFiltersFromRoute(route, all)).toEqual(filters)
  })

  it('reads a one-filter route from its filter', () => {
    expect(chatFiltersFromRoute('state/todo', { kind: 'state', stateId: 'todo' })).toEqual({ ...NO_CHAT_FILTERS, status: ['todo'] })
    expect(chatFiltersFromRoute('flagged', { kind: 'flagged' })).toEqual({ ...NO_CHAT_FILTERS, flagged: true })
    expect(chatFiltersFromRoute(null, all)).toEqual(NO_CHAT_FILTERS)
  })
})

describe('matchesChatFilters', () => {
  const chat = (over: Partial<SessionMeta>): SessionMeta => ({ id: 'a', workspaceId: 'w', ...over })
  const labels = [{ id: 'research', name: 'Research' }, { id: 'design', name: 'Design' }] as never

  it('ORs the values of a field and ANDs the fields', () => {
    const f = { status: ['todo', 'done'], label: ['research', 'design'], flagged: true, archived: false }
    expect(matchesChatFilters(chat({ sessionStatus: 'done', labels: ['design'], isFlagged: true }), f, labels)).toBe(true)
    expect(matchesChatFilters(chat({ sessionStatus: 'backlog', labels: ['design'], isFlagged: true }), f, labels)).toBe(false)
    expect(matchesChatFilters(chat({ sessionStatus: 'todo', labels: [], isFlagged: true }), f, labels)).toBe(false)
    expect(matchesChatFilters(chat({ sessionStatus: 'todo', labels: ['research'] }), f, labels)).toBe(false)
  })

  it('keeps only archived chats under Archived', () => {
    const f = { ...NO_CHAT_FILTERS, archived: true }
    expect(matchesChatFilters(chat({ isArchived: true }), f, [])).toBe(true)
    expect(matchesChatFilters(chat({}), f, [])).toBe(false)
  })
})
