import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue, useSetAtom } from 'jotai'
import { formatDistanceStrict, type Locale } from 'date-fns'
import {
  Archive,
  ArchiveRestore,
  CircleCheck,
  Circle,
  Clock,
  Folder,
  Library,
  MoreHorizontal,
  Pin,
  PinOff,
  Settings,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { Spinner } from '@workspace/ui/components/spinner'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenuButton,
  SidebarMenuSlot,
  SidebarMenuSlotAction,
} from '@workspace/ui/components/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { cn } from '@/lib/utils'
import { JUMP_ACTION_IDS, useActionRegistry } from '@/actions'
import { currentRouteAtom } from '@/atoms/current-route'
import { keyFromRoute, itemKey, type ResolvedItem } from '@/atoms/pins-recents'
import { sendToWorkspaceAtom, type SessionMeta } from '@/atoms/sessions'
import { useAppShellContext } from '@/context/app-shell-context'
import { useNavigation } from '@/contexts/navigation-context'
import { usePins } from '@/hooks/use-pins'
import { useRecents } from '@/hooks/use-recents'
import { useSessionActions } from '@/hooks/use-session-actions'
import { useShortcutReveal } from '@/hooks/use-shortcut-reveal'
import { getStateIcon, getStateIconStyle, type SessionStatus } from '@/config/session-status-config'
import { getSessionStatus, getSessionTitle, hasUnreadMeta, shortTimeLocale } from '@/utils/session'
import { Kbd } from '@/components/ui/kbd'
import { RenameDialog } from '@/components/ui/rename-dialog'
import { SortableList } from '@/components/ui/sortable-list'
import { DropdownMenu, DropdownMenuTrigger, StyledDropdownMenuContent } from '@/components/ui/styled-dropdown'
import { ContextMenu, ContextMenuTrigger, StyledContextMenuContent } from '@/components/ui/styled-context-menu'
import { ContextMenuProvider, DropdownMenuProvider, useMenuComponents } from '@/components/ui/menu-context'
import { SessionMenu } from './session-menu'
import { hasTransferTargets } from './transfer-targets'

const TYPE_ICONS: Record<string, LucideIcon> = {
  project: Folder,
  task: CircleCheck,
  routine: Clock,
  library: Library,
  settings: Settings,
}

// A row is one line: the title runs the full width and fades out under the row's
// right slot (a mask, so it blends with the rest, hover, selected and open fills),
// and the slot holds one thing: at rest the chat's status or else its time; on hover,
// keyboard focus or an open menu only Pin, Archive and More; the jump key only while
// the reveal key is held. `--slot` is how far the fade reaches in from the title's end
// (the slot's width), set per state below; the fade itself is 16px (8 x 2).
const TITLE_FADE =
  '[mask-image:linear-gradient(to_right,#000_calc(100%_-_var(--slot)_-_16px),transparent_calc(100%_-_var(--slot)))]'
const SLOT_REST = { none: '[--slot:-16px]', mark: '[--slot:22px]', time: '[--slot:36px]' } as const
// Three 20px buttons and two 2px gaps, or one button (a row that is not a chat).
const SLOT_ACTIONS = {
  chat: 'hover:[--slot:64px] has-[:focus-visible]:[--slot:64px] data-[open]:[--slot:64px] pointer-coarse:[--slot:64px]',
  pin: 'hover:[--slot:20px] has-[:focus-visible]:[--slot:20px] data-[open]:[--slot:20px] pointer-coarse:[--slot:20px]',
} as const
// "⌘1" is two characters wide; Windows and Linux keys ("Ctrl+1") are wider.
const SLOT_KEY = { narrow: '[--slot:28px]', wide: '[--slot:52px]' } as const

const SHOW_ON_ROW =
  'group-hover/menu-item:pointer-events-auto group-hover/menu-item:opacity-100 group-has-[:focus-visible]/menu-item:pointer-events-auto group-has-[:focus-visible]/menu-item:opacity-100 group-data-[open]/menu-item:pointer-events-auto group-data-[open]/menu-item:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100'
const HIDE_ON_ROW =
  'group-hover/menu-item:opacity-0 group-has-[:focus-visible]/menu-item:opacity-0 group-data-[open]/menu-item:opacity-0 pointer-coarse:opacity-0'

type Mark = 'waiting' | 'failed' | 'working' | 'unread'

