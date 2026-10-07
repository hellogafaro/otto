/**
 * What needs you, for the composer's Notifications button and list (docs/composer.md W5), from the data that already
 * exists: the workspace's chats waiting on you (a pending permission or credential request), then its chats with
 * news (`hasUnread`, per viewer: an agent's reply or someone else's message since you last read it, so a DM or a
 * group counts too), then your unread notifications (Home's Notifications rows:
 * mentions, assignments). `count` is all of them; the button and the list show only while it is above 0. `recent` is
 * every chat of the workspace in that order (`rankChats`), for Home's Chats card.
 */

import { useMemo } from 'react'
import { useAtomValue } from 'jotai'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { useAppShellContext } from '@/context/app-shell-context'
import { useNotifications } from '@/hooks/use-notifications'
import { rankChats } from '@/pages/home/home-rules'
import { isUnread } from '@/pages/home/notification-rules'

export function useAttention() {
  const { activeWorkspaceId, workspaces, pendingPermissions, pendingCredentials } = useAppShellContext()
  const sessions = useAtomValue(sessionMetaMapAtom)
  const { notifications, setStatus } = useNotifications()

  return useMemo(() => {
    // The workspace's chats, as the Chats page reads them (a remote workspace's carry its remote id).
    const remoteId = workspaces.find((w) => w.id === activeWorkspaceId)?.remoteServer?.remoteWorkspaceId
    const own = [...sessions.values()].filter((meta) => !activeWorkspaceId || meta.workspaceId === activeWorkspaceId || meta.workspaceId === remoteId)
    const recent = rankChats(own, (id) => (pendingPermissions.get(id)?.length ?? 0) + (pendingCredentials.get(id)?.length ?? 0) > 0)
    const chats = recent.filter(({ meta, waiting }) => waiting || meta.hasUnread)
    const unread = notifications.filter(isUnread)
    return { chats, recent, notifications: unread, count: chats.length + unread.length, setStatus }
  }, [sessions, notifications, setStatus, activeWorkspaceId, workspaces, pendingPermissions, pendingCredentials])
}
