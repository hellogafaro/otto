import * as React from 'react'
import { useTranslation } from "react-i18next"
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SlashCommandMenu, permissionModeCommandsFor, type SlashCommandId } from '@/components/ui/slash-command-menu'
import { useAvailablePermissionModes } from '@/hooks/use-available-permission-modes'
import { ChevronDown, Info } from 'lucide-react'
import { PERMISSION_MODE_CONFIG, isPermissionMode, type PermissionMode } from '@otto/shared/agent/modes'
import { ActiveTasksBar, type BackgroundTask } from './active-tasks-bar'
import type { TerminalOverlayData } from './task-action-menu'
import { LabelIcon, LabelValueTypeIcon } from '@/components/ui/label-icon'
import { LabelValuePopover } from '@/components/ui/label-value-popover'
import type { LabelConfig } from '@otto/shared/labels'
import { flattenLabels, parseLabelEntry, formatLabelEntry, formatDisplayValue } from '@otto/shared/labels'
import { resolveEntityColor } from '@otto/shared/colors'
import { useTheme } from '@/context/theme-context'
import { useDynamicStack } from '@/hooks/use-dynamic-stack'
import type { SessionStatus } from '@/config/session-status-config'
import { getState } from '@/config/session-status-config'
import { SessionStatusMenu } from '@/components/ui/session-status-menu'
import { MetadataBadge } from '@/components/ui/metadata-badge'
import { ToolbarChip } from '@/components/ui/toolbar-chip'
import { openLabelLink } from '@/lib/open-label-link'
import { SessionInfoPopover } from './session-info-popover'

// ============================================================================
// Permission Mode Icon Component
// ============================================================================

function PermissionModeIcon({ mode, className }: { mode: PermissionMode; className?: string }) {
  const config = PERMISSION_MODE_CONFIG[mode] ?? PERMISSION_MODE_CONFIG.ask
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d={config.svgPath} />
    </svg>
  )
}

export interface ActiveOptionBadgesProps {
  /** Current permission mode */
  permissionMode?: PermissionMode
  /** Callback when permission mode changes */
  onPermissionModeChange?: (mode: PermissionMode) => void
  /** Background tasks to display */
  tasks?: BackgroundTask[]
  /** Session ID for opening preview windows */
  sessionId?: string
  /** Absolute path to the session folder (for Files header actions) */
  sessionFolderPath?: string
  /** Callback when kill button is clicked on a task */
  onKillTask?: (taskId: string) => void
  /** Callback to insert message into input field */
  onInsertMessage?: (text: string) => void
  /** Callback to show a task's output in a terminal overlay (optional) */
  onShowTerminalOverlay?: (data: TerminalOverlayData) => void
  /** Label entries applied to this session (e.g., ["bug", "priority::3"]) */
  sessionLabels?: string[]
  /** Available label configs (tree structure) for resolving label display */
  labels?: LabelConfig[]
  /** Callback when a label is removed (legacy — prefer onLabelsChange) */
  onRemoveLabel?: (labelId: string) => void
  /** Callback when session labels array changes (value edits or removals) */
  onLabelsChange?: (updatedLabels: string[]) => void
  /** Label ID whose value popover should auto-open (set when a valued label is added via # menu) */
  autoOpenLabelId?: string | null
  /** Called after the auto-open has been consumed, so the parent can clear the signal */
  onAutoOpenConsumed?: () => void
  // ── State/status badge (in dynamic stack) ──
  /** Available workflow states */
  sessionStatuses?: SessionStatus[]
  /** Current session state ID */
  currentSessionStatus?: string
  /** Callback when state changes */
  onSessionStatusChange?: (stateId: string) => void
  /** Additional CSS classes */
  className?: string
}

/** Resolved label entry: config + parsed value + original index in sessionLabels */
interface ResolvedLabelEntry {
  config: LabelConfig
  rawValue?: string
  index: number
}

