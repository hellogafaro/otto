import * as React from 'react'
import { useTranslation } from "react-i18next"
import { Command as CommandPrimitive } from 'cmdk'
import { Check, Minimize2 } from 'lucide-react'
import { Icon_Folder } from '@otto/ui'
import { cn } from '@/lib/utils'
import { MENU_LABEL, MENU_LIST, MENU_ROW, MENU_ROW_CMDK, MENU_ROW_HIGHLIGHT, MENU_SEPARATOR, MENU_SURFACE } from './menu-styles'
import { DEFAULT_PERMISSION_MODES, PERMISSION_MODE_CONFIG, PERMISSION_MODE_ORDER, isPermissionMode, type PermissionMode } from '@otto/shared/agent/modes'

// ============================================================================
// Types
// ============================================================================

export type SlashCommandId = PermissionMode | 'compact'

/** Union type for all item types in the slash menu */
export type SlashItemType = 'command' | 'folder'

export interface SlashCommand {
  id: SlashCommandId
  label: string
  description: string
  icon: React.ReactNode
  shortcut?: string
  /** Optional color for the command (hex color string) */
  color?: string
}

/** Folder item for the slash menu */
export interface SlashFolderItem {
  id: string
  type: 'folder'
  label: string
  description: string
  path: string
}

/** Section with header for the inline slash menu */
export interface SlashSection {
  id: string
  label: string
  items: (SlashCommand | SlashFolderItem)[]
}

export interface CommandGroup {
  id: string
  commands: SlashCommand[]
}

// ============================================================================
// Permission Mode Icon Component
// ============================================================================

interface PermissionModeIconProps {
  mode: PermissionMode
  className?: string
}

