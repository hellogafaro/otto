/**
 * Home's four cards, a 2 x 2 grid under the composer (one column on a phone): Tasks (your open tasks and your
 * agents'), Chats (the ones that need you, then the recent ones), Notifications (the unread ones) and Routines today.
 * Each is the Settings card (`ListCard`) with a title row (icon, title, `Count`, View all) and a FIXED height whose
 * list scrolls inside it, so the cards never move the layout. Rows are the lists' own `ListRow`s with their
 * right-click menus (never a ⋯); everything follows the stores' live updates (`domain:changed`, the sessions).
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useSetAtom } from 'jotai'
import { format } from 'date-fns'
import { Bell, Box, CircleAlert, CircleCheck, CircleDashed, Clock, Loader, MessagesSquare, SquareArrowOutUpRight, type LucideIcon } from 'lucide-react'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import {
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@workspace/ui/components/context-menu'
import { Count } from '@workspace/ui/components/count'
import { ListCard, ListRow, ListRowSkeleton } from '@workspace/ui/components/list-group'
import { getDateLocale } from '@otto/shared/i18n'
import { sendToWorkspaceAtom, type SessionMeta } from '@/atoms/sessions'
import { SessionMenu } from '@/components/app-shell/session-menu'
import { hasTransferTargets } from '@/components/app-shell/transfer-targets'
import { useAttention } from '@/components/composer/use-attention'
import { useEntityData } from '@/components/entities/entity-chip'
import { TaskStatusIcon } from '@/components/tasks/task-status-icon'
import { ContextMenuProvider } from '@/components/ui/menu-context'
import { RenameDialog } from '@/components/ui/rename-dialog'
import { StyledContextMenuContent } from '@/components/ui/styled-context-menu'
import { ChatStatusIcon } from '@/config/session-status-config'
import { useAppShellContext } from '@/context/app-shell-context'
import { routes, useNavigation } from '@/contexts/navigation-context'
import { useAgents } from '@/hooks/use-agents'
import { useNotifications } from '@/hooks/use-notifications'
import { useProjects } from '@/hooks/use-projects'
import { useRoutines } from '@/hooks/use-routines'
import { useSessionActions } from '@/hooks/use-session-actions'
import { useTasks } from '@/hooks/use-tasks'
import { useWorkspaceMembers } from '@/hooks/use-workspace-members'
import { RoutineMenuItems, useRoutineActions } from '@/pages/routines/routine-row'
import { TaskMenuItems, TaskStatusItems } from '@/pages/tasks/task-row'
import { useTaskSave } from '@/pages/tasks/use-task-save'
import { getSessionStatus, getSessionTitle, shortTimeAgo } from '@/utils/session'
import { getRoutinesToday, selectMyTasks, type RoutineTodayStatus } from './home-rules'
import { NotificationMenu, useNotificationRow } from './notification-row'

/** The most rows a card draws; it scrolls inside its fixed height. */
const MAX_ROWS = 50

