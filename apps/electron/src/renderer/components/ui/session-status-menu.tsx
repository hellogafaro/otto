import * as React from 'react'
import { useTranslation } from "react-i18next"
import { Command as CommandPrimitive } from 'cmdk'
import { Archive, ArchiveRestore, Ban, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MENU_LIST, MENU_ROW_CMDK, MENU_SEPARATOR, MENU_SURFACE } from './menu-styles'
import {
  type SessionStatusId,
  type SessionStatus,
  getStateIcon,
  getStateColor,
  getStatusIconStyle,
} from '@/config/session-status-config'

// Re-export types for backwards compatibility
export { type SessionStatusId, type SessionStatus, getStateIcon, getStateColor }

// ============================================================================
// StateItemContent - Shared item rendering
// ============================================================================

const DEFAULT_STATUS_IDS = new Set(['backlog', 'todo', 'needs-review', 'done', 'cancelled'])

function StateItemContent({ state, isActive }: { state: SessionStatus; isActive: boolean }) {
  const { t } = useTranslation()
  const label = DEFAULT_STATUS_IDS.has(state.id) ? t(`status.${state.id}`, state.label) : state.label
  return (
    <>
      <span className="shrink-0 flex items-center" style={getStatusIconStyle(state)}>
        {state.icon}
      </span>
      <div className="flex-1 min-w-0">{label}</div>
      {isActive && <Check className="shrink-0" />}
    </>
  )
}

// ============================================================================
// SessionStatusMenu Component - For selecting/changing a session's state
// ============================================================================

export interface SessionStatusMenuProps {
  states?: SessionStatus[]
  activeState: SessionStatusId
  onSelect: (stateId: SessionStatusId) => void
  /** Whether the session is currently archived */
  isArchived?: boolean
  /** Archive action - shows Archive item at bottom when provided and not archived */
  onArchive?: () => void
  /** Unarchive action - shows Unarchive item at bottom when provided and archived */
  onUnarchive?: () => void
  /** Clear action - shows a "clear" item at bottom (e.g. "No status change") when provided */
  onClear?: () => void
  /** Label for the clear item. Defaults to "Clear". */
  clearLabel?: string
  className?: string
}

export function SessionStatusMenu({
  states = [],
  activeState,
  onSelect,
  isArchived,
  onArchive,
  onUnarchive,
  onClear,
  clearLabel,
  className,
}: SessionStatusMenuProps) {
  const { t } = useTranslation()
  const [filter, setFilter] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)

  // Focus input when menu opens
  React.useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus()
    }, 0)
    return () => clearTimeout(timer)
  }, [])

  // Find default value - prefer active state, otherwise first item
  const defaultValue = activeState || states[0]?.id

  return (
    <CommandPrimitive
      className={cn('relative min-w-[180px]', MENU_SURFACE, className)}
      defaultValue={defaultValue}
    >
      <div className="px-2 py-1.5">
        <CommandPrimitive.Input
          ref={inputRef}
          value={filter}
          onValueChange={setFilter}
          placeholder={t("status.filterStatuses")}
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div className={MENU_SEPARATOR} />
      <CommandPrimitive.List className={cn(MENU_LIST, '[&_[cmdk-list-sizer]]:space-y-px')}>
        <CommandPrimitive.Empty className="py-3 text-center text-sm text-muted-foreground">
          No status found
        </CommandPrimitive.Empty>
        {states.map((state) => {
          const isActive = activeState === state.id
          return (
            <CommandPrimitive.Item
              key={state.id}
              value={state.label}
              onSelect={() => onSelect(state.id)}
              className={MENU_ROW_CMDK}
            >
              <StateItemContent state={state} isActive={isActive} />
            </CommandPrimitive.Item>
          )
        })}
        {/* Clear item - only shown when handler provided and no filter active */}
        {!filter && onClear && (
          <>
            <div className={MENU_SEPARATOR} />
            <CommandPrimitive.Item
              value="clear-status"
              onSelect={() => onClear()}
              className={MENU_ROW_CMDK}
            >
              <span className="shrink-0 flex items-center opacity-60">
                <Ban />
              </span>
              <div className="flex-1 min-w-0">{clearLabel ?? 'Clear'}</div>
              {!activeState && <Check className="shrink-0" />}
            </CommandPrimitive.Item>
          </>
        )}
        {/* Archive/Unarchive item - only shown when handler provided and no filter active */}
        {!filter && (isArchived ? onUnarchive : onArchive) && (
          <>
            <div className={MENU_SEPARATOR} />
            <CommandPrimitive.Item
              value={isArchived ? "unarchive" : "archive"}
              onSelect={() => isArchived ? onUnarchive?.() : onArchive?.()}
              className={MENU_ROW_CMDK}
            >
              <span className="shrink-0 flex items-center opacity-60">
                {isArchived ? <ArchiveRestore /> : <Archive />}
              </span>
              <div className="flex-1 min-w-0">{isArchived ? 'Unarchive' : 'Archive'}</div>
            </CommandPrimitive.Item>
          </>
        )}
      </CommandPrimitive.List>
    </CommandPrimitive>
  )
}
