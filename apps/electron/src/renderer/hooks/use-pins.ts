import { useCallback, useMemo } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import {
  isPinned as isPinnedIn,
  pinnedItemsAtom,
  reorderPinned,
  resolveItems,
  togglePinned,
  type NavItem,
} from '@/atoms/pins-recents'
import { sessionMetaMapAtom, windowWorkspaceIdAtom } from '@/atoms/sessions'

/**
 * The workspace's pinned items, in order, with live titles (a chat whose session is gone
 * is not listed), and what changes them. Nothing is stored before the workspace is known.
 */
export function usePins() {
  const workspaceId = useAtomValue(windowWorkspaceIdAtom)
  const sessions = useAtomValue(sessionMetaMapAtom)
  const [stored, setStored] = useAtom(pinnedItemsAtom(workspaceId ?? ''))

  const pinned = useMemo(() => resolveItems(stored, sessions), [stored, sessions])

  const isPinned = useCallback((item: Pick<NavItem, 'type' | 'id'>) => isPinnedIn(stored, item), [stored])

  const togglePin = useCallback((item: NavItem) => {
    if (workspaceId) setStored(prev => togglePinned(prev, item, Date.now()))
  }, [workspaceId, setStored])

  /** Set the order after a drag: the keys (`itemKey`) in their new order. */
  const reorder = useCallback((orderedKeys: string[]) => {
    if (workspaceId) setStored(prev => reorderPinned(prev, orderedKeys))
  }, [workspaceId, setStored])

  return { pinned, isPinned, togglePin, reorder }
}
