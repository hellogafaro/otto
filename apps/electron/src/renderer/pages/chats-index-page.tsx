/**
 * ChatsIndexPage - the Chats section's home: the data page BEFORE a chat.
 *
 * Sub-navigation is an index page, never a sidebar list. This is the grouped list
 * (`ListGroup` / `ListRow`, Otto v1's table) in the line-only `PageWrap`, no card, and NO
 * toolbar: the header carries ghost icon buttons only (Filter, then the header's New chat);
 * active filters show as chips (`FilterBar`) above the list only while one is set.
 * One group per status (Backlog, Todo, ...), each a 36px rounded band over 44px rows, then
 * Archived as a last, folded group. A row opens the chat; its ⋯ menu is the session menu.
 * Empty groups are not drawn; when the filters keep nothing, the no-results state is
 * centered in the free space instead of the list.
 *
 * Filters combine (Status and Label take several values) and live in the route
 * (`useChatFilters`), so Back from a chat returns here with the same filters. The
 * displayed order is published to `sessionListOrderAtom`, so the open chat's
 * Previous / Next step through exactly what is shown.
 */

import * as React from 'react'
import { useSetAtom, useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { useComposerContext } from '@/components/composer/use-composer-context'
import { formatDistanceToNowStrict, type Locale } from 'date-fns'
import { Archive, CircleDashed, ClipboardList, Cpu, Flag, MessageSquare, MoreHorizontal, Tag } from 'lucide-react'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { FilterBar, FilterMenu, NoResults, type FilterField, type FilterValues } from '@workspace/ui/components/filters'
import { PageColumn, PageWrap } from '@workspace/ui/components/page'
import { ListGroup, ListRow } from '@workspace/ui/components/list-group'
import { Spinner } from '@otto/ui'
import { flattenLabels, matchesLabelFilter, parseLabelEntry, type LabelConfig } from '@otto/shared/labels'
import { getModelShortName } from '@config/models'
import { routes } from '@/lib/navigate'
import { PageHeader } from '@/components/app-shell/page-header'
import { CreateButton } from '@/components/ui/create-button'
import { CommandPaletteButton } from '@/components/command-palette/command-palette-button'
import { SessionMenu } from '@/components/app-shell/session-menu'
import { CompactSessionMenu } from '@/components/app-shell/compact-session-menu'
import { hasTransferTargets } from '@/components/app-shell/transfer-targets'
import { stripPiPrefixForDisplay } from '@/components/app-shell/input/model-picker-helpers'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { LabelIcon } from '@/components/ui/label-icon'
import { RenameDialog } from '@/components/ui/rename-dialog'
import { DropdownMenuProvider } from '@/components/ui/menu-context'
import { DropdownMenu, DropdownMenuTrigger, StyledDropdownMenuContent } from '@/components/ui/styled-dropdown'
import { getStateColor, getStateIcon, getStateIconStyle, type SessionStatus } from '@/config/session-status-config'
import { useAppShellContext } from '@/context/app-shell-context'
import { sendToWorkspaceAtom, sessionMetaMapAtom, type SessionMeta } from '@/atoms/sessions'
import { sessionListOrderAtom } from '@/atoms/list-context'
import { useNavigation } from '@/contexts/navigation-context'
import { useSessionActions } from '@/hooks/use-session-actions'
import { useSessionSearch } from '@/hooks/use-session-search'
import { getSessionStatus, getSessionTitle, hasUnreadMeta, shortTimeLocale } from '@/utils/session'
import { hasChatFilters, matchesChatFilters, NO_CHAT_FILTERS, useChatFilters, type ChatFilters } from './use-chat-filters'

function StatusGlyph({ id, statuses }: { id: string; statuses: SessionStatus[] }) {
  return <span className="flex" style={getStateIconStyle(id, statuses)}>{getStateIcon(id, statuses)}</span>
}

/** A label's colored dot, centered in a 14px icon box. */
function LabelGlyph({ label }: { label: LabelConfig }) {
  return <span className="flex size-3.5 shrink-0 items-center justify-center"><LabelIcon label={label} size="lg" /></span>
}

/** The row actions the session menu needs, from the page. */
interface RowActions {
  onRename: (id: string, name: string) => void
  onFlag: (id: string) => void
  onUnflag: (id: string) => void
  onArchive: (id: string) => void
  onUnarchive: (id: string) => void
  onMarkUnread: (id: string) => void
  onStatus: (id: string, status: string) => void
  onSendToWorkspace: (ids: string[]) => void
  onDelete: (id: string) => Promise<boolean>
}

/** A chat's labels (two, then "+n") and its model, as the row's metadata badges. */
function ChatMeta({ item, labels }: { item: SessionMeta; labels: LabelConfig[] }) {
  const applied = (item.labels ?? [])
    .map((entry) => labels.find((l) => l.id === parseLabelEntry(entry).id))
    .filter((l): l is LabelConfig => !!l)
  const shown = applied.slice(0, 2)
  const more = applied.length - shown.length
  if (applied.length === 0 && !item.model) return null
  return (
    <>
      {shown.map((l) => (
        <Badge key={l.id} variant="outline" className="max-w-36">
          <LabelGlyph label={l} />
          <span className="truncate">{l.name}</span>
        </Badge>
      ))}
      {more > 0 && <Badge variant="outline" className="tabular-nums">+{more}</Badge>}
      {item.model && (
        <Badge variant="outline" className="max-w-36">
          <Cpu />
          <span className="truncate">{stripPiPrefixForDisplay(getModelShortName(item.model))}</span>
        </Badge>
      )}
    </>
  )
}

/** One chat: a 44px row that opens it, its ⋯ menu over the time on hover. */
function ChatRow({ item, labels, actions, onOpen }: { item: SessionMeta; labels: LabelConfig[]; actions: RowActions; onOpen: (id: string) => void }) {
  const { t } = useTranslation()
  const { workspaces, isCompactMode, sessionStatuses = [], labels: labelTree = [], onSessionLabelsChange } = useAppShellContext()
  const [compactOpen, setCompactOpen] = React.useState(false)
  const title = getSessionTitle(item)
  const unread = hasUnreadMeta(item)
  const transfer = hasTransferTargets(workspaces)
  const handlers = {
    onLabelsChange: onSessionLabelsChange ? (ls: string[]) => onSessionLabelsChange(item.id, ls) : undefined,
    onRename: () => actions.onRename(item.id, title),
    onFlag: () => actions.onFlag(item.id),
    onUnflag: () => actions.onUnflag(item.id),
    onArchive: () => actions.onArchive(item.id),
    onUnarchive: () => actions.onUnarchive(item.id),
    onMarkUnread: () => actions.onMarkUnread(item.id),
    onSessionStatusChange: (s: string) => actions.onStatus(item.id, s),
    onSendToWorkspace: () => actions.onSendToWorkspace([item.id]),
    onDelete: () => actions.onDelete(item.id),
  }

  const trigger = (
    <Button variant="ghost" size="icon-compact" aria-label={t('common.more')} onClick={isCompactMode ? () => setCompactOpen(true) : undefined}>
      <MoreHorizontal />
    </Button>
  )

  return (
    <ListRow
      data-session-id={item.id}
      media={<StatusGlyph id={getSessionStatus(item)} statuses={sessionStatuses} />}
      title={<span className={item.isAsyncOperationOngoing ? 'animate-shimmer-text' : undefined}>{title}</span>}
      muted={!unread}
      marks={
        <>
          {item.isProcessing && <Spinner className="text-[10px]" />}
          {unread && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
          {item.lastMessageRole === 'plan' && <ClipboardList className="size-3.5 shrink-0 text-success" />}
          {item.isFlagged && <Flag className="size-3.5 shrink-0 text-info" />}
        </>
      }
      meta={<ChatMeta item={item} labels={labels} />}
      end={item.lastMessageAt
        ? formatDistanceToNowStrict(new Date(item.lastMessageAt), { locale: shortTimeLocale as Locale, roundingMethod: 'floor' })
        : undefined}
      onClick={() => onOpen(item.id)}
      actions={isCompactMode ? (
        <>
          {trigger}
          <CompactSessionMenu
            open={compactOpen}
            onOpenChange={setCompactOpen}
            trigger={null}
            title={title}
            item={item}
            sessionStatuses={sessionStatuses}
            labels={labelTree}
            hasTransferTargets={transfer}
            {...handlers}
          />
        </>
      ) : (
        <DropdownMenu modal>
          <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
          <StyledDropdownMenuContent align="end">
            <DropdownMenuProvider>
              <SessionMenu item={item} sessionStatuses={sessionStatuses} labels={labelTree} hasTransferTargets={transfer} {...handlers} />
            </DropdownMenuProvider>
          </StyledDropdownMenuContent>
        </DropdownMenu>
      )}
    />
  )
}

export default function ChatsIndexPage() {
  const { t } = useTranslation()
  useComposerContext({ key: 'page:chats', placeholder: t('composer.placeholder.start') })
  const { navigate, navigateToSession } = useNavigation()
  const [filters, setFilters] = useChatFilters()
  const {
    activeWorkspaceId,
    workspaces,
    sessionStatuses = [],
    labels = [],
    onNewChat,
    onRenameSession,
    onFlagSession,
    onUnflagSession,
    onArchiveSession,
    onUnarchiveSession,
    onMarkSessionUnread,
    onSessionStatusChange,
    onDeleteSession,
  } = useAppShellContext()
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const setSessionListOrder = useSetAtom(sessionListOrderAtom)
  const setSendToWorkspace = useSetAtom(sendToWorkspaceAtom)
  const [renaming, setRenaming] = React.useState<{ id: string; name: string } | null>(null)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const viewportRef = React.useRef<HTMLDivElement | null>(null)

  const archivedOnly = filters.archived
  const flatLabels = React.useMemo(() => flattenLabels(labels), [labels])

  // The workspace's chats (a remote workspace's sessions carry the remote workspace's id).
  const remoteWorkspaceId = workspaces.find((w) => w.id === activeWorkspaceId)?.remoteServer?.remoteWorkspaceId
  const metas = React.useMemo(
    () => Array.from(sessionMetaMap.values()).filter((s) =>
      !activeWorkspaceId || s.workspaceId === activeWorkspaceId || (remoteWorkspaceId && s.workspaceId === remoteWorkspaceId)),
    [sessionMetaMap, activeWorkspaceId, remoteWorkspaceId],
  )

  // The counts in the filter menu: chats that are not archived (Archived counts its own).
  const counts = React.useMemo(() => {
    const active = metas.filter((s) => !s.isArchived)
    const status: Record<string, number> = {}
    for (const s of active) status[getSessionStatus(s)] = (status[getSessionStatus(s)] ?? 0) + 1
    const label: Record<string, number> = {}
    for (const l of flatLabels) {
      label[l.id] = active.filter((s) => matchesLabelFilter(s, { labelId: l.id }, labels)).length
    }
    return { status, label, flagged: active.filter((s) => s.isFlagged).length, archived: metas.length - active.length }
  }, [metas, flatLabels, labels])

  // The chats the filters keep (archived ones too: they fold into Archived unless that is the filter).
  const matching = React.useMemo(() => metas.filter((s) => matchesChatFilters(s, filters, labels)), [metas, filters, labels])

  // Newest first and paged as the column scrolls: the shared pipeline.
  const search = useSessionSearch({
    items: matching,
    searchActive: false,
    searchQuery: '',
    workspaceId: activeWorkspaceId ?? undefined,
    currentFilter: archivedOnly ? { kind: 'archived' } : { kind: 'allSessions' },
    labelConfigs: labels,
    groupingMode: 'date',
    scrollViewportRef: viewportRef,
  })

  // One group per status (archived chats only ever in Archived).
  const groups = React.useMemo(
    () => archivedOnly ? [] : sessionStatuses
      .map((s) => ({ status: s, items: search.flatItems.filter((i) => !i.isArchived && getSessionStatus(i) === s.id) }))
      .filter((g) => g.items.length > 0),
    [archivedOnly, sessionStatuses, search.flatItems],
  )
  // Archived: the last, folded group; the whole list (open) when Archived is a filter.
  const archived = React.useMemo(() => {
    if (archivedOnly) return search.flatItems.filter((s) => s.isArchived)
    return matching
      .filter((s) => s.isArchived)
      .sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0))
  }, [archivedOnly, matching, search.flatItems])
  const total = groups.reduce((n, g) => n + g.items.length, 0) + archived.length

  // Publish the order shown (Archived left out unless it is the filter), so the open chat's
  // Previous / Next step through it. It stays published when a chat opens (this page unmounts then).
  React.useEffect(() => {
    const ids = archivedOnly ? archived.map((i) => i.id) : groups.flatMap((g) => g.items.map((i) => i.id))
    // Only a changed order is published: the list navigation re-renders this page.
    setSessionListOrder((prev) => (prev.length === ids.length && prev.every((id, i) => id === ids[i]) ? prev : ids))
  }, [archivedOnly, archived, groups, setSessionListOrder])

  // The pagination listens to the scrolling column, which this page does not own.
  React.useLayoutEffect(() => {
    viewportRef.current = rootRef.current?.closest<HTMLDivElement>('[data-slot="page-scroll"]') ?? null
  })

  const session = useSessionActions({
    onFlag: onFlagSession,
    onUnflag: onUnflagSession,
    onArchive: onArchiveSession,
    onUnarchive: onUnarchiveSession,
    onDelete: onDeleteSession,
  })
  const actions = React.useMemo((): RowActions => ({
    onRename: (id, name) => setRenaming({ id, name }),
    onFlag: session.handleFlagWithToast,
    onUnflag: session.handleUnflagWithToast,
    onArchive: session.handleArchiveWithToast,
    onUnarchive: session.handleUnarchiveWithToast,
    onMarkUnread: onMarkSessionUnread,
    onStatus: onSessionStatusChange,
    onSendToWorkspace: (ids) => setSendToWorkspace(ids),
    onDelete: session.handleDeleteWithToast,
  }), [session.handleFlagWithToast, session.handleUnflagWithToast, session.handleArchiveWithToast, session.handleUnarchiveWithToast, session.handleDeleteWithToast, onMarkSessionUnread, onSessionStatusChange, setSendToWorkspace])

  const submitRename = (name: string) => {
    if (renaming) onRenameSession(renaming.id, name)
    setRenaming(null)
  }

  // The filter menu's fields: Status and Label (values), Flagged and Archived (on / off).
  const fields: FilterField[] = [
    {
      key: 'status',
      label: t('sessionMenu.status'),
      icon: <CircleDashed />,
      options: sessionStatuses.map((s) => ({
        value: s.id,
        label: t(`status.${s.id}`, s.label),
        icon: <StatusGlyph id={s.id} statuses={sessionStatuses} />,
        count: counts.status[s.id] ?? 0,
      })),
    },
    ...(flatLabels.length > 0 ? [{
      key: 'label',
      label: t('sidebar.labels'),
      icon: <Tag />,
      options: flatLabels.map((l) => ({ value: l.id, label: l.name, icon: <LabelGlyph label={l} />, count: counts.label[l.id] ?? 0 })),
    }] : []),
    { key: 'flagged', label: t('sidebar.flagged'), icon: <Flag />, count: counts.flagged },
    { key: 'archived', label: t('sidebar.archived'), icon: <Archive />, count: counts.archived },
  ]
  const values: FilterValues = {
    status: filters.status,
    label: filters.label,
    flagged: filters.flagged ? ['true'] : [],
    archived: filters.archived ? ['true'] : [],
  }
  const changeFilter = (key: string, next: string[]) => {
    const on = key === 'flagged' || key === 'archived' ? next.length > 0 : next
    setFilters({ ...filters, [key]: on } as ChatFilters)
  }

  // No chats at all: only the empty state and its New chat, which does create one.
  if (metas.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader />
        <EntityListEmptyScreen icon={<MessageSquare />} title={t('chatsIndex.emptyTitle')} description={t('chatsIndex.emptyDescription')}>
          <Button onClick={onNewChat}>{t('menu.newChat')}</Button>
        </EntityListEmptyScreen>
      </div>
    )
  }

  const row = (item: SessionMeta) => (
    <ChatRow key={item.id} item={item} labels={flatLabels} actions={actions} onOpen={navigateToSession} />
  )

  return (
    <div ref={rootRef} className="flex h-full flex-col">
      <PageHeader
        title={t('sidebar.chats')}
        actions={<><FilterMenu fields={fields} values={values} onChange={changeFilter} label={t('chatsIndex.filterLabel')} /><CommandPaletteButton category="chats" /></>}
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
          {total === 0 ? (
            <NoResults title={t('chatsIndex.noResults')} description={t('chatsIndex.noResultsDescription')}>
              {hasChatFilters(filters) && (
                <Button variant="outline" onClick={() => setFilters(NO_CHAT_FILTERS)}>{t('chatsIndex.clearFilters')}</Button>
              )}
            </NoResults>
          ) : (
            // Otto: the v1 table floats in the line wrapper, `--wrap-pad` (16px) in, on the column's edges (DESIGN.md, PageWrap).
            <PageWrap padded>
              {groups.map((g) => (
                <ListGroup
                  key={g.status.id}
                  icon={<StatusGlyph id={g.status.id} statuses={sessionStatuses} />}
                  tint={getStateColor(g.status.id, sessionStatuses)}
                  label={t(`status.${g.status.id}`, g.status.label)}
                  count={g.items.length}
                  action={<CreateButton size="icon-xs" label={t('menu.newChat')} onClick={() => navigate(routes.action.newSession({ status: g.status.id }))} />}
                >
                  {g.items.map(row)}
                </ListGroup>
              ))}
              <ListGroup
                key={archivedOnly ? 'archived-only' : 'archived'}
                icon={<Archive />}
                label={t('sidebar.archived')}
                count={archived.length}
                defaultOpen={archivedOnly}
              >
                {archived.map(row)}
              </ListGroup>
            </PageWrap>
          )}
        </div>
      </PageColumn>
      <RenameDialog
        open={renaming !== null}
        onOpenChange={(open) => { if (!open) setRenaming(null) }}
        title={t('session.renameSession')}
        defaultValue={renaming?.name ?? ''}
        onSubmit={submitRename}
        placeholder={t('session.enterSessionName')}
      />
    </div>
  )
}
