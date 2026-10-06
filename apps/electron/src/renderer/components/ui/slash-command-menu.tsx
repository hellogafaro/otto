import * as React from 'react'
import { useTranslation } from "react-i18next"
import { Check } from 'lucide-react'
import { Icon_Folder } from '@otto/ui'
import { cn } from '@/lib/utils'
import { MENU_LABEL, MENU_LIST, MENU_ROW, MENU_ROW_HIGHLIGHT, MENU_SEPARATOR, MENU_SURFACE } from './menu-styles'
import { PERMISSION_MODE_CONFIG, type PermissionMode } from '@otto/shared/agent/modes'

// ============================================================================
// Types
// ============================================================================

/**
 * One `/` command. The composer builds its list (DESIGN.md, Composer, Commands): what the removed toolbar
 * pickers did (permission mode, status, working directory, add files) plus Compact.
 */
export interface SlashCommand {
  id: string
  /** Already translated. */
  label: string
  description?: string
  icon: React.ReactNode
  /** The current value of a setting (the chat's mode, its status): shown with a check. */
  active?: boolean
}

/** A recent working directory in the slash menu. */
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

// ============================================================================
// Permission Mode Icon Component
// ============================================================================

export function PermissionModeIcon({ mode, className }: { mode: PermissionMode; className?: string }) {
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
// Shared: Filter utilities
// ============================================================================

/** Check if an item is a folder */
function isFolder(item: SlashCommand | SlashFolderItem): item is SlashFolderItem {
  return 'type' in item && item.type === 'folder'
}

/** Filter sections by label/id, keeping sections grouped */
export function filterSections(sections: SlashSection[], filter: string): SlashSection[] {
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

// Icon size constant
const MENU_ICON_SIZE = 'h-3.5 w-3.5'

// ============================================================================
// InlineSlashCommand - Autocomplete that follows cursor
// ============================================================================

export interface InlineSlashCommandProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sections: SlashSection[]
  onSelectCommand: (commandId: string) => void
  onSelectFolder: (path: string) => void
  filter?: string
  position: { x: number; y: number }
  className?: string
}

export function InlineSlashCommand({
  open,
  onOpenChange,
  sections,
  onSelectCommand,
  onSelectFolder,
  filter = '',
  position,
  className,
}: InlineSlashCommandProps) {
  const { t } = useTranslation()
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
              return (
                <div
                  key={`${section.id}-${item.id}`}
                  data-selected={isSelected}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIndex(itemIndex)}
                  className={cn(MENU_ROW, isSelected && MENU_ROW_HIGHLIGHT)}
                >
                  {isFolder(item) ? (
                    <>
                      <div className="shrink-0 text-muted-foreground">
                        <Icon_Folder className={MENU_ICON_SIZE} strokeWidth={1.75} />
                      </div>
                      <div className="flex-1 min-w-0 truncate">
                        <span>{item.label}</span>
                        <span className="text-muted-foreground ml-1.5">{item.description}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="shrink-0 text-muted-foreground">{item.icon}</div>
                      <div className="flex-1 min-w-0 truncate">{item.label}</div>
                      {item.active && <Check className="shrink-0" />}
                    </>
                  )}
                </div>
              )
            })}
          </React.Fragment>
        ))}
      </div>
      {/* Always-visible footer hint for @ mentions */}
      <div className={MENU_SEPARATOR} />
      <div className={cn(MENU_LABEL, 'select-none font-normal')}>
        {t('commands.mentionHint')}
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

export interface UseInlineSlashCommandOptions {
  /** Ref to input element (textarea or RichTextInput handle) */
  inputRef: React.RefObject<SlashCommandInputElement | null>
  /** The commands on offer, already grouped and translated. */
  sections: SlashSection[]
}

export interface UseInlineSlashCommandReturn {
  isOpen: boolean
  filter: string
  position: { x: number; y: number }
  handleInputChange: (value: string, cursorPosition: number) => void
  close: () => void
  /** Close the menu and return the text without the typed `/command`. */
  removeTrigger: () => string
}

export function useInlineSlashCommand({
  inputRef,
  sections,
}: UseInlineSlashCommandOptions): UseInlineSlashCommandReturn {
  const [isOpen, setIsOpen] = React.useState(false)
  const [filter, setFilter] = React.useState('')
  const [position, setPosition] = React.useState({ x: 0, y: 0 })
  const [slashStart, setSlashStart] = React.useState(-1)
  // Store current input state for handleSelect
  const currentInputRef = React.useRef({ value: '', cursorPosition: 0 })

  const handleInputChange = React.useCallback((value: string, cursorPosition: number) => {
    // Store current state for handleSelect
    currentInputRef.current = { value, cursorPosition }

    const textBeforeCursor = value.slice(0, cursorPosition)
    const slashMatch = textBeforeCursor.match(/(?:^|\s)\/(\w*)$/)

    if (slashMatch) {
      const filterText = slashMatch[1] || ''
      // Only open with results, so Enter works normally when nothing matches
      if (!filterSections(sections, filterText).some(s => s.items.length > 0)) {
        setIsOpen(false)
        setFilter('')
        setSlashStart(-1)
        return
      }

      setSlashStart(textBeforeCursor.lastIndexOf('/'))
      setFilter(filterText)

      if (inputRef.current) {
        // Try to get actual caret position from the input element
        const caretRect = inputRef.current.getCaretRect?.()

        if (caretRect && caretRect.x > 0) {
          setPosition({ x: caretRect.x, y: caretRect.y })
        } else {
          // Fallback: position at input element's left edge
          const rect = inputRef.current.getBoundingClientRect()
          const lineHeight = 20
          const linesBeforeCursor = textBeforeCursor.split('\n').length - 1
          setPosition({ x: rect.left, y: rect.top + (linesBeforeCursor + 1) * lineHeight })
        }
      }

      setIsOpen(true)
    } else {
      setIsOpen(false)
      setFilter('')
      setSlashStart(-1)
    }
  }, [inputRef, sections])

  const removeTrigger = React.useCallback((): string => {
    const { value, cursorPosition } = currentInputRef.current
    setIsOpen(false)
    if (slashStart < 0) return value
    return (value.slice(0, slashStart) + value.slice(cursorPosition)).trim()
  }, [slashStart])

  const close = React.useCallback(() => {
    setIsOpen(false)
    setFilter('')
    setSlashStart(-1)
  }, [])

  return {
    isOpen,
    filter,
    position,
    handleInputChange,
    close,
    removeTrigger,
  }
}
