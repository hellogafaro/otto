/**
 * SettingsRow
 *
 * Generic row component for settings with label on left and content on right.
 * Use for custom layouts that don't fit Toggle/Select patterns.
 */

import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { settingsUI } from './settings-ui-constants'

export interface SettingsRowProps {
  /** Leading icon, before the label */
  icon?: React.ReactNode
  /** Row label (can be string or JSX for custom rendering) */
  label: React.ReactNode
  /** Optional description below label */
  description?: string
  /** Content on the right side */
  children?: React.ReactNode
  /** Click handler for the entire row */
  onClick?: () => void
  /** Optional action button (e.g., "Change" button) */
  action?: React.ReactNode
  /** Additional className */
  className?: string
  /** Whether the row is inside a card (affects padding) */
  inCard?: boolean
  /** Makes the row the header of a collapsible panel: sets aria-expanded and shows a chevron that turns when open */
  expanded?: boolean
}

/**
 * SettingsRow - Generic row for custom settings layouts
 *
 * @example
 * <SettingsRow
 *   label="Working Directory"
 *   description="~/Documents"
 *   action={<Button variant="ghost" size="sm">Change</Button>}
 * />
 */
export function SettingsRow({
  icon,
  label,
  description,
  children,
  onClick,
  action,
  className,
  inCard = true,
  expanded,
}: SettingsRowProps) {
  const Component = onClick ? 'button' : 'div'

  return (
    <Component
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-expanded={expanded}
      data-layout="settings-row"
      className={cn(
        'w-full flex items-center justify-between text-left',
        inCard ? 'px-4 py-3' : 'py-3',
        onClick && 'hover:bg-muted/70 transition-colors cursor-pointer',
        className
      )}
    >
      {/* One 20px slot for every leading icon: Lucide icons are forced to 14px here, brand logos (ProviderLogo) are 14px by default, avatars keep their 20px. */}
      {icon && (
        <span className="mr-3 flex size-5 shrink-0 items-center justify-center [&>svg]:size-3.5">
          {icon}
        </span>
      )}
      <div className="flex-1 min-w-0">
        <div className={settingsUI.label}>{label}</div>
        {description && (
          <div className={cn(settingsUI.description, settingsUI.labelDescriptionGap, 'truncate')}>
            {description}
          </div>
        )}
      </div>
      {(children || action) && (
        <div data-layout="settings-control" data-slot="item-actions" className="flex items-center gap-3 ml-4 shrink-0">
          {children}
          {action}
        </div>
      )}
      {expanded !== undefined && (
        <ChevronRight
          aria-hidden
          className={cn('ml-4 size-3.5 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')}
        />
      )}
    </Component>
  )
}

/**
 * SettingsRowLabel - Standalone label for use outside SettingsRow
 *
 * @example
 * <SettingsRowLabel label="Theme" />
 * <SettingsSegmentedControl ... />
 */
export function SettingsRowLabel({
  label,
  description,
  className,
}: {
  label: string
  description?: string
  className?: string
}) {
  return (
    <div className={cn(settingsUI.labelGroup, className)}>
      <div className={settingsUI.label}>{label}</div>
      {description && (
        <div className={cn(settingsUI.description, settingsUI.labelDescriptionGap)}>{description}</div>
      )}
    </div>
  )
}
