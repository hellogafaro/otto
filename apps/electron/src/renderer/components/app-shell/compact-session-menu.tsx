/**
 * CompactSessionMenu
 *
 * Bottom-sheet replacement for the desktop ChatPage "More actions" dropdown
 * (`SessionMenu` in the page header's Radix DropdownMenu) when
 * `AppShellContext.isCompactMode === true`. Mirrors the same actions but
 * routes Status / Labels / Share submenus through
 * an internal view stack instead of nested Radix popovers — Radix submenus
 * get clipped by the panel container query on narrow viewports, and the
 * Status submenu in particular falls off the right edge.
 *
 * Pattern matches the other compact pickers (`CompactSessionListFilter`,
 * `CompactWorkspaceSwitcher`, `CompactPermissionModeSelector`) and also
 * follows the iOS-style drill-in behaviour.
 *
 * Side-effect handlers (share / refresh title / copy path / share submenu /
 * label toggle with optimistic state) come from `useSessionMenuActions`,
 * shared with the desktop `SessionMenu` so a new session action only has to
 * be wired through one place.
 *
 * Leaf actions close the drawer on tap. Label toggles do NOT close the
 * drawer so the user can apply multiple labels in one pass — same UX as
 * the desktop submenu.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronLeft,
  ChevronRight,
  CloudUpload,
  Copy,
  Flag,
  FlagOff,
  FolderOpen,
  Globe,
  Link2Off,
  MailOpen,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  Send,
  Tag,
  Trash2,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { LabelIcon } from '@/components/ui/label-icon'
import {
  createLabelMenuItems,
  type LabelMenuItem,
} from '@/components/ui/label-menu-utils'
import type { LabelConfig } from '@otto/shared/labels'
import {
  getStateColor,
  getStateIcon,
  getStatusIconStyle,
  type SessionStatus,
  type SessionStatusId,
} from '@/config/session-status-config'
import type { SessionMeta } from '@/atoms/sessions'
import { getSessionStatus, hasUnreadMeta, hasMessagesMeta } from '@/utils/session'
import { getFileManagerName } from '@/lib/platform'
import { useSessionMenuActions } from '@/hooks/use-session-menu-actions'
import { useShareCapabilities } from '@/hooks/use-share-capabilities'
import { usePins } from '@/hooks/use-pins'
import { chatItem } from '@/atoms/pins-recents'
import { Button } from '@/components/ui/button'

type View = 'root' | 'status' | 'labels' | 'share'

export interface CompactSessionMenuProps {
  /** Title text shown in the drawer header. */
  title?: string

  // Session data — same as SessionMenu
  item: SessionMeta
  sessionStatuses: SessionStatus[]
  labels?: LabelConfig[]
  hasTransferTargets?: boolean

  // Callbacks — same as SessionMenu
  onLabelsChange?: (labels: string[]) => void
  onRename: () => void
  onFlag: () => void
  onUnflag: () => void
  onArchive: () => void
  onUnarchive: () => void
  onMarkUnread: () => void
  onSessionStatusChange: (state: SessionStatusId) => void
  onSendToWorkspace?: () => void
  onDelete: () => void

  /** Rows above the actions (the phone header's Previous, Next and Info: see `PageHeader`). */
  lead?: React.ReactNode

  // ---------------------------------------------------------------------------
  // Controlled-component shim — used by EntityRow / SessionItem so a single
  // drawer instance can be driven from multiple triggers (`…` button + long-
  // press). When `open` is omitted the component owns its own state (the
  // chat header's More button). Matches the Radix Dialog convention.
  // ---------------------------------------------------------------------------
  /** Controlled open state. When omitted, the component owns its own state. */
  open?: boolean
  /** Notifies the consumer when the controlled open state should change. */
  onOpenChange?: (open: boolean) => void
  /** The trigger node (the chat header's More button). `null` renders none
   *  (the row provides its own). */
  trigger: React.ReactNode | null
}

