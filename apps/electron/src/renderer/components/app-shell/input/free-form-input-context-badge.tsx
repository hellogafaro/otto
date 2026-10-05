import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@otto/ui'
import { FadingText } from '@/components/ui/fading-text'
import { ToolbarChip } from '@/components/ui/toolbar-chip'
import { cn } from '@/lib/utils'

export interface FreeFormInputContextBadgeProps {
  /** Left area - fully customizable (icon, avatar stack, etc.) */
  icon: React.ReactNode
  /** Label text - shown in expanded state or collapsed with selection */
  label: string
  /** Whether to show expanded state (icon + label + chevron) vs collapsed */
  isExpanded?: boolean
  /** Whether there's an active selection (affects collapsed state styling and shows label) */
  hasSelection?: boolean
  /** Show chevron indicator (for dropdowns) - only visible in expanded state */
  showChevron?: boolean
  /** Click handler */
  onClick?: () => void
  /** Tooltip content - can be string or ReactNode for rich content */
  tooltip?: React.ReactNode
  /** Whether the badge is currently "open" (e.g., dropdown is shown) */
  isOpen?: boolean
  /** Whether the badge is disabled */
  disabled?: boolean
  /** Additional className for the button */
  className?: string
  /** Ref forwarding for positioning dropdowns */
  buttonRef?: React.RefObject<HTMLButtonElement | null>
  /** Data attribute for tutorials */
  'data-tutorial'?: string
}

/**
 * FreeFormInputContextBadge - Unified context badge for Sources, Files, and Folder selectors
 *
 * Visual States:
 * - Expanded: Icon + Label + Chevron
 * - Collapsed (no selection): Icon only
 * - Collapsed (has selection): Icon + Label (fading)
 * It is a ToolbarChip: hover, open and keyboard focus states come from the ghost button.
 */
export const FreeFormInputContextBadge = React.forwardRef<HTMLButtonElement, FreeFormInputContextBadgeProps>(
  function FreeFormInputContextBadge(
    {
      icon,
      label,
      isExpanded = false,
      hasSelection = false,
      showChevron = false,
      onClick,
      tooltip,
      isOpen = false,
      disabled = false,
      className,
      buttonRef,
      'data-tutorial': dataTutorial,
    },
    ref
  ) {
    // Merge refs if both are provided
    const mergedRef = buttonRef || ref

    // Show label in expanded state OR in collapsed state with selection
    const showLabel = isExpanded || hasSelection

    const button = (
      <ToolbarChip
        ref={mergedRef as React.Ref<HTMLButtonElement>}
        type="button"
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        open={isOpen}
        size={showLabel ? 'compact' : 'icon-compact'}
        data-tutorial={dataTutorial}
        className={cn(
          // shrink + min-w-0 lets the chip compress in tight layouts
          "input-toolbar-btn shrink min-w-0",
          showLabel && "text-foreground",
          className
        )}
      >
        {/* Icon area */}
        <span data-icon="inline-start" className="shrink-0 flex items-center">
          {icon}
        </span>

        {/* Label - in expanded state or collapsed with selection */}
        {showLabel && (
          isExpanded ? (
            // Expanded: simple truncate, placeholder (no selection) gets 60% opacity
            <span className={cn("truncate max-w-[120px] min-w-0 shrink", !hasSelection && "opacity-50")}>
              {label}
            </span>
          ) : (
            // Collapsed with selection: fading text with max width
            <FadingText className="max-w-[140px] min-w-0 shrink" fadeWidth={20}>
              {label}
            </FadingText>
          )
        )}

        {/* Optional chevron - only in expanded state */}
        {isExpanded && showChevron && (
          <ChevronDown className="size-3 opacity-50 shrink-0" />
        )}
      </ToolbarChip>
    )

    // Wrap with tooltip if provided (skip when dropdown is open to avoid showing tooltip)
    if (tooltip && !isOpen) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            {button}
          </TooltipTrigger>
          <TooltipContent side="top">
            {tooltip}
          </TooltipContent>
        </Tooltip>
      )
    }

    return button
  }
)