/** The one status that matters, most urgent first, or none (the time shows then). */
function getRowMark(session: SessionMeta, waiting: boolean): Mark | null {
  if (waiting) return 'waiting'
  if (session.lastMessageRole === 'error') return 'failed'
  if (session.isProcessing) return 'working'
  if (hasUnreadMeta(session)) return 'unread'
  return null
}

function RowMark({ mark }: { mark: Mark }) {
  const { t } = useTranslation()
  return (
    <span className="flex size-3.5 items-center justify-center">
      {mark === 'working' && <Spinner aria-label={t('sidebar.rowWorking')} />}
      {mark === 'failed' && <TriangleAlert role="img" aria-label={t('sidebar.rowFailed')} className="text-destructive" />}
      {mark === 'waiting' && <span role="img" aria-label={t('sidebar.rowWaiting')} className="size-2 rounded-full bg-info" />}
      {mark === 'unread' && <span role="img" aria-label={t('sidebar.rowUnread')} className="size-1.5 rounded-full bg-primary" />}
    </span>
  )
}

/** The time since the last message, short ("now", "5m", "2h", "3d"). */
function getTimeAgo(at: number, now: number, nowLabel: string): string {
  if (now - at < 60_000) return nowLabel
  return formatDistanceStrict(at, now, { locale: shortTimeLocale as Locale, roundingMethod: 'floor' })
}

/** Re-renders each minute, so the times on the rows stay true. */
function useMinuteClock(): number {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  return now
}

/** What a chat's menus do, from the app shell (the same as the Chats page rows). */
interface ChatActions {
  rename: (session: SessionMeta) => void
  flag: (id: string) => void
  unflag: (id: string) => void
  archive: (id: string) => void
  unarchive: (id: string) => void
  markUnread: (id: string) => void
  setStatus: (id: string, status: string) => void
  sendToWorkspace: (id: string) => void
  remove: (id: string) => Promise<boolean>
}

/** Pin or unpin: the whole menu of a row that is not a chat, in its context menu. */
function RowMenu({ pinned, onTogglePin }: { pinned: boolean; onTogglePin: () => void }) {
  const { t } = useTranslation()
  const { MenuItem } = useMenuComponents()
  return (
    <MenuItem onClick={onTogglePin}>
      {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
      <span className="flex-1">{pinned ? t('menu.unpin') : t('menu.pin')}</span>
    </MenuItem>
  )
}

/** A chat's session menu (which has Pin and Unpin in it), in its context menu and its ⋯ button. */
function ChatMenu({ session, sessionStatuses, actions }: { session: SessionMeta; sessionStatuses: SessionStatus[]; actions: ChatActions }) {
  const { workspaces, labels, onSessionLabelsChange } = useAppShellContext()
  return (
    <SessionMenu
      item={session}
      sessionStatuses={sessionStatuses}
      labels={labels}
      onLabelsChange={onSessionLabelsChange ? ls => onSessionLabelsChange(session.id, ls) : undefined}
      hasTransferTargets={hasTransferTargets(workspaces)}
      onRename={() => actions.rename(session)}
      onFlag={() => actions.flag(session.id)}
      onUnflag={() => actions.unflag(session.id)}
      onArchive={() => actions.archive(session.id)}
      onUnarchive={() => actions.unarchive(session.id)}
      onMarkUnread={() => actions.markUnread(session.id)}
      onSessionStatusChange={status => actions.setStatus(session.id, status)}
      onSendToWorkspace={() => actions.sendToWorkspace(session.id)}
      onDelete={() => void actions.remove(session.id)}
    />
  )
}

function ItemIcon({ item, sessionStatuses }: { item: ResolvedItem; sessionStatuses: SessionStatus[] }) {
  if (item.session) {
    const status = getSessionStatus(item.session)
    return (
      <span
        data-slot="icon-slot"
        className="flex shrink-0 items-center justify-center [&>img]:size-3.5 [&>span]:text-sm [&>svg]:size-3.5"
        style={getStateIconStyle(status, sessionStatuses)}
      >
        {getStateIcon(status, sessionStatuses)}
      </span>
    )
  }
  const Icon = TYPE_ICONS[item.type] ?? Circle
  return (
    <span data-slot="icon-slot" className="flex shrink-0 items-center justify-center">
      <Icon />
    </span>
  )
}

/** An icon button of a row's slot, its label in a tooltip. */
function SlotButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<SidebarMenuSlotAction aria-label={label} onClick={onClick} />}>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

