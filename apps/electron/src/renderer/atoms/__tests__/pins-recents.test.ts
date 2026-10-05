import { describe, expect, it } from 'bun:test'
import type { SessionMeta } from '../sessions'
import {
  JUMP_SLOTS,
  MAX_RECENTS,
  chatItem,
  isPinned,
  itemFromRoute,
  itemKey,
  jumpList,
  jumpTarget,
  keyFromRoute,
  pinItem,
  pruneItems,
  recentsNotPinned,
  recordVisit,
  reorderPinned,
  resolveItems,
  sessionsLoadedFor,
  syncPinned,
  togglePinned,
  unpinItem,
  type NavItem,
  type PinnedItem,
  type RecentItem,
} from '../pins-recents'

const chat = (id: string, title = id): NavItem => ({ type: 'chat', id, title, route: `allSessions/session/${id}` })
const meta = (id: string, extra: Partial<SessionMeta> = {}): SessionMeta => ({ id, workspaceId: 'w1', name: `Chat ${id}`, messageCount: 2, ...extra })
const sessions = (...metas: SessionMeta[]) => new Map(metas.map(m => [m.id, m]))
const keys = (items: NavItem[]) => items.map(itemKey)

describe('pins', () => {
  it('pins to the end, once', () => {
    const one = pinItem([], chat('a'), 1)
    const two = pinItem(one, chat('b'), 2)
    expect(keys(two)).toEqual(['chat:a', 'chat:b'])
    expect(pinItem(two, chat('a'), 3)).toBe(two)
    expect(two[0].pinnedAt).toBe(1)
  })

  it('unpins and toggles', () => {
    const pinned = pinItem(pinItem([], chat('a'), 1), chat('b'), 2)
    expect(keys(unpinItem(pinned, chat('a')))).toEqual(['chat:b'])
    expect(isPinned(pinned, { type: 'chat', id: 'b' })).toBe(true)
    expect(keys(togglePinned(pinned, chat('a'), 3))).toEqual(['chat:b'])
    expect(keys(togglePinned(pinned, chat('c'), 3))).toEqual(['chat:a', 'chat:b', 'chat:c'])
  })

  it('keeps types apart: the same id of two types is two items', () => {
    const pinned = pinItem(pinItem([], chat('a'), 1), { type: 'project', id: 'a', title: 'A', route: 'projects' }, 2)
    expect(keys(pinned)).toEqual(['chat:a', 'project:a'])
  })

  it('reorders by keys and keeps the ones not named, after', () => {
    const pinned = ['a', 'b', 'c', 'd'].reduce<PinnedItem[]>((all, id, i) => pinItem(all, chat(id), i), [])
    expect(keys(reorderPinned(pinned, ['chat:c', 'chat:a', 'chat:b']))).toEqual(['chat:c', 'chat:a', 'chat:b', 'chat:d'])
    expect(keys(reorderPinned(pinned, ['chat:x', 'chat:d']))).toEqual(['chat:d', 'chat:a', 'chat:b', 'chat:c'])
  })

  it('syncs a stored title, and returns the same list when nothing changed', () => {
    const pinned = pinItem([], chat('a', 'Old'), 1)
    expect(syncPinned(pinned, chat('a', 'Old'))).toBe(pinned)
    expect(syncPinned(pinned, chat('z', 'Other'))).toBe(pinned)
    expect(syncPinned(pinned, chat('a', 'New'))[0].title).toBe('New')
  })
})