export function CompactSessionMenu({
  title,
  item,
  sessionStatuses,
  labels = [],
  hasTransferTargets,
  onLabelsChange,
  onRename,
  onFlag,
  onUnflag,
  onArchive,
  onUnarchive,
  onMarkUnread,
  onSessionStatusChange,
  onSendToWorkspace,
  onDelete,
  lead,
  open: controlledOpen,
  onOpenChange,
  trigger,
}: CompactSessionMenuProps) {
  const { t } = useTranslation()
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [isControlled, onOpenChange],
  )
  const [view, setView] = React.useState<View>('root')

  // Reset to root pane every time the drawer closes so the next open
  // doesn't surprise the user with a sub-pane from the previous session.
  React.useEffect(() => {
    if (!open) setView('root')
  }, [open])

  // Close+reset the drawer if the underlying session changes while it's open.
  // Otherwise action handlers retarget to the new session (e.g. user opens
  // menu for A, navigation switches to B, "Delete" deletes B).
  React.useEffect(() => {
    setOpen(false)
    setView('root')
  }, [item.id, setOpen])

  const isFlagged = item.isFlagged ?? false
  const isArchived = item.isArchived ?? false
  const sharedUrl = item.sharedUrl
  const { viewerConfigured } = useShareCapabilities()
  const currentSessionStatus = getSessionStatus(item)
  const sessionLabels = item.labels ?? []
  const _hasMessages = hasMessagesMeta(item)
  const _hasUnread = hasUnreadMeta(item)

  const actions = useSessionMenuActions({ item, onLabelsChange })
  const { isPinned, togglePin } = usePins()

  const flatLabelItems = React.useMemo(
    (): LabelMenuItem[] => createLabelMenuItems(labels),
    [labels],
  )

  // Wrap a callback so it also closes the drawer. Async callbacks fire
  // their work in the background — the drawer doesn't need to stay open
  // for the request to complete.
  const closeAfter = React.useCallback(
    <T extends (...args: never[]) => void | Promise<void>>(fn?: T) => {
      if (!fn) return undefined
      return ((...args: Parameters<T>) => {
        void fn(...args)
        setOpen(false)
      }) as T
    },
    [setOpen],
  )

  // ---------------------------------------------------------------------------
  // Drawer header — shared between root + sub-panes. Sub-panes show a back
  // chevron; the root pane shows the session title.
  // ---------------------------------------------------------------------------
  const headerTitle = (() => {
    switch (view) {
      case 'status':    return t('sessionMenu.status')
      case 'labels':    return t('sessionMenu.labels')
      case 'share':     return t('sessionMenu.shared')
      default:          return title ?? ''
    }
  })()

  const showBack = view !== 'root'

  const triggerNode = trigger === null ? null : <DrawerTrigger asChild>{trigger}</DrawerTrigger>

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      {triggerNode}

      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="!flex flex-row items-center gap-2 !text-left pr-3">
          {showBack && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setView('root')}
              className="-ml-1"
              aria-label={t('common.back')}
            >
              <ChevronLeft />
            </Button>
          )}
          <DrawerTitle className="flex-1 min-w-0 truncate">{headerTitle}</DrawerTitle>
        </DrawerHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-6">
          {view === 'root' && lead && (
            <>
              <div className="flex flex-col">{lead}</div>
              <Separator />
            </>
          )}
          {view === 'root' && (
            <RootPane
              canShare={viewerConfigured}
              sharedUrl={sharedUrl}
              sessionStatuses={sessionStatuses}
              currentSessionStatus={currentSessionStatus}
              labelsCount={sessionLabels.length}
              hasLabels={labels.length > 0}
              isPinned={isPinned({ type: 'chat', id: item.id })}
              isFlagged={isFlagged}
              isArchived={isArchived}
              hasMessages={_hasMessages}
              hasUnread={_hasUnread}
              hasTransferTargets={hasTransferTargets}
              onShare={closeAfter(actions.share)}
              onOpenShareSub={() => setView('share')}
              onSendToWorkspace={closeAfter(onSendToWorkspace)}
              onOpenStatusSub={() => setView('status')}
              onOpenLabelsSub={() => setView('labels')}
              onFlag={closeAfter(onFlag)}
              onTogglePin={closeAfter(() => togglePin(chatItem(item)))}
              onUnflag={closeAfter(onUnflag)}
              onArchive={closeAfter(onArchive)}
              onUnarchive={closeAfter(onUnarchive)}
              onMarkUnread={closeAfter(onMarkUnread)}
              onRename={closeAfter(onRename)}
              onRefreshTitle={closeAfter(actions.refreshTitle)}
              onShowInFinder={closeAfter(actions.showInFinder)}
              onCopyPath={closeAfter(actions.copyPath)}
              onDelete={closeAfter(onDelete)}
            />
          )}

          {view === 'status' && (
            <StatusPane
              sessionStatuses={sessionStatuses}
              activeStateId={currentSessionStatus}
              onSelect={(id) => {
                onSessionStatusChange(id)
                setOpen(false)
              }}
            />
          )}

          {view === 'labels' && (
            <LabelsPane
              items={flatLabelItems}
              appliedLabelIds={actions.appliedLabelIds}
              onToggle={actions.toggleLabel}
            />
          )}

          {view === 'share' && sharedUrl && (
            <SharePane
              onOpenInBrowser={closeAfter(actions.openSharedInBrowser)!}
              onCopyLink={closeAfter(actions.copySharedLink)!}
              onUpdateShare={closeAfter(actions.updateShare)!}
              onRevokeShare={closeAfter(actions.revokeShare)!}
            />
          )}

        </div>
      </DrawerContent>
    </Drawer>
  )
}

