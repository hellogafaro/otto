/**
 * A notification as a `ListRow`'s props, shared by the Inbox page and the composer's Inbox list (its `sm` rows):
 * the sender's avatar, the sentence ("Maria mentioned you in Fix login", the title looked up live) with the
 * comment's first line muted after a mention, an unread dot, the time; a click opens what it is about (a mention:
 * the task or project its comment is on) and marks it read. The surface loads the entity lists (`useEntityData`).
 */

import type { ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import type { ListRow } from '@workspace/ui/components/list-group'
import { toast } from '@workspace/ui/components/sonner'
import { describeEntity, plainEntityText } from '@/components/entities/entity-tokens'
import { useEntityLabel, useEntityLists } from '@/components/entities/entity-chip'
import { ActorAvatar } from '@/components/people/actor-avatar'
import { useNavigation } from '@/contexts/navigation-context'
import { useWorkspaceMembers } from '@/hooks/use-workspace-members'
import { shortTimeAgo } from '@/utils/session'
import type { Route } from '../../../shared/routes'
import type { NotificationItem } from '../../../shared/types'
import { getNotificationLineKey, getNotificationTarget, isUnread } from './inbox-rules'

type RowProps = Pick<ComponentProps<typeof ListRow>, 'media' | 'title' | 'muted' | 'marks' | 'end' | 'onClick'>

export function useNotificationRow(setStatus: (ids: string[], status: 'read') => Promise<{ ok: boolean }>) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const lists = useEntityLists()
  const label = useEntityLabel()
  const { nameOf } = useWorkspaceMembers()

  /** The live title of what it is about (the server's while the list loads), "Unavailable" when gone. */
  const titleOf = (item: NotificationItem) => {
    const info = describeEntity(getNotificationTarget(item), lists)
    if (info?.missing) return t('common.unavailable')
    return info?.title ?? item.entityTitle ?? t('common.unavailable')
  }
  const excerptOf = (item: NotificationItem) =>
    item.comment ? plainEntityText(item.comment.content, (entity) => {
      const info = describeEntity(entity, lists)
      return info ? label(info) : entity
    }) : ''

  return (item: NotificationItem): RowProps => {
    const unread = isUnread(item)
    const excerpt = excerptOf(item)
    return {
      media: <ActorAvatar actor={item.createdBy} name={nameOf(item.createdBy)} />,
      title: (
        <>
          {t(getNotificationLineKey(item.type), { name: nameOf(item.createdBy), title: titleOf(item) })}
          {excerpt && <span className="ms-2 text-muted-foreground">{excerpt}</span>}
        </>
      ),
      muted: !unread,
      marks: unread && <span aria-label={t('inbox.unread')} className="size-1.5 shrink-0 rounded-full bg-primary" />,
      end: shortTimeAgo(item.createdAt),
      onClick: () => {
        const route = describeEntity(getNotificationTarget(item), lists)?.route
        if (unread) void setStatus([item.id], 'read').then((result) => { if (!result.ok) toast.error(t('inbox.failed')) })
        if (route) void navigate(route as Route)
      },
    }
  }
}