describe('recents', () => {
  it('puts the latest visit first and dedupes', () => {
    let recents: RecentItem[] = []
    recents = recordVisit(recents, chat('a'), 1)
    recents = recordVisit(recents, chat('b'), 2)
    recents = recordVisit(recents, chat('a'), 3)
    expect(keys(recents)).toEqual(['chat:a', 'chat:b'])
    expect(recents[0].visitedAt).toBe(3)
  })

  it('keeps the newest 20', () => {
    let recents: RecentItem[] = []
    for (let i = 0; i < 30; i++) recents = recordVisit(recents, chat(`c${i}`), i)
    expect(recents).toHaveLength(MAX_RECENTS)
    expect(recents[0].id).toBe('c29')
    expect(recents[MAX_RECENTS - 1].id).toBe('c10')
  })

  it('hides what is pinned', () => {
    const pinned = pinItem([], chat('a'), 1)
    const recents = ['a', 'b', 'c'].reduce<RecentItem[]>((all, id, i) => recordVisit(all, chat(id), i), [])
    expect(keys(recentsNotPinned(recents, pinned))).toEqual(['chat:c', 'chat:b'])
  })

  it('prunes missing items and keeps the array when none are missing', () => {
    const recents = ['a', 'b'].reduce<RecentItem[]>((all, id, i) => recordVisit(all, chat(id), i), [])
    expect(pruneItems(recents, () => true)).toBe(recents)
    expect(keys(pruneItems(recents, r => r.id !== 'a'))).toEqual(['chat:b'])
  })
})

describe('jump list (⌘1–⌘9)', () => {
  const pinned = ['p1', 'p2'].reduce<PinnedItem[]>((all, id, i) => pinItem(all, chat(id), i), [])
  const recents = ['r1', 'p1', 'r2'].reduce<RecentItem[]>((all, id, i) => recordVisit(all, chat(id), i), []).reverse()

  it('numbers pinned first, then the recents that are not pinned', () => {
    expect(keys(jumpList(pinned, recents))).toEqual(['chat:p1', 'chat:p2', 'chat:r1', 'chat:r2'])
  })

  it('maps a 1-based number to an item and ignores the rest', () => {
    const list = jumpList(pinned, recents)
    expect(jumpTarget(list, 1)?.id).toBe('p1')
    expect(jumpTarget(list, 4)?.id).toBe('r2')
    expect(jumpTarget(list, 5)).toBeNull()
    expect(jumpTarget(list, 0)).toBeNull()
    expect(jumpTarget(list, 1.5)).toBeNull()
  })

  it('stops at nine', () => {
    const many = Array.from({ length: 12 }, (_, i) => chat(`c${i}`))
    expect(jumpTarget(many, JUMP_SLOTS)?.id).toBe('c8')
    expect(jumpTarget(many, JUMP_SLOTS + 1)).toBeNull()
  })
})

describe('chats', () => {
  it('has one canonical route whatever filter it was opened from', () => {
    expect(chatItem(meta('a')).route).toBe('allSessions/session/a')
    expect(itemFromRoute('flagged/session/a', sessions(meta('a')))?.route).toBe('allSessions/session/a')
    expect(keyFromRoute('state/todo/session/a')).toBe('chat:a')
    expect(keyFromRoute('settings')).toBeNull()
    expect(keyFromRoute(null)).toBeNull()
  })

  it('records only a chat that exists and has something in it', () => {
    expect(itemFromRoute('allSessions/session/a', sessions())).toBeNull()
    expect(itemFromRoute('allSessions/session/a', sessions(meta('a', { name: undefined, messageCount: 0 })))).toBeNull()
    expect(itemFromRoute('allSessions/session/a', sessions(meta('a', { name: undefined, messageCount: 1, preview: 'Hi' })))?.id).toBe('a')
    expect(itemFromRoute('allSessions', sessions(meta('a')))).toBeNull()
  })

  it('shows the live title and drops a chat that is gone', () => {
    const stored = [chat('a', 'Stale'), chat('gone'), { type: 'project', id: 'p', title: 'Kept', route: 'projects' } as NavItem]
    const resolved = resolveItems(stored, sessions(meta('a', { name: 'Fresh' })))
    expect(resolved.map(r => r.title)).toEqual(['Fresh', 'Kept'])
    expect(resolved[0].session?.id).toBe('a')
  })

  it('knows when the sessions belong to the workspace', () => {
    expect(sessionsLoadedFor('w1', sessions(meta('a')))).toBe(true)
    expect(sessionsLoadedFor('w2', sessions(meta('a')))).toBe(false)
    expect(sessionsLoadedFor('w1', sessions())).toBe(false)
    expect(sessionsLoadedFor(null, sessions(meta('a')))).toBe(false)
  })
})
