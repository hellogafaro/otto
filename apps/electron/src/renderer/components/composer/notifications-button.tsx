/**
 * The composer's Notifications (docs/composer.md W5): the button in the compact bar's attention slot, a 32px ghost
 * icon with a red dot, shown only while something needs you (`useAttention`), and the list it opens above the text in
 * the same surface (`Composer`'s `panel`). The list is Home's rows at `sm`: chats waiting on you, chats with
 * news, then unread notifications (`useNotificationRow`, the Notifications card's own row). Picking one opens it.
 */

import { useTranslation } from 'react-i18next'
import { Bell } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { ListRow } from '@workspace/ui/components/list-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { useEntityData } from '@/components/entities/entity-chip'
import { ChatStatusIcon } from '@/config/session-status-config'
import { useAppShellContext } from '@/context/app-shell-context'
import { useNavigation } from '@/contexts/navigation-context'
import { useNotificationRow } from '@/pages/home/notification-row'
import { getSessionStatus, getSessionTitle, shortTimeAgo } from '@/utils/session'
import { useWorkspaceMembers } from '@/hooks/use-workspace-members'
import type { useAttention } from './use-attention'

type Attention = ReturnType<typeof useAttention>

/** Its tooltip is the label only: the composer shows keys only while a modifier is held (DESIGN.md, Composer). */
export function NotificationsButton({ count, open, onToggle }: { count: number; open: boolean; onToggle: () => void }) {
  const { t } = useTranslation()
  const label = t('composer.notificationsCount', { count })
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={label}
            aria-expanded={open}
            className="relative"
            onClick={onToggle}
          />
        }
      >
        <Bell />
        <span aria-hidden className="absolute top-1.5 right-1.5 size-2 rounded-full bg-destructive" />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function NotificationsList({ attention, onPick }: { attention: Attention; onPick: () => void }) {
  const { t } = useTranslation()
  const { navigateToSession } = useNavigation()
  const { sessionStatuses = [] } = useAppShellContext()
  useEntityData()
  const rowOf = useNotificationRow(attention.setStatus)
  const people = useWorkspaceMembers()
  return (
    <ul aria-label={t('composer.notifications')}>
      {attention.chats.map(({ meta, waiting }) => (
        <ListRow
          key={meta.id}
          size="sm"
          media={<ChatStatusIcon id={getSessionStatus(meta)} statuses={sessionStatuses} />}
          title={getSessionTitle(meta, people)}
          marks={waiting
            ? <span role="img" aria-label={t('sidebar.rowWaiting')} className="size-2 shrink-0 rounded-full bg-info" />
            : <span role="img" aria-label={t('sidebar.rowUnread')} className="size-1.5 shrink-0 rounded-full bg-primary" />}
          end={meta.lastMessageAt ? shortTimeAgo(meta.lastMessageAt) : undefined}
          onClick={() => {
            navigateToSession(meta.id)
            onPick()
          }}
        />
      ))}
      {attention.notifications.map((item) => {
        const row = rowOf(item)
        return (
          <ListRow
            key={item.id}
            size="sm"
            {...row}
            onClick={(event) => {
              row.onClick?.(event)
              onPick()
            }}
          />
        )
      })}
    </ul>
  )
}