// ---------------------------------------------------------------------------
// Panes
// ---------------------------------------------------------------------------

interface RootPaneProps {
  /** False when no viewer host is configured: the share rows are hidden */
  canShare: boolean
  sharedUrl?: string
  sessionStatuses: SessionStatus[]
  currentSessionStatus: SessionStatusId
  labelsCount: number
  hasLabels: boolean
  isPinned: boolean
  isFlagged: boolean
  isArchived: boolean
  hasMessages: boolean
  hasUnread: boolean
  hasTransferTargets?: boolean
  onShare?: () => void
  onOpenShareSub: () => void
  onSendToWorkspace?: () => void
  onOpenStatusSub: () => void
  onOpenLabelsSub: () => void
  onFlag?: () => void
  onTogglePin?: () => void
  onUnflag?: () => void
  onArchive?: () => void
  onUnarchive?: () => void
  onMarkUnread?: () => void
  onRename?: () => void
  onRefreshTitle?: () => void
  onShowInFinder?: () => void
  onCopyPath?: () => void
  onDelete?: () => void
}

function RootPane({
  canShare,
  sharedUrl,
  sessionStatuses,
  currentSessionStatus,
  labelsCount,
  hasLabels,
  isPinned,
  isFlagged,
  isArchived,
  hasMessages,
  hasUnread,
  hasTransferTargets,
  onShare,
  onOpenShareSub,
  onSendToWorkspace,
  onOpenStatusSub,
  onOpenLabelsSub,
  onTogglePin,
  onFlag,
  onUnflag,
  onArchive,
  onUnarchive,
  onMarkUnread,
  onRename,
  onRefreshTitle,
  onShowInFinder,
  onCopyPath,
  onDelete,
}: RootPaneProps) {
  const { t } = useTranslation()

  const statusIconNode = (() => {
    const icon = getStateIcon(currentSessionStatus, sessionStatuses)
    return React.isValidElement(icon)
      ? React.cloneElement(icon as React.ReactElement<{ bare?: boolean }>, { bare: true })
      : icon
  })()
  const statusColor = getStateColor(currentSessionStatus, sessionStatuses) ?? undefined

  return (
    <div className="flex flex-col">
      {/* Share / Shared */}
      {!canShare ? null : !sharedUrl ? (
        <CompactMenuRow icon={<CloudUpload className="size-3.5" />} label={t('sessionMenu.share')} onTap={onShare} />
      ) : (
        <CompactMenuRow
          icon={<CloudUpload className="size-3.5" />}
          label={t('sessionMenu.shared')}
          chevron
          onTap={onOpenShareSub}
        />
      )}

      {hasTransferTargets && onSendToWorkspace && (
        <CompactMenuRow icon={<Send className="size-3.5" />} label={t('sessionMenu.sendToWorkspace')} onTap={onSendToWorkspace} />
      )}

      <Separator />

      <CompactMenuRow
        icon={<span style={statusColor ? { color: statusColor } : undefined}>{statusIconNode}</span>}
        label={t('sessionMenu.status')}
        chevron
        onTap={onOpenStatusSub}
      />

      {hasLabels && (
        <CompactMenuRow
          icon={<Tag className="size-3.5" />}
          label={t('sessionMenu.labels')}
          trailing={labelsCount > 0 ? <CountBadge count={labelsCount} /> : undefined}
          chevron
          onTap={onOpenLabelsSub}
        />
      )}

      <CompactMenuRow
        icon={isPinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
        label={isPinned ? t('menu.unpin') : t('menu.pin')}
        onTap={onTogglePin}
      />

      {!isFlagged ? (
        <CompactMenuRow icon={<Flag className="size-3.5 text-info" />} label={t('sessionMenu.flag')} onTap={onFlag} />
      ) : (
        <CompactMenuRow icon={<FlagOff className="size-3.5" />} label={t('sessionMenu.unflag')} onTap={onUnflag} />
      )}

      {!isArchived ? (
        <CompactMenuRow icon={<Archive className="size-3.5" />} label={t('sessionMenu.archive')} onTap={onArchive} />
      ) : (
        <CompactMenuRow icon={<ArchiveRestore className="size-3.5" />} label={t('sessionMenu.unarchive')} onTap={onUnarchive} />
      )}

      {!hasUnread && hasMessages && (
        <CompactMenuRow icon={<MailOpen className="size-3.5" />} label={t('sessionMenu.markAsUnread')} onTap={onMarkUnread} />
      )}

      <Separator />

      <CompactMenuRow icon={<Pencil className="size-3.5" />} label={t('common.rename')} onTap={onRename} />
      <CompactMenuRow icon={<RefreshCw className="size-3.5" />} label={t('sessionMenu.regenerateTitle')} onTap={onRefreshTitle} />

      <Separator />

      <CompactMenuRow
        icon={<FolderOpen className="size-3.5" />}
        label={t('sessionMenu.showInFileManager', { fileManager: getFileManagerName() })}
        onTap={onShowInFinder}
      />
      <CompactMenuRow icon={<Copy className="size-3.5" />} label={t('sessionMenu.copyPath')} onTap={onCopyPath} />

      <Separator />

      <CompactMenuRow
        icon={<Trash2 className="size-3.5" />}
        label={t('common.delete')}
        destructive
        onTap={onDelete}
      />
    </div>
  )
}

function StatusPane({
  sessionStatuses,
  activeStateId,
  onSelect,
}: {
  sessionStatuses: SessionStatus[]
  activeStateId?: SessionStatusId | null
  onSelect: (id: SessionStatusId) => void
}) {
  return (
    <div className="flex flex-col">
      {sessionStatuses.map((state) => {
        const bareStateIcon = React.isValidElement(state.icon)
          ? React.cloneElement(state.icon as React.ReactElement<{ bare?: boolean }>, { bare: true })
          : state.icon
        return (
          <CompactMenuRow
            key={state.id}
            icon={<span style={getStatusIconStyle(state)}>{bareStateIcon}</span>}
            label={state.label}
            radioSelected={activeStateId === state.id}
            onTap={() => onSelect(state.id)}
          />
        )
      })}
    </div>
  )
}

function LabelsPane({
  items,
  appliedLabelIds,
  onToggle,
}: {
  items: LabelMenuItem[]
  appliedLabelIds: Set<string>
  onToggle: (id: string) => void
}) {
  // The Labels row in RootPane is gated on `hasLabels`, so this pane is only
  // ever entered when items.length > 0 — no empty-state branch needed.
  return (
    <div className="flex flex-col">
      {items.map((item) => {
        const isApplied = appliedLabelIds.has(item.id)
        return (
          <CompactMenuRow
            key={item.id}
            icon={<LabelIcon label={item.config} size="lg" />}
            label={item.parentPath ? (
              <>
                <span className="text-foreground/50">{item.parentPath}</span>
                {item.label}
              </>
            ) : item.label}
            radioSelected={isApplied}
            onTap={() => onToggle(item.id)}
          />
        )
      })}
    </div>
  )
}

function SharePane({
  onOpenInBrowser,
  onCopyLink,
  onUpdateShare,
  onRevokeShare,
}: {
  onOpenInBrowser: () => void
  onCopyLink: () => void
  onUpdateShare: () => void
  onRevokeShare: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col">
      <CompactMenuRow icon={<Globe className="size-3.5" />} label={t('sessionMenu.openInBrowser')} onTap={onOpenInBrowser} />
      <CompactMenuRow icon={<Copy className="size-3.5" />} label={t('sessionMenu.copyLink')} onTap={onCopyLink} />
      <CompactMenuRow icon={<RefreshCw className="size-3.5" />} label={t('sessionMenu.updateShare')} onTap={onUpdateShare} />
      <Separator />
      <CompactMenuRow icon={<Link2Off className="size-3.5" />} label={t('sessionMenu.stopSharing')} destructive onTap={onRevokeShare} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

interface RowProps extends Omit<React.ComponentProps<'button'>, 'children' | 'onClick'> {
  icon: React.ReactNode
  label: React.ReactNode
  trailing?: React.ReactNode
  chevron?: boolean
  radioSelected?: boolean
  destructive?: boolean
  onTap?: () => void
  /** Set by a drawer trigger (`asChild`) that wraps the row. */
  onClick?: React.MouseEventHandler<HTMLButtonElement>
}

export function CompactMenuRow({
  icon,
  label,
  trailing,
  chevron,
  radioSelected,
  destructive,
  onTap,
  onClick,
  className,
  ...props
}: RowProps) {
  if (!onTap && !onClick) return null
  return (
    <button
      type="button"
      {...props}
      onClick={onClick ?? (() => onTap?.())}
      className={cn(
        'flex items-center gap-3 w-full px-3 py-3 rounded-lg text-left transition-colors',
        'hover:bg-foreground/5 active:bg-foreground/10',
        destructive && 'text-destructive hover:bg-destructive/10 active:bg-destructive/15',
        className,
      )}
    >
      <span className="shrink-0 inline-flex items-center justify-center h-5 w-5">
        {icon}
      </span>
      <span className="flex-1 min-w-0 text-sm truncate">{label}</span>
      {trailing}
      {radioSelected && <Check className="size-3.5 shrink-0 text-foreground/70" />}
      {chevron && <ChevronRight className="size-3.5 shrink-0 text-foreground/50" />}
    </button>
  )
}

function Separator() {
  return <div className="my-1 mx-3 h-px bg-foreground/[0.06]" />
}

function CountBadge({ count }: { count: number }) {
  return (
    <span className="text-[11px] tabular-nums text-foreground/50">
      {count}
    </span>
  )
}
