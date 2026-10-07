/**
 * NotificationsPage - Home's full list of your notifications in the workspace (`/home/notifications`, its card's
 * View all; Back returns to Home), newest first, as one list in the Settings card (`ListCard`, the
 * Chats index's 44px rows, `notification-row.tsx`, shared with Home's card and the composer's Notifications list): who did it, the sentence ("Maria mentioned you in Fix login", the title looked up live) with the
 * comment's first line muted after a mention, an unread dot, the time. A row opens what it is about (a mention:
 * the task or project the comment is on) and marks it read; its right-click menu (a long press on touch) marks it read or unread, or clears it. The
 * title row: Mark all as read (an icon button, so the title keeps its room on a phone) and Filter (Unread, `?unread=1`). Nothing at all: the empty state.
 */

import { useTranslation } from 'react-i18next'
import { useComposerContext } from '@/components/composer/use-composer-context'
import { Bell, CheckCheck, CircleDot } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { FilterBar, FilterMenu, NoResults, type FilterField, type FilterValues } from '@workspace/ui/components/filters'
import { ListCard, ListRow, ListRowSkeleton } from '@workspace/ui/components/list-group'
import { PageColumn } from '@workspace/ui/components/page'
import { toast } from '@workspace/ui/components/sonner'
import { PageHeader } from '@/components/app-shell/page-header'
import { useEntityData } from '@/components/entities/entity-chip'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { HeaderIconButton } from '@/components/ui/header-icon-button'
import { isHomeNavigation, routes, useNavigation, useNavigationState } from '@/contexts/navigation-context'
import { useNotifications } from '@/hooks/use-notifications'
import { filterNotifications } from './notification-rules'
import { NotificationMenu, useNotificationRow } from './notification-row'

export function NotificationsPage() {
  const { t } = useTranslation()
  useComposerContext({ key: 'page:notifications', placeholder: t('composer.placeholder.start') })
  const { navigate } = useNavigation()
  const navState = useNavigationState()
  const unreadOnly = isHomeNavigation(navState) && !!navState.search.unread
  useEntityData()
  const { notifications, unreadCount, loaded, setStatus, clear } = useNotifications()
  const shown = filterNotifications(notifications, unreadOnly)
  const rowOf = useNotificationRow(setStatus)

  const run = async (call: Promise<{ ok: boolean }>) => {
    if (!(await call).ok) toast.error(t('notifications.failed'))
  }

  const fields: FilterField[] = [{ key: 'unread', label: t('notifications.unread'), icon: <CircleDot />, count: unreadCount }]
  const values: FilterValues = { unread: unreadOnly ? ['true'] : [] }
  const changeFilter = (_key: string, next: string[]) => void navigate(routes.view.notifications(next.length > 0 ? { unread: true } : {}))

  // Nothing at all: the empty state alone (no filter or action has anything to work on).
  if (loaded && notifications.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader />
        <EntityListEmptyScreen icon={<Bell />} title={t('notifications.emptyTitle')} description={t('notifications.emptyDescription')} />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t('notifications.title')}
        actions={(
          <>
            <HeaderIconButton icon={<CheckCheck />} tooltip={t('notifications.markAllRead')} disabled={unreadCount === 0} onClick={() => void run(setStatus('all', 'read'))} />
            <FilterMenu fields={fields} values={values} onChange={changeFilter} label={t('notifications.filterLabel')} />
          </>
        )}
      />
      <PageColumn className="min-h-full">
        <div data-content-start="" className="flex flex-1 flex-col gap-3">
          <FilterBar
            fields={fields}
            values={values}
            onChange={changeFilter}
            isLabel={t('chatsIndex.is')}
            isAnyOfLabel={t('chatsIndex.isAnyOf')}
            removeLabel={(field) => `${t('common.remove')} ${field}`}
          />
          {!loaded ? (
            <ListCard aria-busy>
              <ul>{[0, 1, 2].map((i) => <ListRowSkeleton key={i} />)}</ul>
            </ListCard>
          ) : shown.length === 0 ? (
            <NoResults title={t('chatsIndex.noResults')} description={t('chatsIndex.noResultsDescription')}>
              <Button variant="outline" onClick={() => changeFilter('unread', [])}>{t('chatsIndex.clearFilters')}</Button>
            </NoResults>
          ) : (
            <ListCard>
              <ul>
                {shown.map((item) => (
                  <ListRow
                    key={item.id}
                    data-notification-id={item.id}
                    {...rowOf(item)}
                    menu={<NotificationMenu item={item} setStatus={setStatus} clear={clear} />}
                  />
                ))}
              </ul>
            </ListCard>
          )}
        </div>
      </PageColumn>
    </div>
  )
}
