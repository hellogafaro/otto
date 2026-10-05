import { useEffect, useMemo } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { currentRouteAtom } from '@/atoms/current-route'
import {
  itemFromRoute,
  itemKey,
  jumpList,
  pinnedItemsAtom,
  pruneItems,
  recentItemsAtom,
  recentsNotPinned,
  recordVisit,
  resolveItems,
  sessionsLoadedFor,
  syncPinned,
  type ResolvedItem,
} from '@/atoms/pins-recents'
import { sessionMetaMapAtom, windowWorkspaceIdAtom } from '@/atoms/sessions'
import { usePins } from './use-pins'

/** The recent items a pin does not already show, most recent first, with live titles. */
export function useRecents(): ResolvedItem[] {
  const workspaceId = useAtomValue(windowWorkspaceIdAtom)
  const sessions = useAtomValue(sessionMetaMapAtom)
  const stored = useAtomValue(recentItemsAtom(workspaceId ?? ''))
  const { pinned } = usePins()

  return useMemo(
    () => recentsNotPinned(resolveItems(stored, sessions), pinned),
    [stored, sessions, pinned],
  )
}

/** What ⌘1–⌘9 and the sidebar number: the pinned items, then the recents not pinned. */
export function useJumpItems(): ResolvedItem[] {
  const { pinned } = usePins()
  const recents = useRecents()
  return useMemo(() => jumpList(pinned, recents), [pinned, recents])
}

/**
 * Record the open route as a recent item (and refresh its pin's stored title), and drop
 * the chats that no longer exist from both lists once the sessions are loaded.
 * Mounted once, by the shell.
 */
export function useRecordRecent(): void {
  const workspaceId = useAtomValue(windowWorkspaceIdAtom)
  const route = useAtomValue(currentRouteAtom)
  const sessions = useAtomValue(sessionMetaMapAtom)
  const [recents, setRecents] = useAtom(recentItemsAtom(workspaceId ?? ''))
  const [pinned, setPinned] = useAtom(pinnedItemsAtom(workspaceId ?? ''))

  const item = useMemo(() => itemFromRoute(route, sessions), [route, sessions])
  const key = item ? itemKey(item) : null
  const title = item?.title

  useEffect(() => {
    if (!workspaceId || !item) return
    setRecents(prev => recordVisit(prev, item, Date.now()))
    setPinned(prev => syncPinned(prev, item))
    // Only a new entity or a new title records: the sessions map changes on every message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, key, title])

  const loaded = sessionsLoadedFor(workspaceId, sessions)
  useEffect(() => {
    if (!loaded) return
    const exists = (entry: { type: string; id: string }) => entry.type !== 'chat' || sessions.has(entry.id)
    const keptRecents = pruneItems(recents, exists)
    const keptPinned = pruneItems(pinned, exists)
    if (keptRecents !== recents) setRecents(keptRecents)
    if (keptPinned !== pinned) setPinned(keptPinned)
  }, [loaded, sessions, recents, pinned, setRecents, setPinned])
}