export function ActiveOptionBadges({
  permissionMode = 'ask',
  onPermissionModeChange,
  tasks = [],
  sessionId,
  sessionFolderPath,
  onKillTask,
  onInsertMessage,
  onShowTerminalOverlay,
  sessionLabels = [],
  labels = [],
  onRemoveLabel,
  onLabelsChange,
  autoOpenLabelId,
  onAutoOpenConsumed,
  sessionStatuses = [],
  currentSessionStatus,
  onSessionStatusChange,
  className,
}: ActiveOptionBadgesProps) {
  // Resolve session label entries to their config objects + parsed values.
  // Entries may be bare IDs ("bug") or valued ("priority::3").
  // Preserves the raw value and original index for editing/removal.
  const resolvedLabels = React.useMemo((): ResolvedLabelEntry[] => {
    if (sessionLabels.length === 0 || labels.length === 0) return []
    const flat = flattenLabels(labels)
    const result: ResolvedLabelEntry[] = []
    for (let i = 0; i < sessionLabels.length; i++) {
      const parsed = parseLabelEntry(sessionLabels[i])
      const config = flat.find(l => l.id === parsed.id)
      if (config) {
        result.push({ config, rawValue: parsed.rawValue, index: i })
      }
    }
    return result
  }, [sessionLabels, labels])

  const hasLabels = resolvedLabels.length > 0

  // Resolve the current state from sessionStatuses for the badge display.
  // Every session always has a state — fall back to the default state (or 'todo')
  // when currentSessionStatus isn't explicitly set, matching SessionList's behavior.
  const effectiveStateId = currentSessionStatus || 'todo'
  const resolvedState = sessionStatuses.length > 0 ? getState(effectiveStateId, sessionStatuses) : undefined
  const hasState = !!resolvedState

  // Show the stacking container when there are labels (state badge is now rendered standalone on the left)
  const hasStackContent = hasLabels

  // Dynamic stacking with equal visible strips: ResizeObserver computes per-badge
  // margins directly on children. Wider badges get more negative margins so each
  // shows the same visible strip when stacked. No React re-renders needed.
  const stackRef = useDynamicStack({ gap: 8, minVisible: 20, reservedStart: 0 })

  // Only render if badges or tasks are active
  if (!permissionMode && tasks.length === 0 && !hasState && !hasStackContent) {
    return null
  }

  return (
    <>
      {/* Background tasks row — running / done / orphaned chips. Rendered above the
       * options row so a growing number of tasks wraps without disturbing the
       * mode/label badges. Only present when there are active/recent tasks. */}
      {tasks.length > 0 && sessionId && (
        <div className="flex items-center flex-wrap gap-2 mb-2 px-px">
          <ActiveTasksBar
            tasks={tasks}
            sessionId={sessionId}
            onKillTask={onKillTask}
            onInsertMessage={onInsertMessage}
            onShowTerminalOverlay={onShowTerminalOverlay}
          />
        </div>
      )}

    <div className={cn("flex items-start gap-2 mb-2 px-px pt-px pb-0.5", className)}>
      {/* Left side: mode → state → labels stack */}
      <div className="flex items-start gap-2 min-w-0 flex-1">
        {/* Permission Mode Badge */}
        {permissionMode && (
          <div className="shrink-0">
            <PermissionModeDropdown
              permissionMode={permissionMode}
              onPermissionModeChange={onPermissionModeChange}
              sessionId={sessionId}
            />
          </div>
        )}

        {/* State Badge — standalone on the left, after Mode */}
        {hasState && resolvedState && (
          <div className="shrink-0">
            <StateBadge
              state={resolvedState}
              sessionStatuses={sessionStatuses}
              onSessionStatusChange={onSessionStatusChange}
              sessionId={sessionId}
            />
          </div>
        )}

        {/* Stacking container for label badges (left side).
         * useDynamicStack sets per-child marginLeft directly via ResizeObserver.
         * overflow: clip prevents scroll container while py/-my gives shadow room. */}
        {hasStackContent && (
          <div className="flex-1 min-w-0 max-w-full">
            <div
              ref={stackRef}
              className="flex items-center min-w-0"
              style={{ overflow: 'clip' }}
            >
              {/* Label badges */}
              {resolvedLabels.map(({ config, rawValue, index }) => (
                <LabelBadge
                  key={`${config.id}-${index}`}
                  label={config}
                  value={rawValue}
                  autoOpen={config.id === autoOpenLabelId}
                  onAutoOpenConsumed={onAutoOpenConsumed}
                  sessionId={sessionId}
                  onValueChange={(newValue) => {
                    // Rebuild the sessionLabels array with the updated entry
                    const updated = [...sessionLabels]
                    updated[index] = formatLabelEntry(config.id, newValue)
                    onLabelsChange?.(updated)
                  }}
                  onRemove={() => {
                    if (onLabelsChange) {
                      onLabelsChange(sessionLabels.filter((_, i) => i !== index))
                    } else {
                      onRemoveLabel?.(config.id)
                    }
                  }}
                />
              ))}
            </div>
          </div>
        )}

      </div>

      {/* Right side: Files popover button */}
      <div className="shrink-0">
        <FilesPopoverButton sessionId={sessionId} sessionFolderPath={sessionFolderPath} />
      </div>
    </div>
    </>
  )
}

