import { useState } from "react"
import { formatDistanceToNowStrict } from "date-fns"
import type { Locale } from "date-fns"
import { ClipboardList, Flag, MoreHorizontal, ShieldAlert } from "lucide-react"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { SidebarMenuAction, SidebarMenuButton } from "@workspace/ui/components/sidebar"
import { useActionLabel } from "@/actions"
import { cn } from "@/lib/utils"
import { rendererPerf } from "@/lib/perf"
import { Spinner } from "@otto/ui"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
} from "@/components/ui/styled-dropdown"
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
} from "@/components/ui/styled-context-menu"
import { DropdownMenuProvider, ContextMenuProvider } from "@/components/ui/menu-context"
import { SessionMenu } from "./session-menu"
import { BatchSessionMenu } from "./batch-session-menu"
import { CompactSessionMenu } from "./compact-session-menu"
import { SessionStatusIcon } from "./session-status-icon"
import { SessionBadges } from "./session-badges"
import { hasTransferTargets } from "./transfer-targets"
import { getSessionTitle, highlightMatch, hasUnreadMeta, shortTimeLocale } from "@/utils/session"
import { useSessionListContext } from "@/context/session-list-context"
import { useAppShellContext } from "@/context/app-shell-context"
import type { SessionMeta } from "@/atoms/sessions"
import { extractLabelId } from "@otto/shared/labels"

export interface SessionItemProps {
  item: SessionMeta
  itemProps: Record<string, unknown>
  isSelected: boolean
  isInMultiSelect: boolean
  onSelect: () => void
  onToggleSelect?: () => void
  onRangeSelect?: () => void
}

/**
 * One session in the sidebar: a 28px `SidebarMenuButton` row like the pages above it.
 * The status icon is in the 20px slot (a checkbox while several are selected), then the
 * title, then what needs a look (running, unread, a plan, a prompt, the project's dot) and
 * the time. A session with labels has them on a second line (40px). The row's menu is a
 * 24px button over the time on hover or focus (a drawer in compact mode); the open session
 * is filled like an open page.
 */
