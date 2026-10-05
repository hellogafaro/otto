/**
 * SettingsMenuSelect
 *
 * Menu-style dropdown select with support for option descriptions.
 * Uses Radix Popover for collision detection and accessibility.
 * Includes search/filter when options exceed threshold.
 */

import * as React from 'react'
import { useTranslation } from "react-i18next"
import { Check, ChevronDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { settingsUI } from './SettingsUIConstants'

export interface SettingsMenuSelectOption {
  /** Value for this option */
  value: string
  /** Display label */
  label: string
  /** Optional description/subtitle */
  description?: string
}

export interface SettingsMenuSelectProps {
  /** Currently selected value */
  value: string
  /** Change handler */
  onValueChange: (value: string) => void
  /** Available options */
  options: SettingsMenuSelectOption[]
  /** Placeholder when nothing selected */
  placeholder?: string
  /** Disabled state */
  disabled?: boolean
  /** Additional className for trigger */
  className?: string
  /** Width of the dropdown menu */
  menuWidth?: number
  /** Called when hovering over an option (for live preview). Pass null on leave. */
  onHover?: (value: string | null) => void
  /** Enable search filter (auto-enabled when options > 8) */
  searchable?: boolean
  /** Placeholder for search input */
  searchPlaceholder?: string
}

/**
 * SettingsMenuSelect - Menu-style dropdown with descriptions
 *
 * Uses Radix Popover for automatic collision detection and positioning.
 * Trigger styled like the model selector in FreeFormInput.
 * Includes search filter when options exceed 8 or searchable prop is true.
 */
export function SettingsMenuSelect({
  value,
  onValueChange,
  options,
  placeholder = 'Select...',
  disabled,
  className,
  menuWidth = 280,
  onHover,
  searchable,
  searchPlaceholder,
}: SettingsMenuSelectProps) {
  const { t } = useTranslation()
  const effectiveSearchPlaceholder = searchPlaceholder ?? t("common.search")
  const [isOpen, setIsOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')
  const searchInputRef = React.useRef<HTMLInputElement>(null)

  const selectedOption = options.find((o) => o.value === value)

  // Show search when explicitly enabled or when there are many options
  const showSearch = searchable ?? options.length > 8

  // Filter options based on search query
  const filteredOptions = React.useMemo(() => {
    if (!searchQuery.trim()) return options
    const query = searchQuery.toLowerCase()
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(query) ||
        option.value.toLowerCase().includes(query) ||
        option.description?.toLowerCase().includes(query)
    )
  }, [options, searchQuery])

  const handleSelect = (optionValue: string) => {
    onValueChange(optionValue)
    setIsOpen(false)
    setSearchQuery('')
    // Clear preview on selection since the actual value is now set
    onHover?.(null)
  }

  // Clear preview when popover closes (via click outside, escape, etc.)
  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (!open) {
      onHover?.(null)
      setSearchQuery('')
    } else if (showSearch) {
      // Focus search input when opening
      setTimeout(() => searchInputRef.current?.focus(), 0)
    }
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            // Solid like an input: the same fill, no border; 28px, 6px corners when nested
            'inline-flex h-7 items-center gap-1 rounded-sm bg-input/50 px-2 text-sm',
            'transition-colors hover:bg-input/70',
            'disabled:cursor-not-allowed disabled:opacity-50',
            isOpen && 'bg-input/70',
            className
          )}
        >
          <span className="truncate">{selectedOption?.label || placeholder}</span>
          <ChevronDown className="opacity-50 shrink-0 size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={4}
        collisionPadding={8}
        className="gap-0! p-0"
        style={{ width: menuWidth }}
        onMouseLeave={() => onHover?.(null)}
      >
        {/* Search docked at the top: icon on the item icon column, a transparent
            36px input over a full-width bottom border (like the command palette) */}
        {showSearch && (
          <div className="relative border-b border-border">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={effectiveSearchPlaceholder}
              className="h-9 w-full bg-transparent pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        )}
        <div className="max-h-64 space-y-0.5 overflow-auto p-1">
          {filteredOptions.length === 0 ? (
            <div className="px-2 py-3 text-center text-sm text-muted-foreground">
              No results found
            </div>
          ) : (
            filteredOptions.map((option) => {
              const isSelected = value === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleSelect(option.value)}
                  onMouseEnter={() => onHover?.(option.value)}
                  className={cn(
                    'flex h-7 w-full items-center justify-between gap-3 rounded-sm px-2 text-left text-sm',
                    'transition-colors hover:bg-foreground/5',
                    isSelected && 'bg-foreground/5'
                  )}
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                  {isSelected && <Check className="size-3.5 shrink-0" />}
                </button>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * SettingsMenuSelectRow - Inline row with label and menu select
 */
export interface SettingsMenuSelectRowProps {
  /** Row label */
  label: string
  /** Optional description below label */
  description?: string
  /** Currently selected value */
  value: string
  /** Change handler */
  onValueChange: (value: string) => void
  /** Available options */
  options: SettingsMenuSelectOption[]
  /** Placeholder text */
  placeholder?: string
  /** Disabled state */
  disabled?: boolean
  /** Additional className */
  className?: string
  /** Whether inside a card */
  inCard?: boolean
  /** Width of the dropdown menu */
  menuWidth?: number
  /** Called when hovering over an option (for live preview). Pass null on leave. */
  onHover?: (value: string | null) => void
  /** Enable search filter (auto-enabled when options > 8) */
  searchable?: boolean
  /** Placeholder for search input */
  searchPlaceholder?: string
}

export function SettingsMenuSelectRow({
  label,
  description,
  value,
  onValueChange,
  options,
  placeholder = 'Select...',
  disabled,
  className,
  inCard = true,
  menuWidth = 280,
  onHover,
  searchable,
  searchPlaceholder,
}: SettingsMenuSelectRowProps) {
  return (
    <div
      data-layout="settings-row"
      className={cn(
        'flex items-center justify-between',
        inCard ? 'px-4 py-3.5' : 'py-3',
        className
      )}
    >
      <div className="flex-1 min-w-0">
        <div className={settingsUI.label}>{label}</div>
        {description && (
          <p className={cn(settingsUI.description, settingsUI.labelDescriptionGap)}>{description}</p>
        )}
      </div>
      <div data-layout="settings-control" className="ml-4 shrink-0">
        <SettingsMenuSelect
          value={value}
          onValueChange={onValueChange}
          options={options}
          placeholder={placeholder}
          disabled={disabled}
          menuWidth={menuWidth}
          onHover={onHover}
          searchable={searchable}
          searchPlaceholder={searchPlaceholder}
        />
      </div>
    </div>
  )
}