interface RowProps {
  item: ResolvedItem
  pinned: boolean
  active: boolean
  /** The jump key's display ("⌘1"), for the first nine rows. */
  hotkey?: string
  /** The reveal key is held: the jump keys show in place of the slot. */
  reveal?: boolean
  now: number
  /** The chat has a question or a request waiting on the user. */
  waiting?: boolean
  sessionStatuses: SessionStatus[]
  chat?: ChatActions
  onOpen?: () => void
  onTogglePin?: () => void
}

/** One 28px line: its icon, the title fading under the right slot. Without handlers it is a plain copy (the drag overlay). */
function Row({ item, pinned, active, hotkey, reveal, now, waiting = false, sessionStatuses, chat, onOpen, onTogglePin }: RowProps) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = React.useState(false)
  const session = item.session
  const mark = session ? getRowMark(session, waiting) : null
  const ago = session?.lastMessageAt ? getTimeAgo(session.lastMessageAt, now, t('time.compact.now')) : null
  const showKey = !!onTogglePin && !!reveal && !!hotkey
  const isChat = !!session && !!chat
  const rest = mark ? 'mark' : ago ? 'time' : 'none'
  const bright = !!session && (waiting || hasUnreadMeta(session))

  const row = (
    <SidebarMenuButton
      isActive={active}
      onClick={onOpen}
      className={cn(menuOpen && 'bg-foreground/10 text-foreground')}
    >
      <ItemIcon item={item} sessionStatuses={sessionStatuses} />
      <span className={cn('min-w-0 flex-1 overflow-hidden text-clip! whitespace-nowrap', TITLE_FADE, bright && 'text-foreground')}>
        {item.title}
      </span>
    </SidebarMenuButton>
  )

  const wrapper = cn(
    'group/menu-item relative',
    showKey
      ? SLOT_KEY[(hotkey?.length ?? 0) > 3 ? 'wide' : 'narrow']
      : cn(SLOT_REST[rest], onTogglePin && SLOT_ACTIONS[isChat ? 'chat' : 'pin']),
  )

  if (!onTogglePin) return <div className={wrapper}>{row}</div>

  const pinLabel = pinned ? t('menu.unpin') : t('menu.pin')
  const archived = !!session?.isArchived
  const archiveLabel = archived ? t('sessionMenu.unarchive') : t('sessionMenu.archive')

  return (
    <div className={wrapper} data-open={menuOpen ? '' : undefined}>
      <ContextMenu modal onOpenChange={setMenuOpen}>
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
        <StyledContextMenuContent>
          <ContextMenuProvider>
            {session && chat
              ? <ChatMenu session={session} sessionStatuses={sessionStatuses} actions={chat} />
              : <RowMenu pinned={pinned} onTogglePin={onTogglePin} />}
          </ContextMenuProvider>
        </StyledContextMenuContent>
      </ContextMenu>
      <SidebarMenuSlot>
        {(mark || ago) && (
          <span
            className={cn(
              'col-start-1 row-start-1 flex items-center px-1 text-xs text-muted-foreground tabular-nums transition-opacity duration-100',
              showKey ? 'opacity-0' : HIDE_ON_ROW,
            )}
          >
            {mark ? <RowMark mark={mark} /> : ago}
          </span>
        )}
        <div
          className={cn(
            'pointer-events-none col-start-1 row-start-1 flex items-center gap-0.5 opacity-0 transition-opacity duration-100',
            !showKey && SHOW_ON_ROW,
          )}
        >
          <SlotButton label={pinLabel} onClick={onTogglePin}>
            {pinned ? <PinOff /> : <Pin />}
          </SlotButton>
          {session && chat && (
            <>
              <SlotButton label={archiveLabel} onClick={() => (archived ? chat.unarchive(session.id) : chat.archive(session.id))}>
                {archived ? <ArchiveRestore /> : <Archive />}
              </SlotButton>
              <DropdownMenu modal open={menuOpen} onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuSlotAction aria-label={t('common.more')}>
                    <MoreHorizontal />
                  </SidebarMenuSlotAction>
                </DropdownMenuTrigger>
                <StyledDropdownMenuContent align="end">
                  <DropdownMenuProvider>
                    <ChatMenu session={session} sessionStatuses={sessionStatuses} actions={chat} />
                  </DropdownMenuProvider>
                </StyledDropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
        {showKey && <Kbd className="col-start-1 row-start-1">{hotkey}</Kbd>}
      </SidebarMenuSlot>
    </div>
  )
}

/**
 * The sidebar's one dynamic group: the pinned items (dragged to reorder), then the
 * recent ones, each a one-line 28px sidebar row (see Row) with its jump key (⌘1–⌘9,
 * Option+1–9 in the browser) for the first nine across both, shown while the reveal key
 * is held. Empty lists show nothing, and so does the group when both are empty. Put it
 * in `SidebarContent` after the pages; it takes the height that is left and scrolls
 * inside itself.
 */
export function SidebarPinsRecents({ sessionStatuses }: { sessionStatuses: SessionStatus[] }) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const { getHotkeyDisplay } = useActionRegistry()
  const { pinned, togglePin, reorder } = usePins()
  const recents = useRecents()
  const activeKey = keyFromRoute(useAtomValue(currentRouteAtom))
  const reveal = useShortcutReveal()
  const now = useMinuteClock()
  const {
    pendingPermissions,
    pendingCredentials,
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
  const toasted = useSessionActions({
    onFlag: onFlagSession,
    onUnflag: onUnflagSession,
    onArchive: onArchiveSession,
    onUnarchive: onUnarchiveSession,
    onDelete: onDeleteSession,
  })
  const [renaming, setRenaming] = React.useState<{ id: string; name: string } | null>(null)

  if (pinned.length === 0 && recents.length === 0) return null

  const chat: ChatActions = {
    rename: session => setRenaming({ id: session.id, name: getSessionTitle(session) }),
    flag: toasted.handleFlagWithToast,
    unflag: toasted.handleUnflagWithToast,
    archive: toasted.handleArchiveWithToast,
    unarchive: toasted.handleUnarchiveWithToast,
    markUnread: onMarkSessionUnread,
    setStatus: onSessionStatusChange,
    sendToWorkspace: id => setSendToWorkspace([id]),
    remove: toasted.handleDeleteWithToast,
  }
  const submitRename = () => {
    if (renaming?.name.trim()) onRenameSession(renaming.id, renaming.name.trim())
    setRenaming(null)
  }
  const isWaiting = (item: ResolvedItem) =>
    !!item.session && ((pendingPermissions.get(item.id)?.length ?? 0) + (pendingCredentials.get(item.id)?.length ?? 0)) > 0

  // The numbers follow the jump list: pinned first, then the recents not pinned.
  const hotkeyAt = (index: number) => (index < JUMP_ACTION_IDS.length ? getHotkeyDisplay(JUMP_ACTION_IDS[index]) ?? undefined : undefined)
  const renderRow = (item: ResolvedItem, isPinnedRow: boolean, index: number) => (
    <Row
      item={item}
      pinned={isPinnedRow}
      active={itemKey(item) === activeKey}
      hotkey={hotkeyAt(index)}
      reveal={reveal}
      now={now}
      waiting={isWaiting(item)}
      sessionStatuses={sessionStatuses}
      chat={chat}
      onOpen={() => void navigate(item.route)}
      onTogglePin={() => togglePin(item)}
    />
  )

  return (
    <SidebarGroup className="min-h-0 flex-1 group-data-[collapsible=icon]:hidden">
      <SidebarGroupContent className="no-scrollbar flex min-h-0 flex-1 scroll-fade-y flex-col gap-4 overflow-y-auto select-none">
        {pinned.length > 0 && (
          <div className="flex flex-col gap-0.5">
            <SidebarGroupLabel>{t('sidebar.pinned')}</SidebarGroupLabel>
            <SortableList
              className="flex flex-col gap-0.5"
              items={pinned.map(item => ({ id: itemKey(item), item }))}
              onReorder={ordered => reorder(ordered.map(entry => entry.id))}
              renderItem={({ item }) => renderRow(item, true, pinned.indexOf(item))}
              renderOverlay={({ item }) => (
                <Row item={item} pinned active={false} now={now} sessionStatuses={sessionStatuses} />
              )}
            />
          </div>
        )}
        {recents.length > 0 && (
          <div className="flex flex-col gap-0.5">
            <SidebarGroupLabel>{t('sidebar.recent')}</SidebarGroupLabel>
            {recents.map((item, index) => (
              <React.Fragment key={itemKey(item)}>{renderRow(item, false, pinned.length + index)}</React.Fragment>
            ))}
          </div>
        )}
      </SidebarGroupContent>
      <RenameDialog
        open={renaming !== null}
        onOpenChange={open => { if (!open) setRenaming(null) }}
        title={t('session.renameSession')}
        value={renaming?.name ?? ''}
        onValueChange={name => setRenaming(r => (r ? { ...r, name } : r))}
        onSubmit={submitRename}
        placeholder={t('session.enterSessionName')}
      />
    </SidebarGroup>
  )
}
