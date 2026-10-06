/**
 * The signed-in user's inbox in the workspace: notifications newest first, each with the title of its entity and,
 * for a mention, its comment, and the unread count (the sidebar badge). Reloads when the server says it changed.
 * `setStatus` marks some (or 'all') read or unread, `clear` removes them; both return a `MutationResult`.
 * (The native OS notifications and the dock badge are `use-os-notifications.ts`.)
 */

import { useMemo } from 'react'
import { notificationsAtom } from '@/atoms/notifications'
import type { NotificationItem } from '../../shared/types'
import { useWorkspaceList } from './use-workspace-list'

const loadNotifications = () => window.electronAPI.getNotifications()

export function useNotifications() {
  const { items, loaded, refresh, mutate } = useWorkspaceList(notificationsAtom, loadNotifications, 'notifications')

  const actions = useMemo(() => {
    const api = window.electronAPI
    return {
      setStatus: (ids: string[] | 'all', status: 'read' | 'unread') => mutate(() => api.setNotificationStatus(ids, status)),
      clear: (ids: string[] | 'all') => mutate(() => api.clearNotifications(ids)),
    }
  }, [mutate])

  const notifications = items as NotificationItem[]
  const unreadCount = useMemo(() => notifications.filter((item) => item.status === 'unread').length, [notifications])
  return { notifications, unreadCount, loaded, refresh, ...actions }
}
