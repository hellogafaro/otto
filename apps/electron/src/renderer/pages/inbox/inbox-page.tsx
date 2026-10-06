/**
 * InboxPage - your notifications in the workspace, newest first, as one list in the line-only `PageWrap` (the
 * Chats index's 44px rows): who did it, the sentence ("Maria mentioned you in Fix login", the title looked up live) with the
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
import { describeEntity, plainEntityText } from '@/components/entities/entity-tokens'
import { useEntityData, useEntityLabel, useEntityLists } from '@/components/entities/entity-chip'
import { ActorAvatar } from '@/components/people/actor-avatar'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { HeaderIconButton } from '@/components/ui/header-icon-button'
import { isInboxNavigation, routes, useNavigation, useNavigationState } from '@/contexts/navigation-context'
import { useNotifications } from '@/hooks/use-notifications'
import { useWorkspaceMembers } from '@/hooks/use-workspace-members'
import { shortTimeAgo } from '@/utils/session'
import type { Route } from '../../../shared/routes'
import type { NotificationItem } from '../../../shared/types'
import { filterNotifications, getNotificationLineKey, getNotificationTarget, isUnread } from './inbox-rules'

export function InboxPage() {
  const { t } = useTranslation()
  useComposerContext({ key: 'page:inbox', mode: 'full', placeholder: t('composer.placeholder.start') })
  const { navigate } = useNavigation()
  const navState = useNavigationState()
  const unreadOnly = isInboxNavigation(navState) && !!navState.search.unread
  useEntityData()
  const lists = useEntityLists()
  const label = useEntityLabel()
  const { nameOf } = useWorkspaceMembers()
  const { notifications, unreadCount, loaded, setStatus, clear } = useNotifications()
  const shown = filterNotifications(notifications, unreadOnly)

  const run = async (call: Promise<{ ok: boolean }>) => {
    if (!(await call).ok) toast.error(t('inbox.failed'))
  }

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

  const open = (item: NotificationItem) => {
    const route = describeEntity(getNotificationTarget(item), lists)?.route
    if (isUnread(item)) void run(setStatus([item.id], 'read'))
    if (route) void navigate(route as Route)
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
                  const excerpt = excerptOf(item)
                  return (
                    <ListRow
                      key={item.id}
                      data-notification-id={item.id}
                      media={<ActorAvatar actor={item.createdBy} name={nameOf(item.createdBy)} />}
                      title={(
                        <>
                          {t(getNotificationLineKey(item.type), { name: nameOf(item.createdBy), title: titleOf(item) })}
                          {excerpt && <span className="ms-2 text-muted-foreground">{excerpt}</span>}
                        </>
                      )}
                      muted={!unread}
                      marks={unread && <span aria-label={t('inbox.unread')} className="size-1.5 shrink-0 rounded-full bg-primary" />}
                      end={shortTimeAgo(item.createdAt)}
                      onClick={() => open(item)}
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