function PermissionModeIcon({ mode, className }: PermissionModeIconProps) {
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

// ============================================================================
// Default Commands
// ============================================================================

// Icon size constant
const MENU_ICON_SIZE = 'h-3.5 w-3.5'

// Permission mode commands from centralized config, one per mode
const PERMISSION_MODE_COMMANDS = new Map<PermissionMode, SlashCommand>(PERMISSION_MODE_ORDER.map(mode => {
  const config = PERMISSION_MODE_CONFIG[mode] ?? PERMISSION_MODE_CONFIG.ask
  return [mode, {
    id: mode,
    label: config.displayName,
    description: config.description,
    icon: <PermissionModeIcon mode={mode} className={MENU_ICON_SIZE} />,
  }]
}))

/** Commands for the modes a picker offers (see `useAvailablePermissionModes`), in the given order. */
export function permissionModeCommandsFor(modes: readonly PermissionMode[]): SlashCommand[] {
  return modes.flatMap(mode => PERMISSION_MODE_COMMANDS.get(mode) ?? [])
}

const permissionModeCommands = permissionModeCommandsFor(DEFAULT_PERMISSION_MODES)

const compactCommand: SlashCommand = {
  id: 'compact',
  label: 'Compact Context',
  description: 'Summarize conversation context to free up token budget',
  icon: <Minimize2 className={MENU_ICON_SIZE} />,
}

export const DEFAULT_SLASH_COMMANDS: SlashCommand[] = [
  ...permissionModeCommands,
  compactCommand,
]

export const DEFAULT_SLASH_COMMAND_GROUPS: CommandGroup[] = [
  { id: 'modes', commands: permissionModeCommands },
]

// ============================================================================
// Shared: Filter utilities
// ============================================================================

function filterCommands(commands: SlashCommand[], filter: string): SlashCommand[] {
  if (!filter) return commands
  const lowerFilter = filter.toLowerCase()
  return commands.filter(
    cmd =>
      cmd.label.toLowerCase().includes(lowerFilter) ||
      cmd.id.toLowerCase().includes(lowerFilter)
  )
}

/** Check if an item is a folder */
function isFolder(item: SlashCommand | SlashFolderItem): item is SlashFolderItem {
  return 'type' in item && item.type === 'folder'
}

/** Filter sections by label/id, keeping sections grouped */
function filterSections(sections: SlashSection[], filter: string): SlashSection[] {
  if (!filter) return sections
  const lowerFilter = filter.toLowerCase()

  // Filter items within each section, keeping section structure
  return sections
    .map(section => ({
      ...section,
      items: section.items.filter(item =>
        item.label.toLowerCase().includes(lowerFilter) ||
        item.id.toLowerCase().includes(lowerFilter) ||
        item.description?.toLowerCase().includes(lowerFilter)
      ),
    }))
    .filter(section => section.items.length > 0)
}

/** Flatten sections into a single array of items */
function flattenSections(sections: SlashSection[]): (SlashCommand | SlashFolderItem)[] {
  return sections.flatMap(section => section.items)
}

// ============================================================================
// Shared: Command Item Content
// ============================================================================

function CommandItemContent({ command, isActive }: { command: SlashCommand; isActive: boolean }) {
  const { t } = useTranslation()
  const label = isPermissionMode(command.id) ? t(`mode.${command.id}`, command.label) : command.label
  return (
    <>
      <div className="shrink-0 text-muted-foreground">{command.icon}</div>
      <div className="flex-1 min-w-0">{label}</div>
      {isActive && <Check className="shrink-0" />}
    </>
  )
}

// ============================================================================
// SlashCommandMenu Component (Button-triggered popup)
// ============================================================================

export interface SlashCommandMenuProps {
  /** Flat list of commands (use this OR commandGroups, not both) */
  commands?: SlashCommand[]
  /** Grouped commands with separators between groups */
  commandGroups?: CommandGroup[]
  activeCommands?: SlashCommandId[]
  onSelect: (commandId: SlashCommandId) => void
  showFilter?: boolean
  filterPlaceholder?: string
  className?: string
}

export function SlashCommandMenu({
  commands,
  commandGroups,
  activeCommands = [],
  onSelect,
  showFilter = false,
  filterPlaceholder,
  className,
}: SlashCommandMenuProps) {
  const { t } = useTranslation()
  const effectiveFilterPlaceholder = filterPlaceholder ?? t("commands.searchCommands")
  const [filter, setFilter] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)

  // If groups provided, filter within each group; otherwise use flat commands
  const filteredGroups = React.useMemo(() => {
    if (commandGroups) {
      return commandGroups.map(group => ({
        ...group,
        commands: filterCommands(group.commands, filter),
      })).filter(group => group.commands.length > 0)
    }
    return null
  }, [commandGroups, filter])

  const filteredCommands = React.useMemo(() => {
    if (commands && !commandGroups) {
      return filterCommands(commands, filter)
    }
    return null
  }, [commands, commandGroups, filter])

  // Get all commands for defaultValue calculation
  const allFilteredCommands = filteredGroups
    ? filteredGroups.flatMap(g => g.commands)
    : (filteredCommands ?? [])

  // Default to the first active command, or first command if none active
  const defaultValue = activeCommands[0] ?? allFilteredCommands[0]?.id

  React.useEffect(() => {
    // Don't auto-focus the filter on touch devices — it pulls up the virtual keyboard
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0
    if (showFilter && inputRef.current && !isTouchDevice) {
      inputRef.current.focus()
    }
  }, [showFilter])

  if (allFilteredCommands.length === 0 && !showFilter) return null

  // Render a single command item
  const renderCommandItem = (cmd: SlashCommand) => {
    const isActive = activeCommands.includes(cmd.id)
    return (
      <CommandPrimitive.Item
        key={cmd.id}
        value={cmd.id}
        onSelect={() => onSelect(cmd.id)}
        data-tutorial={`permission-mode-${cmd.id}`}
        className={MENU_ROW_CMDK}
      >
        <CommandItemContent command={cmd} isActive={isActive} />
      </CommandPrimitive.Item>
    )
  }

  return (
    <CommandPrimitive
      className={cn('relative min-w-[200px]', MENU_SURFACE, className)}
      shouldFilter={false}
      defaultValue={defaultValue}
    >
      {showFilter && (
        <div className="px-2 py-1.5">
          <CommandPrimitive.Input
            ref={inputRef}
            value={filter}
            onValueChange={setFilter}
            placeholder={effectiveFilterPlaceholder}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      )}
      {showFilter && <div className={MENU_SEPARATOR} />}
      <CommandPrimitive.List className={MENU_LIST}>
        {allFilteredCommands.length === 0 ? (
          <CommandPrimitive.Empty className="py-3 text-center text-sm text-muted-foreground">
            No commands found
          </CommandPrimitive.Empty>
        ) : filteredGroups ? (
          // Group-based rendering with smart separators
          filteredGroups.map((group, groupIndex) => (
            <React.Fragment key={group.id}>
              {group.commands.map(renderCommandItem)}
              {/* Separator: only show if there's another group after this one */}
              {groupIndex < filteredGroups.length - 1 && (
                <div className={MENU_SEPARATOR} />
              )}
            </React.Fragment>
          ))
        ) : (
          // Flat list rendering
          filteredCommands?.map(renderCommandItem)
        )}
      </CommandPrimitive.List>
    </CommandPrimitive>
  )
}

