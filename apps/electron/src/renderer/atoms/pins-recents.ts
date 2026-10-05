/**
 * Pins and recents: the sidebar's one dynamic group, and the list ⌘1–⌘9 jump through.
 *
 * Pinned items are an ordered list the user keeps; recents are the last items opened
 * (most recent first, deduped, capped). An item is shown once: a pinned one is not
 * repeated under Recent. Both are small, per workspace, and live in local storage.
 * Only chats are produced today; other types (a project, a task, a routine, a library
 * page, a settings page) are recorded by their own pages with the same shape.
 *
 * Everything here is pure except the two storage atoms at the end.
 */

import { atomWithStorage } from 'jotai/utils'
import { atomFamily } from 'jotai-family'
import * as storage from '@/lib/local-storage'
import { getSessionTitle } from '@/utils/session'
import { parseSessionIdFromRoute } from './current-route'
import { routes, type ViewRoute } from '../../shared/routes'
import type { SessionMeta } from './sessions'

export type NavItemType = 'chat' | 'project' | 'task' | 'routine' | 'library' | 'settings' | (string & {})

/** Anything the sidebar can pin or list as recent. */
export interface NavItem {
  type: NavItemType
  id: string
  /** The title when it was stored: chats show their live title instead. */
  title: string
  route: ViewRoute
}

export interface PinnedItem extends NavItem {
  pinnedAt: number
}

export interface RecentItem extends NavItem {
  visitedAt: number
}

/** A stored item with its live title (and, for a chat, its session) at render time. */
export interface ResolvedItem extends NavItem {
  session?: SessionMeta
}

export const MAX_RECENTS = 20
/** ⌘1–⌘9: the first nine items of the pinned and recent list. */
export const JUMP_SLOTS = 9

export const itemKey = (item: Pick<NavItem, 'type' | 'id'>): string => `${item.type}:${item.id}`

const toNavItem = ({ type, id, title, route }: NavItem): NavItem => ({ type, id, title, route })

// ---------------------------------------------------------------------------
// Pins
// ---------------------------------------------------------------------------

export function isPinned(pinned: readonly NavItem[], item: Pick<NavItem, 'type' | 'id'>): boolean {
  const key = itemKey(item)
  return pinned.some(p => itemKey(p) === key)
}

/** Add to the end; a pinned item stays where it is. */
export function pinItem(pinned: PinnedItem[], item: NavItem, now: number): PinnedItem[] {
  if (isPinned(pinned, item)) return pinned
  return [...pinned, { ...toNavItem(item), pinnedAt: now }]
}

export function unpinItem(pinned: PinnedItem[], item: Pick<NavItem, 'type' | 'id'>): PinnedItem[] {
  const key = itemKey(item)
  return pinned.filter(p => itemKey(p) !== key)
}

export function togglePinned(pinned: PinnedItem[], item: NavItem, now: number): PinnedItem[] {
  return isPinned(pinned, item) ? unpinItem(pinned, item) : pinItem(pinned, item, now)
}

/**
 * The pinned list in the order of `orderedKeys` (what a drag produced). Items not named
 * keep their relative order after the named ones (a hidden item must not be lost).
 */
export function reorderPinned(pinned: PinnedItem[], orderedKeys: readonly string[]): PinnedItem[] {
  const byKey = new Map(pinned.map(p => [itemKey(p), p]))
  const named = orderedKeys.flatMap(key => byKey.get(key) ?? [])
  const namedKeys = new Set(named.map(itemKey))
  return [...named, ...pinned.filter(p => !namedKeys.has(itemKey(p)))]
}

/** Refresh a pinned item's stored title and route when the page that owns it reports a change. */
export function syncPinned(pinned: PinnedItem[], item: NavItem): PinnedItem[] {
  const key = itemKey(item)
  const current = pinned.find(p => itemKey(p) === key)
  if (!current || (current.title === item.title && current.route === item.route)) return pinned
  return pinned.map(p => (p === current ? { ...p, title: item.title, route: item.route } : p))
}

// ---------------------------------------------------------------------------
// Recents
// ---------------------------------------------------------------------------

/** Move (or put) the item at the front, drop its older entry, keep the newest `max`. */
export function recordVisit(recents: RecentItem[], item: NavItem, now: number, max = MAX_RECENTS): RecentItem[] {
  const key = itemKey(item)
  return [{ ...toNavItem(item), visitedAt: now }, ...recents.filter(r => itemKey(r) !== key)].slice(0, max)
}

