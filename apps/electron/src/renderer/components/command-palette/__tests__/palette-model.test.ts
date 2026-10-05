import { describe, expect, it } from 'bun:test'
import {
  availableCategories,
  buildGroups,
  cleanQuery,
  filterEntries,
  GROUP_LIMIT,
  hasAnyMatch,
  matchRank,
  resolveCategory,
  rowValue,
  stepCategory,
  type PaletteData,
  type PaletteEntry,
} from '../palette-model'

const entry = (key: string, title: string, keywords?: string[]): PaletteEntry => ({ key, title, keywords })
const chats = (n: number) => Array.from({ length: n }, (_, i) => entry(`chat:c${i}`, `Chat number ${i}`))

function data(over: Partial<PaletteData<PaletteEntry>> = {}): PaletteData<PaletteEntry> {
  return {
    pinned: [],
    recent: [],
    chats: [],
    pages: [],
    settings: [],
    skills: [],
    sources: [],
    actions: [],
    ...over,
  }
}

describe('matchRank', () => {
  it('ranks the start over a word start over anywhere', () => {
    expect(matchRank('Appearance', 'app')).toBe(5)
    expect(matchRank('Open appearance', 'app')).toBe(4)
    expect(matchRank('Unhappy path', 'app')).toBe(3)
    expect(matchRank('Labels', 'app')).toBe(0)
  })

  it('ignores case and accents', () => {
    expect(matchRank('Préférences', cleanQuery('PREF'))).toBe(5)
    expect(matchRank('preferences', cleanQuery('Préf'))).toBe(5)
  })

  it('finds every word of the query in any order', () => {
    expect(matchRank('Fix the login flow', 'flow login')).toBe(2)
    expect(matchRank('Fix the login flow', 'flow logout')).toBe(0)
  })

  it('finds initials from two letters on', () => {
    expect(matchRank('New session', 'ns')).toBe(1)
    expect(matchRank('Keyboard shortcuts', 'ks')).toBe(1)
    expect(matchRank('Keyboard shortcuts', 'k')).toBe(5)
    expect(matchRank('New session', 'sn')).toBe(0)
  })

  it('matches everything with an empty query', () => {
    expect(matchRank('Anything', '')).toBe(1)
  })
})

describe('cleanQuery', () => {
  it('trims, collapses spaces, lowercases and caps the length', () => {
    expect(cleanQuery('  Dark   THEME ')).toBe('dark theme')
    expect(cleanQuery('x'.repeat(500))).toHaveLength(200)
  })
})

describe('filterEntries', () => {
  it('keeps matches only, best first, equal ones in their order', () => {
    const list = [entry('a', 'Rename the workspace'), entry('b', 'Workspace'), entry('c', 'Labels'), entry('d', 'Old workspace notes')]
    expect(filterEntries(list, 'workspace').map((e) => e.key)).toEqual(['b', 'a', 'd'])
  })

  it('uses keywords, never above a title that starts with the query', () => {
    const list = [entry('theme', 'Dark theme', ['appearance']), entry('appearance', 'Appearance')]
    expect(filterEntries(list, 'appear').map((e) => e.key)).toEqual(['appearance', 'theme'])
  })

  it('returns everything, in order, for an empty query', () => {
    const list = chats(3)
    expect(filterEntries(list, '')).toEqual(list)
  })
})

describe('categories', () => {
  it('has All and only the sections with entries', () => {
    expect(availableCategories(data())).toEqual(['all'])
    expect(availableCategories(data({ chats: chats(1), actions: [entry('x', 'New chat')] }))).toEqual(['all', 'chats', 'actions'])
  })

  it('falls back to All when the asked category is empty', () => {
    expect(resolveCategory(['all', 'chats'], 'skills')).toBe('all')
    expect(resolveCategory(['all', 'chats'], 'chats')).toBe('chats')
  })

  it('steps through the tabs with Tab and Shift+Tab, wrapping', () => {
    const tabs = availableCategories(data({ chats: chats(1), settings: [entry('s', 'App')] }))
    expect(stepCategory(tabs, 'all', 1)).toBe('chats')
    expect(stepCategory(tabs, 'settings', 1)).toBe('all')
    expect(stepCategory(tabs, 'all', -1)).toBe('settings')
    expect(stepCategory(tabs, 'skills', 1)).toBe('chats')
  })
})

describe('buildGroups', () => {
  const pinnedChat = entry('chat:c1', 'Chat number 1')
  const recentChat = entry('chat:c2', 'Chat number 2')
  const full = data({
    pinned: [pinnedChat],
    recent: [recentChat, ...chats(9).slice(3)],
    chats: chats(9),
    pages: [entry('page:tasks', 'Tasks'), entry('page:chats', 'Chats')],
    settings: [entry('settings:appearance', 'Appearance'), entry('settings:app', 'App')],
    actions: [entry('action:newChat', 'New chat')],
  })

  it('opens All with Pinned and Recent, then every section in tab order', () => {
    const groups = buildGroups(full, 'all', '')
    expect(groups.map((g) => g.key)).toEqual(['pinned', 'recent', 'chats', 'pages', 'settings', 'actions'])
    expect(groups[1]!.items).toHaveLength(GROUP_LIMIT)
  })

  it('leaves the chats Pinned and Recent show out of All\'s Chats', () => {
    const chatsGroup = buildGroups(full, 'all', '').find((g) => g.key === 'chats')!
    const shown = new Set(['chat:c1', 'chat:c2', 'chat:c3', 'chat:c4', 'chat:c5', 'chat:c6'])
    expect(chatsGroup.items.some((item) => shown.has(item.key))).toBe(false)
    expect(chatsGroup.items.map((i) => i.key)).toEqual(['chat:c0', 'chat:c7', 'chat:c8'])
  })

  it('drops Pinned and Recent while searching, and caps each group', () => {
    const groups = buildGroups(full, 'all', 'chat')
    expect(groups.map((g) => g.key)).toEqual(['chats', 'pages', 'actions'])
    expect(groups[0]!.items).toHaveLength(GROUP_LIMIT)
  })

  it('lists a tab in full, without Pinned or Recent', () => {
    const groups = buildGroups(full, 'chats', '')
    expect(groups.map((g) => g.key)).toEqual(['chats'])
    expect(groups[0]!.items).toHaveLength(9)
  })

  it('is empty when nothing matches', () => {
    expect(buildGroups(full, 'all', 'zzz')).toEqual([])
    expect(buildGroups(full, 'settings', 'chat')).toEqual([])
  })
})

describe('hasAnyMatch', () => {
  it('is false only when no section finds the query', () => {
    const d = data({ settings: [entry('settings:labels', 'Labels')] })
    expect(hasAnyMatch(d, 'lab')).toBe(true)
    expect(hasAnyMatch(d, 'zzz')).toBe(false)
  })
})

describe('rowValue', () => {
  it('is unique per group', () => {
    const chat = entry('chat:c1', 'Chat')
    expect(rowValue('pinned', chat)).not.toBe(rowValue('chats', chat))
  })
})