// ============================================================================
// Label Badge Component
// ============================================================================

/**
 * Renders a single label badge with LabelValuePopover for editing/removal.
 * No box-shadow on the badge itself — all shadows come from the parent
 * wrapper's drop-shadow filter (traces masked alpha without clipping).
 * Shows: [color circle] [name] [· value in mono] [chevron]
 */
function LabelBadge({
  label,
  value,
  autoOpen,
  onAutoOpenConsumed,
  onValueChange,
  onRemove,
  sessionId,
}: {
  label: LabelConfig
  value?: string
  /** When true, auto-open the value popover on mount (for newly added valued labels) */
  autoOpen?: boolean
  onAutoOpenConsumed?: () => void
  onValueChange?: (newValue: string | undefined) => void
  onRemove: () => void
  sessionId?: string
}) {
  const { isDark } = useTheme()
  const [open, setOpen] = React.useState(false)

  // Auto-open the value popover when this label was just added via # menu
  // and has a valueType. Opens exactly once, then clears the signal.
  React.useEffect(() => {
    if (autoOpen && label.valueType) {
      setOpen(true)
      onAutoOpenConsumed?.()
    }
  }, [autoOpen, label.valueType, onAutoOpenConsumed])

  // Resolve label color for tinting background and text via CSS color-mix
  const resolvedColor = label.color
    ? resolveEntityColor(label.color, isDark)
    : undefined

  const displayValue = value ? formatDisplayValue(value, label.valueType) : undefined

  return (
    // Opaque base under the tint: stacked chips overlap, and a translucent one would show the text beneath.
    <span className="flex shrink-0 rounded-sm bg-background">
    <LabelValuePopover
      label={label}
      value={value}
      open={open}
      onOpenChange={setOpen}
      onValueChange={onValueChange}
      onRemove={onRemove}
      sessionId={sessionId}
    >
      <MetadataBadge
        label={label.name}
        value={displayValue}
        onValueClick={label.valueType === 'link' && value ? () => openLabelLink(value) : undefined}
        icon={<LabelIcon label={label} size="lg" />}
        valueHintIcon={label.valueType ? <LabelValueTypeIcon valueType={label.valueType} /> : undefined}
        badgeColor={resolvedColor}
        open={open}
        showChevron
      />
    </LabelValuePopover>
    </span>
  )
}

// ============================================================================
// State Badge Component
// ============================================================================

/**
 * Renders the current workflow state as a badge in the dynamic stacking container.
 * Click opens a SessionStatusMenu popover for changing the state.
 * Styled consistently with label badges (h-[30px], rounded-md, color-mix tinting).
 */
function StateBadge({
  state,
  sessionStatuses,
  onSessionStatusChange,
  sessionId,
}: {
  state: SessionStatus
  sessionStatuses: SessionStatus[]
  onSessionStatusChange?: (stateId: string) => void
  sessionId?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)

  const handleSelect = React.useCallback((stateId: string) => {
    setOpen(false)
    onSessionStatusChange?.(stateId)
  }, [onSessionStatusChange])

  // Use the state's resolved color for tinting (same color-mix pattern as labels)
  const badgeColor = state.resolvedColor || undefined
  const applyColor = state.iconColorable

  const DEFAULT_STATUS_IDS = new Set(['backlog', 'todo', 'needs-review', 'done', 'cancelled'])
  const stateLabel = DEFAULT_STATUS_IDS.has(state.id) ? t(`status.${state.id}`, state.label) : state.label

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <MetadataBadge
          label={stateLabel}
          badgeColor={badgeColor}
          showChevron
          icon={(
            <span
              className="shrink-0 flex items-center w-3.5 h-3.5 [&>svg]:w-full [&>svg]:h-full [&>img]:w-full [&>img]:h-full [&>span]:text-xs"
              style={applyColor ? { color: state.resolvedColor } : undefined}
            >
              {state.icon}
            </span>
          )}
        />
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0 border-0 shadow-none bg-transparent"
        side="top"
        align="end"
        sideOffset={4}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('otto:focus-input', {
            detail: { sessionId }
          }))
        }}
      >
        <SessionStatusMenu
          activeState={state.id}
          onSelect={handleSelect}
          states={sessionStatuses}
        />
      </PopoverContent>
    </Popover>
  )
}