// ============================================================================
// InlineSlashCommand - Autocomplete that follows cursor
// ============================================================================

export interface InlineSlashCommandProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sections: SlashSection[]
  activeCommands?: SlashCommandId[]
  onSelectCommand: (commandId: SlashCommandId) => void
  onSelectFolder: (path: string) => void
  filter?: string
  position: { x: number; y: number }
  className?: string
}

export function InlineSlashCommand({
  open,
  onOpenChange,
  sections,
  activeCommands = [],
  onSelectCommand,
  onSelectFolder,
  filter = '',
  position,
  className,
}: InlineSlashCommandProps) {
  const menuRef = React.useRef<HTMLDivElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const filteredSections = filterSections(sections, filter)
  const flatItems = flattenSections(filteredSections)

  // Reset selection when filter changes
  React.useEffect(() => {
    setSelectedIndex(0)
  }, [filter])

  // Scroll selected item into view
  React.useEffect(() => {
    if (!listRef.current) return
    const selectedEl = listRef.current.querySelector('[data-selected="true"]')
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  // Handle item selection
  const handleSelect = React.useCallback((item: SlashCommand | SlashFolderItem) => {
    if (isFolder(item)) {
      onSelectFolder(item.path)
    } else {
      onSelectCommand(item.id)
    }
    onOpenChange(false)
  }, [onSelectCommand, onSelectFolder, onOpenChange])

  // Keyboard navigation
  // Don't attach listener when no items - allows Enter to propagate to input handler
  React.useEffect(() => {
    if (!open || flatItems.length === 0) return

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex(prev => (prev < flatItems.length - 1 ? prev + 1 : 0))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex(prev => (prev > 0 ? prev - 1 : flatItems.length - 1))
          break
        case 'Enter':
        case 'Tab':
          e.preventDefault()
          if (flatItems[selectedIndex]) {
            handleSelect(flatItems[selectedIndex])
          }
          break
        case 'Escape':
          e.preventDefault()
          onOpenChange(false)
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, flatItems, selectedIndex, handleSelect, onOpenChange])

  // Close on click outside
  React.useEffect(() => {
    if (!open) return

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onOpenChange(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open, onOpenChange])

  // Hide if no results or not open
  if (!open || flatItems.length === 0) return null

  // Calculate bottom position from window height (menu appears above cursor)
  const bottomPosition = typeof window !== 'undefined'
    ? window.innerHeight - Math.round(position.y) + 8
    : 0

  // Track current item index across all sections
  let currentItemIndex = 0

  return (
    <div
      ref={menuRef}
      data-inline-menu
      className={cn('fixed z-dropdown', MENU_SURFACE, className)}
      style={{ left: Math.round(position.x) - 10, bottom: bottomPosition, minWidth: 220, maxWidth: 260 }}
    >
      <div ref={listRef} className={MENU_LIST}>
        {filteredSections.map((section, sectionIndex) => (
          <React.Fragment key={section.id}>
            {/* Section header */}
            <div className={cn(MENU_LABEL, sectionIndex > 0 && 'mt-1')}>
              {section.label}
            </div>

            {/* Section items */}
            {section.items.map((item) => {
              const itemIndex = currentItemIndex++
              const isSelected = itemIndex === selectedIndex

              if (isFolder(item)) {
                // Folder item - single line with path
                return (
                  <div
                    key={`${section.id}-${item.id}`}
                    data-selected={isSelected}
                    onClick={() => handleSelect(item)}
                    onMouseEnter={() => setSelectedIndex(itemIndex)}
                    className={cn(MENU_ROW, isSelected && MENU_ROW_HIGHLIGHT)}
                  >
                    <div className="shrink-0 text-muted-foreground">
                      <Icon_Folder className={MENU_ICON_SIZE} strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0 truncate">
                      <span>{item.label}</span>
                      <span className="text-muted-foreground ml-1.5">{item.description}</span>
                    </div>
                  </div>
                )
              } else {
                // Command item
                const isActive = activeCommands.includes(item.id)
                return (
                  <div
                    key={item.id}
                    data-selected={isSelected}
                    onClick={() => handleSelect(item)}
                    onMouseEnter={() => setSelectedIndex(itemIndex)}
                    className={cn(MENU_ROW, isSelected && MENU_ROW_HIGHLIGHT)}
                  >
                    <CommandItemContent command={item} isActive={isActive} />
                  </div>
                )
              }
            })}

          </React.Fragment>
        ))}
      </div>
      {/* Always-visible footer hint for @ mentions */}
      <div className={MENU_SEPARATOR} />
      <div className={cn(MENU_LABEL, 'select-none font-normal')}>
        Use @ for skills and files
      </div>
    </div>
  )
}

// ============================================================================
// Hook for managing inline slash command state
// ============================================================================

/** Interface for elements that can be used with useInlineSlashCommand */
export interface SlashCommandInputElement {
  getBoundingClientRect: () => DOMRect
  getCaretRect?: () => DOMRect | null
  value: string
  selectionStart: number
}

/**
 * Format path for display, shortening home directory
 */
function formatPathForDisplay(path: string, homeDir?: string): string {
  if (homeDir && path.startsWith(homeDir)) {
    return '~' + path.slice(homeDir.length)
  }
  return path
}

/**
 * Get folder name from path
 */
function getFolderName(path: string): string {
  return path.split('/').pop() || path
}

export interface UseInlineSlashCommandOptions {
  /** Ref to input element (textarea or RichTextInput handle) */
  inputRef: React.RefObject<SlashCommandInputElement | null>
  /** Permission modes to offer (defaults to Explore, Ask, Execute) */
  modes?: readonly PermissionMode[]
  onSelectCommand: (commandId: SlashCommandId) => void
  onSelectFolder: (path: string) => void
  activeCommands?: SlashCommandId[]
  recentFolders?: string[]
  homeDir?: string
}

export interface UseInlineSlashCommandReturn {
  isOpen: boolean
  filter: string
  position: { x: number; y: number }
  sections: SlashSection[]
  handleInputChange: (value: string, cursorPosition: number) => void
  close: () => void
  activeCommands: SlashCommandId[]
  handleSelectCommand: (commandId: SlashCommandId) => string
  handleSelectFolder: (path: string) => string
}

export function useInlineSlashCommand({
  inputRef,
  modes = DEFAULT_PERMISSION_MODES,
  onSelectCommand,
  onSelectFolder,
  activeCommands = [],
  recentFolders = [],
  homeDir,
}: UseInlineSlashCommandOptions): UseInlineSlashCommandReturn {
  const [isOpen, setIsOpen] = React.useState(false)
  const [filter, setFilter] = React.useState('')
  const [position, setPosition] = React.useState({ x: 0, y: 0 })
  const [slashStart, setSlashStart] = React.useState(-1)
  // Store current input state for handleSelect
  const currentInputRef = React.useRef({ value: '', cursorPosition: 0 })

  // Build sections from commands and folders
  const sections = React.useMemo((): SlashSection[] => {
    const result: SlashSection[] = []

    // Modes section
    result.push({
      id: 'modes',
      label: 'Modes',
      items: permissionModeCommandsFor(modes),
    })

    // Commands section
    result.push({
      id: 'commands',
      label: 'Commands',
      items: [compactCommand],
    })

    // Recent folders section - sorted alphabetically by folder name, show all
    if (recentFolders.length > 0) {
      const sortedFolders = [...recentFolders]
        .sort((a, b) => {
          const nameA = getFolderName(a).toLowerCase()
          const nameB = getFolderName(b).toLowerCase()
          return nameA.localeCompare(nameB)
        })

      result.push({
        id: 'folders',
        label: 'Recent Working Directories',
        items: sortedFolders.map(path => ({
          id: path,
          type: 'folder' as const,
          label: getFolderName(path),
          description: formatPathForDisplay(path, homeDir),
          path,
        })),
      })
    }

    return result
  }, [modes, recentFolders, homeDir])

  const handleInputChange = React.useCallback((value: string, cursorPosition: number) => {
    // Store current state for handleSelect
    currentInputRef.current = { value, cursorPosition }

    const textBeforeCursor = value.slice(0, cursorPosition)
    const slashMatch = textBeforeCursor.match(/(?:^|\s)\/(\w*)$/)

    // Only show menu if we have sections with items
    const hasItems = sections.some(s => s.items.length > 0)

    if (slashMatch && hasItems) {
      const filterText = slashMatch[1] || ''
      // Check if there are any filtered results before opening menu
      // This ensures Enter key works normally when no matches exist
      const filteredSections = filterSections(sections, filterText)
      const hasFilteredItems = filteredSections.some(s => s.items.length > 0)

      if (!hasFilteredItems) {
        // No results after filtering - close menu to allow normal Enter handling
        setIsOpen(false)
        setFilter('')
        setSlashStart(-1)
        return
      }

      const matchStart = textBeforeCursor.lastIndexOf('/')
      setSlashStart(matchStart)
      setFilter(filterText)

      if (inputRef.current) {
        // Try to get actual caret position from the input element
        const caretRect = inputRef.current.getCaretRect?.()

        if (caretRect && caretRect.x > 0) {
          // Use actual caret position
          setPosition({
            x: caretRect.x,
            y: caretRect.y,
          })
        } else {
          // Fallback: position at input element's left edge
          const rect = inputRef.current.getBoundingClientRect()
          const lineHeight = 20
          const linesBeforeCursor = textBeforeCursor.split('\n').length - 1
          setPosition({
            x: rect.left,
            y: rect.top + (linesBeforeCursor + 1) * lineHeight,
          })
        }
      }

      setIsOpen(true)
    } else {
      setIsOpen(false)
      setFilter('')
      setSlashStart(-1)
    }
  }, [inputRef, sections])

  const handleSelectCommand = React.useCallback((commandId: SlashCommandId): string => {
    // Capture values BEFORE any state changes to avoid race conditions
    let result = ''
    if (slashStart >= 0) {
      const { value: currentValue, cursorPosition } = currentInputRef.current
      const before = currentValue.slice(0, slashStart)
      const after = currentValue.slice(cursorPosition)
      result = (before + after).trim()
    }

    // Now safe to trigger state changes
    onSelectCommand(commandId)
    setIsOpen(false)

    return result
  }, [onSelectCommand, slashStart])

  const handleSelectFolder = React.useCallback((path: string): string => {
    // Capture values BEFORE any state changes to avoid race conditions
    // Folder selection directly changes working directory, doesn't insert text
    let result = ''
    if (slashStart >= 0) {
      const { value: currentValue, cursorPosition } = currentInputRef.current
      const before = currentValue.slice(0, slashStart)
      const after = currentValue.slice(cursorPosition)
      // Just remove the /command text, no badge insertion
      result = (before + after).trim()
    }

    // Trigger working directory change
    onSelectFolder(path)
    setIsOpen(false)

    return result
  }, [onSelectFolder, slashStart])

  const close = React.useCallback(() => {
    setIsOpen(false)
    setFilter('')
    setSlashStart(-1)
  }, [])

  return {
    isOpen,
    filter,
    position,
    sections,
    handleInputChange,
    close,
    activeCommands,
    handleSelectCommand,
    handleSelectFolder,
  }
}