export function SessionItem({
  item,
  itemProps,
  isSelected,
  isInMultiSelect,
  onSelect,
  onToggleSelect,
  onRangeSelect,
}: SessionItemProps) {
  const ctx = useSessionListContext()
  const { workspaces, isCompactMode } = useAppShellContext()
  const canSendToWorkspace = hasTransferTargets(workspaces)
  const { hotkey: nextHotkey } = useActionLabel('chat.nextSearchMatch')
  const { hotkey: prevHotkey } = useActionLabel('chat.prevSearchMatch')
  const [menuOpen, setMenuOpen] = useState(false)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const [compactMenuOpen, setCompactMenuOpen] = useState(false)
  const title = getSessionTitle(item)
  // For the active session, prefer logical match count over ripgrep count
  const activeMatch = ctx.activeChatMatchInfo
  const isActiveSession = isSelected && activeMatch?.sessionId === item.id
  const ripgrepMatchCount = ctx.contentSearchResults.get(item.id)?.matchCount
  const chatMatchCount = isActiveSession ? activeMatch!.count : ripgrepMatchCount
  const hasMatch = chatMatchCount != null && chatMatchCount > 0
  const hasLabels = !!(item.labels && item.labels.length > 0 && ctx.flatLabels.length > 0 && item.labels.some(entry => {
    const labelId = extractLabelId(entry)
    return ctx.flatLabels.some(l => l.id === labelId)
  }))
  const hasPendingPrompt = ctx.hasPendingPrompt?.(item.id) ?? false
  const isUnread = hasUnreadMeta(item)
  const boundProject = item.projectId
    ? ctx.projects?.find(p => p.id === item.projectId)
    : undefined

  const handleClick = (e: React.MouseEvent) => {
    ctx.onFocusZone()
    if (e.button === 2) {
      if (ctx.isMultiSelectActive && !isInMultiSelect && onToggleSelect) onToggleSelect()
      return
    }
    if ((e.metaKey || e.ctrlKey) && onToggleSelect) {
      // Cmd+Click: always toggle multi-select (standard OS behavior)
      e.preventDefault()
      onToggleSelect()
      return
    }
    if (e.shiftKey && onRangeSelect) {
      e.preventDefault()
      onRangeSelect()
      return
    }
    rendererPerf.startSessionSwitch(item.id)
    onSelect()
  }

  const menuContent = (
    <SessionMenu
      item={item}
      sessionStatuses={ctx.sessionStatuses}
      labels={ctx.labels}
      onLabelsChange={ctx.onLabelsChange ? (ls) => ctx.onLabelsChange!(item.id, ls) : undefined}
      onRename={() => ctx.onRenameClick(item.id, title)}
      onFlag={() => ctx.onFlag?.(item.id)}
      onUnflag={() => ctx.onUnflag?.(item.id)}
      onArchive={() => ctx.onArchive?.(item.id)}
      onUnarchive={() => ctx.onUnarchive?.(item.id)}
      onMarkUnread={() => ctx.onMarkUnread(item.id)}
      onSessionStatusChange={(s) => ctx.onSessionStatusChange(item.id, s)}
      onSendToWorkspace={ctx.onSendToWorkspace ? () => ctx.onSendToWorkspace!([item.id]) : undefined}
      hasTransferTargets={canSendToWorkspace}
      onDelete={() => ctx.onDelete(item.id)}
      projects={ctx.projects}
      onSetProjectId={ctx.onSetProjectId ? (pid) => ctx.onSetProjectId!(item.id, pid) : undefined}
    />
  )

  const row = (
    <SidebarMenuButton
      // A div, not a button: the status icon and the checkbox inside are buttons.
      render={<div />}
      {...(itemProps as React.ComponentProps<"button">)}
      isActive={isSelected || isInMultiSelect}
      className={hasLabels ? "h-10 items-start" : undefined}
      onMouseDown={handleClick}
      onKeyDown={(e: React.KeyboardEvent<HTMLButtonElement>) => {
        ;(itemProps as { onKeyDown: (event: React.KeyboardEvent) => void }).onKeyDown(e)
        ctx.onKeyDown(e, item)
      }}
      // The ⋯ button is outside the row: mark the row while its menu is open, as the context menu's trigger does.
      // Spread, not `data-popup-open={undefined}`: an unset prop would hide the trigger's own mark.
      {...(menuOpen || compactMenuOpen ? { "data-popup-open": "" } : {})}
      // Compact mode has no context menu: the drawer opens instead.
      onContextMenu={isCompactMode ? (e: React.MouseEvent) => { e.preventDefault(); setCompactMenuOpen(true) } : undefined}
    >
      <span data-slot="icon-slot" className="flex size-5 shrink-0 items-center justify-center">
        {ctx.isMultiSelectActive ? (
          <span onMouseDown={(e) => e.stopPropagation()}>
            <Checkbox checked={isInMultiSelect} onCheckedChange={() => onToggleSelect?.()} />
          </span>
        ) : (
          <SessionStatusIcon item={item} />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex h-5 items-center gap-2">
          <span className={cn(
            "min-w-0 flex-1 truncate",
            isUnread && "text-foreground",
            item.isAsyncOperationOngoing && "animate-shimmer-text",
          )}>
            {ctx.searchQuery ? highlightMatch(title, ctx.searchQuery) : title}
          </span>
          <span className="flex shrink-0 items-center gap-1.5 not-pointer-fine:mr-6">
            {item.isProcessing && <Spinner className="text-[10px]" />}
            {isUnread && <span className="size-2 rounded-full bg-primary" />}
            {item.lastMessageRole === 'plan' && <ClipboardList className="text-success" />}
            {hasPendingPrompt && <ShieldAlert className="text-info" />}
            {boundProject?.color && (
              <span title={boundProject.name} className="size-1.5 rounded-full" style={{ backgroundColor: boundProject.color }} />
            )}
            {/* The time, flag or match count: what the menu button covers on hover. */}
            <span className={cn(
              "text-xs tabular-nums",
              menuOpen || contextMenuOpen ? "invisible" : "group-focus-within/menu-item:invisible group-hover/menu-item:invisible",
            )}>
              {hasMatch ? (
                <span
                  className="rounded-xs bg-foreground/10 px-1 text-foreground"
                  title={`Matches found (${nextHotkey} next, ${prevHotkey} prev)`}
                >
                  {chatMatchCount}
                </span>
              ) : item.isFlagged ? (
                <Flag className="size-3.5 text-info" />
              ) : item.lastMessageAt ? (
                formatDistanceToNowStrict(new Date(item.lastMessageAt), { locale: shortTimeLocale as Locale, roundingMethod: 'floor' })
              ) : null}
            </span>
          </span>
        </span>
        {hasLabels && (
          <span className="flex h-3 items-center gap-2 overflow-hidden text-xs leading-3">
            <SessionBadges item={item} />
          </span>
        )}
      </span>
    </SidebarMenuButton>
  )

  // Right-click opens the batch menu while several are selected, else the session's own.
  const contextMenu = ctx.isMultiSelectActive && isInMultiSelect ? <BatchSessionMenu /> : menuContent

  return (
    <div
      className="session-item group/menu-item relative"
      data-session-id={item.id}
      data-selected={isSelected || undefined}
    >
      {isCompactMode ? row : (
        <ContextMenu modal onOpenChange={setContextMenuOpen}>
          <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
          <StyledContextMenuContent>
            <ContextMenuProvider>{contextMenu}</ContextMenuProvider>
          </StyledContextMenuContent>
        </ContextMenu>
      )}

      {isCompactMode ? (
        <SidebarMenuAction aria-haspopup="dialog" aria-expanded={compactMenuOpen} onClick={() => setCompactMenuOpen(true)}>
          <MoreHorizontal />
        </SidebarMenuAction>
      ) : (
        <DropdownMenu modal open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuAction>
              <MoreHorizontal />
            </SidebarMenuAction>
          </DropdownMenuTrigger>
          <StyledDropdownMenuContent align="end">
            <DropdownMenuProvider>{menuContent}</DropdownMenuProvider>
          </StyledDropdownMenuContent>
        </DropdownMenu>
      )}

      {isCompactMode && (
        <CompactSessionMenu
          open={compactMenuOpen}
          onOpenChange={setCompactMenuOpen}
          trigger={null}
          title={title}
          item={item}
          sessionStatuses={ctx.sessionStatuses}
          labels={ctx.labels}
          hasTransferTargets={canSendToWorkspace}
          onLabelsChange={ctx.onLabelsChange ? (ls) => ctx.onLabelsChange!(item.id, ls) : undefined}
          onRename={() => ctx.onRenameClick(item.id, title)}
          onFlag={() => ctx.onFlag?.(item.id)}
          onUnflag={() => ctx.onUnflag?.(item.id)}
          onArchive={() => ctx.onArchive?.(item.id)}
          onUnarchive={() => ctx.onUnarchive?.(item.id)}
          onMarkUnread={() => ctx.onMarkUnread(item.id)}
          onSessionStatusChange={(s) => ctx.onSessionStatusChange(item.id, s)}
          onSendToWorkspace={ctx.onSendToWorkspace ? () => ctx.onSendToWorkspace!([item.id]) : undefined}
          onDelete={() => ctx.onDelete(item.id)}
        />
      )}
    </div>
  )
}