function FilesPopoverButton({ sessionId, sessionFolderPath }: { sessionId?: string; sessionFolderPath?: string }) {
  const { t } = useTranslation()

  if (!sessionId) return null

  return (
    <SessionInfoPopover
      sessionId={sessionId}
      sessionFolderPath={sessionFolderPath}
      trigger={(
        <ToolbarChip type="button">
          <Info />
          <span className="whitespace-nowrap">{t("common.info")}</span>
        </ToolbarChip>
      )}
    />
  )
}

interface PermissionModeDropdownProps {
  permissionMode: PermissionMode
  onPermissionModeChange?: (mode: PermissionMode) => void
  sessionId?: string
}

function PermissionModeDropdown({ permissionMode, onPermissionModeChange, sessionId }: PermissionModeDropdownProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  // Optimistic local state - updates immediately, syncs with prop
  const [optimisticMode, setOptimisticMode] = React.useState(permissionMode)

  // Sync optimistic state when prop changes (confirmation from backend)
  React.useEffect(() => {
    setOptimisticMode(permissionMode)
  }, [permissionMode])

  const activeCommands = React.useMemo((): SlashCommandId[] => {
    return [optimisticMode as SlashCommandId]
  }, [optimisticMode])

  // Guarded is listed only while its decision-model feature is on (or it is the current mode)
  const modes = useAvailablePermissionModes(optimisticMode)
  const commandGroups = React.useMemo(() => [{ id: 'modes', commands: permissionModeCommandsFor(modes) }], [modes])

  // Handle command selection from dropdown
  const handleSelect = React.useCallback((commandId: SlashCommandId) => {
    if (isPermissionMode(commandId)) {
      setOptimisticMode(commandId)
      onPermissionModeChange?.(commandId)
    }
    setOpen(false)
  }, [onPermissionModeChange])

  // Mode-specific styling using CSS variables (theme-aware)
  // - safe (Explore): foreground at 60% opacity - subtle, read-only feel
  // - ask (Ask to Edit): info color - amber, prompts for edits
  // - guarded (Guarded): success color - green, autonomy with the decision model's risk check
  // - allow-all (Execute): accent color - purple, full autonomy
  const modeStyles: Record<PermissionMode, { className?: string; tint?: string }> = {
    'safe': {},
    'ask': { className: 'text-info', tint: 'var(--info)' },
    'guarded': { className: 'text-success', tint: 'var(--success)' },
    'allow-all': { className: 'text-primary', tint: 'var(--primary)' },
  }
  // A mode this build does not know (newer server) renders as Ask instead of crashing the input
  const currentStyle = modeStyles[optimisticMode] ?? modeStyles.ask

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ToolbarChip
          type="button"
          data-tutorial="permission-mode-dropdown"
          tint={currentStyle.tint}
          className={currentStyle.className}
        >
          <PermissionModeIcon mode={optimisticMode} />
          <span>{t(`mode.${optimisticMode}`)}</span>
          <ChevronDown className="opacity-60" />
        </ToolbarChip>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0 border-0 shadow-none bg-transparent"
        side="top"
        align="start"
        sideOffset={4}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          // Don't auto-focus the text input on touch devices — it pulls up the virtual keyboard
          const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0
          if (!isTouchDevice) {
            window.dispatchEvent(new CustomEvent('otto:focus-input', {
              detail: { sessionId }
            }))
          }
        }}
      >
        <SlashCommandMenu
          commandGroups={commandGroups}
          activeCommands={activeCommands}
          onSelect={handleSelect}
          showFilter
        />
      </PopoverContent>
    </Popover>
  )
}

