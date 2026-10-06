/**
 * InboxPage - your notifications in the workspace, newest first, as one list in the line-only `PageWrap` (the
 * Chats index's 44px rows, `notification-row.tsx`, shared with the composer's Inbox list): who did it, the sentence ("Maria mentioned you in Fix login", the title looked up live) with the
 * comment's first line muted after a mention, an unread dot, the time. A row opens what it is about (a mention:
 * the task or project the comment is on) and marks it read; its ⋯ marks it read or unread, or clears it. The
 * title row: Mark all as read (an icon button, so the title keeps its room on a phone) and Filter (Unread, `?unread=1`). Nothing at all: the empty state.
 */

import { useTranslation } from 'react-i18next'
import { useComposerContext } from '@/components/composer/use-composer-context'
import { CheckCheck, CircleDot, Inbox, Mail, MailOpen, MoreHorizontal, X } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { FilterBar, FilterMenu, NoResults, type FilterField, type FilterValues } from '@workspace/ui/components/filters'
import { ListRow, ListRowSkeleton } from '@workspace/ui/components/list-group'
import { PageColumn, PageWrap } from '@workspace/ui/components/page'
import { toast } from '@workspace/ui/components/sonner'
import { PageHeader } from '@/components/app-shell/page-header'
import { useEntityData } from '@/components/entities/entity-chip'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { HeaderIconButton } from '@/components/ui/header-icon-button'
import { isInboxNavigation, routes, useNavigation, useNavigationState } from '@/contexts/navigation-context'
import { useNotifications } from '@/hooks/use-notifications'
import { filterNotifications, isUnread } from './inbox-rules'
import { useNotificationRow } from './notification-row'

export function InboxPage() {
  const { t } = useTranslation()
  useComposerContext({ key: 'page:inbox', mode: 'full', placeholder: t('composer.placeholder.start') })
  const { navigate } = useNavigation()
  const navState = useNavigationState()
  const unreadOnly = isInboxNavigation(navState) && !!navState.search.unread
  useEntityData()
  const { notifications, unreadCount, loaded, setStatus, clear } = useNotifications()
  const shown = filterNotifications(notifications, unreadOnly)
  const rowOf = useNotificationRow(setStatus)

  const run = async (call: Promise<{ ok: boolean }>) => {
    if (!(await call).ok) toast.error(t('inbox.failed'))
  }

  const fields: FilterField[] = [{ key: 'unread', label: t('inbox.unread'), icon: <CircleDot />, count: unreadCount }]
  const values: FilterValues = { unread: unreadOnly ? ['true'] : [] }
  const changeFilter = (_key: string, next: string[]) => void navigate(routes.view.inbox(next.length > 0 ? { unread: true } : {}))

  // Nothing at all: the empty state alone (no filter or action has anything to work on).
  if (loaded && notifications.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader />
        <EntityListEmptyScreen icon={<Inbox />} title={t('inbox.emptyTitle')} description={t('inbox.emptyDescription')} />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t('inbox.title')}
        actions={(
          <>
            <HeaderIconButton icon={<CheckCheck />} tooltip={t('inbox.markAllRead')} disabled={unreadCount === 0} onClick={() => void run(setStatus('all', 'read'))} />
            <FilterMenu fields={fields} values={values} onChange={changeFilter} label={t('inbox.filterLabel')} />
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
            <PageWrap aria-busy>
              <ul>{[0, 1, 2].map((i) => <ListRowSkeleton key={i} />)}</ul>
            </PageWrap>
          ) : shown.length === 0 ? (
            <NoResults title={t('chatsIndex.noResults')} description={t('chatsIndex.noResultsDescription')}>
              <Button variant="outline" onClick={() => changeFilter('unread', [])}>{t('chatsIndex.clearFilters')}</Button>
            </NoResults>
          ) : (
            <PageWrap>
              <ul>
                {shown.map((item) => {
                  const unread = isUnread(item)
                  return (
                    <ListRow
                      key={item.id}
                      data-notification-id={item.id}
                      {...rowOf(item)}
                      actions={(
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-compact" aria-label={t('common.moreActions')} />}>
                            <MoreHorizontal />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuGroup>
                              <DropdownMenuItem shortcut="U" onClick={() => void run(setStatus([item.id], unread ? 'read' : 'unread'))}>
                                {unread ? <MailOpen /> : <Mail />}
                                {unread ? t('inbox.markRead') : t('inbox.markUnread')}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => void run(clear([item.id]))}>
                                <X />
                                {t('common.clear')}
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    />
                  )
                })}
              </ul>
            </PageWrap>
          )}
        </div>
      </PageColumn>
    </div>
  )
}
