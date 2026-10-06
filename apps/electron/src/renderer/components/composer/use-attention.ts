/**
 * What needs you, for the composer's Inbox button and list (docs/composer.md W5), from the data that already
 * exists: the workspace's chats waiting on you (a pending permission or credential request), then its chats with
 * news (`hasUnread`: a run finished while you were away), then your unread notifications (the Inbox page's rows:
 * mentions, assignments). `count` is all of them; the button and the list show only while it is above 0.
 */

import { useMemo } from 'react'
import { useAtomValue } from 'jotai'
import { sessionMetaMapAtom, type SessionMeta } from '@/atoms/sessions'
import { useAppShellContext } from '@/context/app-shell-context'
import { useNotifications } from '@/hooks/use-notifications'
import { isUnread } from '@/pages/inbox/inbox-rules'

export function useAttention() {
  const { activeWorkspaceId, workspaces, pendingPermissions, pendingCredentials } = useAppShellContext()
  const sessions = useAtomValue(sessionMetaMapAtom)
  const { notifications, setStatus } = useNotifications()

  return useMemo(() => {
    // The workspace's chats, as the Chats page reads them (a remote workspace's carry its remote id).
    const remoteId = workspaces.find((w) => w.id === activeWorkspaceId)?.remoteServer?.remoteWorkspaceId
    const waiting: SessionMeta[] = []
    const ready: SessionMeta[] = []
    for (const meta of sessions.values()) {
      if (meta.hidden || meta.isArchived) continue
      if (activeWorkspaceId && meta.workspaceId !== activeWorkspaceId && meta.workspaceId !== remoteId) continue
      if ((pendingPermissions.get(meta.id)?.length ?? 0) + (pendingCredentials.get(meta.id)?.length ?? 0) > 0) waiting.push(meta)
      else if (meta.hasUnread) ready.push(meta)
    }
    ready.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
    const chats = [...waiting.map((meta) => ({ meta, waiting: true })), ...ready.map((meta) => ({ meta, waiting: false }))]
    const unread = notifications.filter(isUnread)
    return { chats, notifications: unread, count: chats.length + unread.length, setStatus }
  }, [sessions, notifications, setStatus, activeWorkspaceId, workspaces, pendingPermissions, pendingCredentials])
}