/** The card: the Settings card at a fixed height (320px, 280px on a phone), its title row, then its list scrolling inside. */
function HomeCard({ icon: Icon, title, count, onViewAll, loading, empty, after, children }: {
  icon: LucideIcon
  title: string
  count?: number
  onViewAll: () => void
  loading: boolean
  /** The muted line in place of the rows when there are none. */
  empty: string | null
  /** What goes outside the list (a dialog of its rows' menus). */
  after?: React.ReactNode
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  return (
    <ListCard className="flex h-70 min-w-0 flex-col md:h-80">
      {/* On the rows' grid: the icon on their 14px media column, the title at their text's 30px. */}
      <div className="flex h-9 shrink-0 items-center gap-2 pr-1 pl-2">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <span className="truncate">{title}</span>
          {count ? <Count>{count}</Count> : null}
        </h2>
        <Button variant="ghost" size="compact" className="ml-auto" onClick={onViewAll}>{t('home.viewAll')}</Button>
      </div>
      <div className="no-scrollbar min-h-0 flex-1 scroll-fade-y overflow-y-auto">
        {loading ? (
          <ul aria-busy>{[0, 1, 2].map((i) => <ListRowSkeleton key={i} />)}</ul>
        ) : empty ? (
          <p className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul>{children}</ul>
        )}
      </div>
      {after}
    </ListCard>
  )
}

/** Re-renders each minute, so times and today's routines stay true. */
function useMinuteClock(): number {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  return now
}

/** Your open tasks and your agents' (the agents you made), soonest due first: the Tasks page's row without the avatars (they are you). */
export function TasksCard() {
  const { t, i18n } = useTranslation()
  const { navigate } = useNavigation()
  const tasksApi = useTasks()
  const { runTaskAction } = useTaskSave(tasksApi)
  const { projects } = useProjects()
  const { agents } = useAgents()
  const { me } = useWorkspaceMembers()
  const mine = React.useMemo(
    () => new Set([...(me ? [me] : []), ...agents.filter((agent) => agent.createdBy === me).map((agent) => `agent:${agent.id}`)]),
    [me, agents],
  )
  const shown = React.useMemo(() => selectMyTasks(tasksApi.tasks, mine), [tasksApi.tasks, mine])
  const projectOf = (id: string) => projects.find((project) => project.id === id)?.title
  const open = (taskId: string) => navigate(routes.view.tasks({ taskId }))

  return (
    <HomeCard
      icon={CircleCheck}
      title={t('sidebar.tasks')}
      count={shown.length}
      onViewAll={() => navigate(routes.view.tasks())}
      loading={!tasksApi.loaded}
      empty={shown.length === 0 ? t('home.tasksEmpty') : null}
    >
      {shown.slice(0, MAX_ROWS).map((task) => {
        const project = projectOf(task.projectId)
        return (
          <ListRow
            key={task.id}
            data-task-id={task.id}
            media={<TaskStatusIcon status={task.status} />}
            title={task.title}
            meta={project && (
              <Badge variant="outline" className="max-w-28">
                <Box />
                <span className="truncate">{project}</span>
              </Badge>
            )}
            end={task.dueAt ? format(task.dueAt, 'MMM d', { locale: getDateLocale(i18n.language) }) : undefined}
            onClick={() => open(task.id)}
            menu={(
              <ContextMenuContent className="w-48">
                <ContextMenuGroup>
                  <ContextMenuItem onClick={() => open(task.id)}>
                    <SquareArrowOutUpRight />
                    {t('tasks.open')}
                  </ContextMenuItem>
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>
                      <CircleDashed />
                      {t('tasks.status')}
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent className="w-48">
                      <ContextMenuGroup>
                        <ContextMenuLabel>{t('tasks.changeStatus')}</ContextMenuLabel>
                        <TaskStatusItems status={task.status} onStatus={(status) => void runTaskAction(task, { status })} />
                      </ContextMenuGroup>
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                  <TaskMenuItems task={task} onAction={(item, action) => void runTaskAction(item, action)} />
                </ContextMenuGroup>
              </ContextMenuContent>
            )}
          />
        )
      })}
    </HomeCard>
  )
}

/** The chats waiting on you, then the unread ones, then the rest, newest first; each row the chat row (its bare status icon) with the session menu. */
export function ChatsCard() {
  const { t } = useTranslation()
  const { navigate, navigateToSession } = useNavigation()
  const attention = useAttention()
  const people = useWorkspaceMembers()
  useMinuteClock()
  const {
    sessionStatuses = [],
    labels,
    workspaces,
    onSessionLabelsChange,
    onRenameSession,
    onFlagSession,
    onUnflagSession,
    onArchiveSession,
    onUnarchiveSession,
    onMarkSessionUnread,
    onSessionStatusChange,
    onDeleteSession,
  } = useAppShellContext()
  const setSendToWorkspace = useSetAtom(sendToWorkspaceAtom)
  const toasted = useSessionActions({ onFlag: onFlagSession, onUnflag: onUnflagSession, onArchive: onArchiveSession, onUnarchive: onUnarchiveSession, onDelete: onDeleteSession })
  const [renaming, setRenaming] = React.useState<{ id: string; name: string } | null>(null)
  const shown = attention.recent.slice(0, MAX_ROWS)

  const menuOf = (meta: SessionMeta) => (
    <StyledContextMenuContent>
      <ContextMenuProvider>
        <SessionMenu
          item={meta}
          sessionStatuses={sessionStatuses}
          labels={labels}
          onLabelsChange={onSessionLabelsChange ? (next) => onSessionLabelsChange(meta.id, next) : undefined}
          hasTransferTargets={hasTransferTargets(workspaces)}
          onRename={() => setRenaming({ id: meta.id, name: getSessionTitle(meta, people) })}
          onFlag={() => toasted.handleFlagWithToast(meta.id)}
          onUnflag={() => toasted.handleUnflagWithToast(meta.id)}
          onArchive={() => toasted.handleArchiveWithToast(meta.id)}
          onUnarchive={() => toasted.handleUnarchiveWithToast(meta.id)}
          onMarkUnread={() => onMarkSessionUnread(meta.id)}
          onSessionStatusChange={(status) => onSessionStatusChange(meta.id, status)}
          onSendToWorkspace={() => setSendToWorkspace([meta.id])}
          onDelete={() => void toasted.handleDeleteWithToast(meta.id)}
        />
      </ContextMenuProvider>
    </StyledContextMenuContent>
  )

  return (
    <HomeCard
      icon={MessagesSquare}
      title={t('sidebar.chats')}
      count={attention.chats.length}
      onViewAll={() => navigate(routes.view.allSessions())}
      // The shell shows once the chats have loaded.
      loading={false}
      empty={shown.length === 0 ? t('home.chatsEmpty') : null}
      after={(
        <RenameDialog
          open={renaming !== null}
          onOpenChange={(open) => { if (!open) setRenaming(null) }}
          title={t('session.renameSession')}
          defaultValue={renaming?.name ?? ''}
          onSubmit={(name) => {
            if (renaming) onRenameSession(renaming.id, name)
            setRenaming(null)
          }}
          placeholder={t('session.enterSessionName')}
        />
      )}
    >
      {shown.map(({ meta, waiting }) => (
        <ListRow
          key={meta.id}
          data-session-id={meta.id}
          media={<ChatStatusIcon id={getSessionStatus(meta)} statuses={sessionStatuses} />}
          title={getSessionTitle(meta, people)}
          muted={!waiting && !meta.hasUnread}
          marks={waiting
            ? <span role="img" aria-label={t('sidebar.rowWaiting')} className="size-2 shrink-0 rounded-full bg-info" />
            : meta.hasUnread && <span role="img" aria-label={t('sidebar.rowUnread')} className="size-1.5 shrink-0 rounded-full bg-primary" />}
          end={meta.lastMessageAt ? shortTimeAgo(meta.lastMessageAt) : undefined}
          onClick={() => navigateToSession(meta.id)}
          menu={menuOf(meta)}
        />
      ))}
    </HomeCard>
  )
}

/** Your unread notifications, newest first: the Notifications page's rows (a row opens what it is about and marks it read). */
export function NotificationsCard() {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  useEntityData()
  useMinuteClock()
  const { notifications, loaded, setStatus, clear } = useNotifications()
  const rowOf = useNotificationRow(setStatus)
  const unread = notifications.filter((item) => item.readAt === null)

  return (
    <HomeCard
      icon={Bell}
      title={t('notifications.title')}
      count={unread.length}
      onViewAll={() => navigate(routes.view.notifications())}
      loading={!loaded}
      empty={unread.length === 0 ? t('home.notificationsEmpty') : null}
    >
      {unread.slice(0, MAX_ROWS).map((item) => (
        <ListRow
          key={item.id}
          data-notification-id={item.id}
          {...rowOf(item)}
          menu={<NotificationMenu item={item} setStatus={setStatus} clear={clear} />}
        />
      ))}
    </HomeCard>
  )
}

const RUN_ICONS: Record<RoutineTodayStatus, { icon: LucideIcon; className: string; labelKey: string }> = {
  scheduled: { icon: Clock, className: 'text-muted-foreground', labelKey: 'routines.type_scheduled' },
  running: { icon: Loader, className: 'animate-spin text-muted-foreground', labelKey: 'routines.running' },
  ok: { icon: CircleCheck, className: 'text-success', labelKey: 'routines.ran' },
  error: { icon: CircleAlert, className: 'text-destructive', labelKey: 'common.failed' },
}

/** Today's routines as a timeline: what already ran (or is running) with its status, then what runs later today with its time. */
export function RoutinesCard() {
  const { t, i18n } = useTranslation()
  const { navigate } = useNavigation()
  const api = useRoutines()
  const actions = useRoutineActions(api)
  const now = useMinuteClock()
  const entries = React.useMemo(() => getRoutinesToday(api.routines, new Date(now)), [api.routines, now])
  const time = new Intl.DateTimeFormat(i18n.language, { hour: 'numeric', minute: '2-digit' })
  const open = (id: string) => navigate(routes.view.automations({ automationId: id }))

  return (
    <HomeCard
      icon={Clock}
      title={t('home.routinesToday')}
      count={entries.length}
      onViewAll={() => navigate(routes.view.automations())}
      loading={!api.loaded}
      empty={entries.length === 0 ? t('home.routinesEmpty') : null}
      after={actions.dialog}
    >
      {entries.slice(0, MAX_ROWS).map(({ routine, at, status }) => {
        const { icon: Icon, className, labelKey } = RUN_ICONS[status]
        return (
          <ListRow
            key={`${routine.id}:${status === 'scheduled' ? 'next' : 'ran'}`}
            data-routine-id={routine.id}
            media={<Icon role="img" aria-label={t(labelKey)} className={className} />}
            title={routine.title}
            muted={status === 'scheduled' && routine.pausedAt !== null}
            end={time.format(at)}
            onClick={() => open(routine.id)}
            menu={(
              <ContextMenuContent className="w-48">
                <ContextMenuGroup>
                  <ContextMenuItem onClick={() => open(routine.id)}>
                    <SquareArrowOutUpRight />
                    {t('common.open')}
                  </ContextMenuItem>
                  <RoutineMenuItems routine={routine} actions={actions} />
                </ContextMenuGroup>
              </ContextMenuContent>
            )}
          />
        )
      })}
    </HomeCard>
  )
}