/** The recents a pinned item does not already show. */
export function recentsNotPinned<T extends NavItem>(recents: readonly T[], pinned: readonly NavItem[]): T[] {
  const pinnedKeys = new Set(pinned.map(itemKey))
  return recents.filter(r => !pinnedKeys.has(itemKey(r)))
}

/** Drop the items `exists` rejects (a deleted chat); the same array when nothing goes. */
export function pruneItems<T extends NavItem>(items: T[], exists: (item: T) => boolean): T[] {
  const kept = items.filter(exists)
  return kept.length === items.length ? items : kept
}

// ---------------------------------------------------------------------------
// Jumping (⌘1–⌘9)
// ---------------------------------------------------------------------------

/** The order the sidebar shows and the numbers follow: pinned first, then the recents not pinned. */
export function jumpList<P extends NavItem, R extends NavItem>(pinned: readonly P[], recents: readonly R[]): (P | R)[] {
  return [...pinned, ...recentsNotPinned(recents, pinned)]
}

/** The item behind jump number `n` (1-based); none for a number with no item or outside 1–9. */
export function jumpTarget<T extends NavItem>(items: readonly T[], n: number): T | null {
  if (!Number.isInteger(n) || n < 1 || n > JUMP_SLOTS) return null
  return items[n - 1] ?? null
}

// ---------------------------------------------------------------------------
// Routes and chats
// ---------------------------------------------------------------------------

/** A chat's item: its canonical route, whatever filter it was opened from. */
export function chatItem(session: SessionMeta): NavItem {
  return {
    type: 'chat',
    id: session.id,
    title: getSessionTitle(session),
    route: routes.view.allSessions(session.id),
  }
}

/** A chat worth remembering: one that has something in it (an empty new chat is not). */
function isWorthRecording(session: SessionMeta): boolean {
  return (session.messageCount ?? 0) > 0 || !!session.name
}

/**
 * The entity the open route shows, if it is one worth recording. Chats only today;
 * the other types plug in here when their pages exist.
 */
export function itemFromRoute(route: ViewRoute | null, sessions: ReadonlyMap<string, SessionMeta>): NavItem | null {
  if (!route) return null
  const sessionId = parseSessionIdFromRoute(route)
  const session = sessionId ? sessions.get(sessionId) : undefined
  return session && isWorthRecording(session) ? chatItem(session) : null
}

/** The entity a route shows, without the worth-recording rule (to mark the open row). */
export function keyFromRoute(route: ViewRoute | null): string | null {
  const sessionId = route ? parseSessionIdFromRoute(route) : null
  return sessionId ? itemKey({ type: 'chat', id: sessionId }) : null
}

/**
 * An item as the sidebar shows it: a chat with its live title, or none when the chat is
 * gone. Other types show what was stored.
 */
export function resolveItem(item: NavItem, sessions: ReadonlyMap<string, SessionMeta>): ResolvedItem | null {
  if (item.type !== 'chat') return toNavItem(item)
  const session = sessions.get(item.id)
  return session ? { ...toNavItem(item), title: getSessionTitle(session), session } : null
}

export function resolveItems(items: readonly NavItem[], sessions: ReadonlyMap<string, SessionMeta>): ResolvedItem[] {
  return items.flatMap(item => resolveItem(item, sessions) ?? [])
}

/** The sessions are loaded for this workspace (the map is not empty or left over from another). */
export function sessionsLoadedFor(workspaceId: string | null, sessions: ReadonlyMap<string, SessionMeta>): boolean {
  if (!workspaceId) return false
  const first = sessions.values().next().value
  return first !== undefined && first.workspaceId === workspaceId
}

// ---------------------------------------------------------------------------
// Storage: one list per workspace
// ---------------------------------------------------------------------------

export const pinnedItemsAtom = atomFamily((workspaceId: string) =>
  atomWithStorage<PinnedItem[]>(storage.getKeyString(storage.KEYS.pinnedItems, workspaceId), [], undefined, { getOnInit: true }),
)

export const recentItemsAtom = atomFamily((workspaceId: string) =>
  atomWithStorage<RecentItem[]>(storage.getKeyString(storage.KEYS.recentItems, workspaceId), [], undefined, { getOnInit: true }),
)
