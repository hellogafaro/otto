/**
 * SettingsCard
 *
 * Container card for grouping related settings. Rows are split by full-bleed
 * hairlines drawn by `divide-y` between the children that exist in the DOM, so
 * a child that renders nothing (a collapsed panel) leaves no stray line.
 */

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface SettingsCardProps {
  /** Card content */
  children: React.ReactNode
  /** Additional className */
  className?: string
}

/**
 * SettingsCard - Container for grouping related settings
 *
 * @example
 * <SettingsCard>
 *   <SettingsToggle label="Option 1" ... />
 *   <SettingsToggle label="Option 2" ... />
 * </SettingsCard>
 */
export function SettingsCard({ children, className }: SettingsCardProps) {
  return (
    <div
      className={cn(
        'rounded-xl bg-card ring-1 ring-foreground/10 shadow-xs overflow-hidden divide-y divide-foreground/10',
        className
      )}
    >
      {children}
    </div>
  )
}

/**
 * SettingsCardContent - Inner padding wrapper for card content
 *
 * Use when you need custom content inside a SettingsCard
 */
export function SettingsCardContent({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <div className={cn('px-4 py-3.5', className)}>{children}</div>
}

/**
 * SettingsCardFooter - Footer section with actions
 */
export function SettingsCardFooter({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'px-4 py-3 border-t border-border/50 bg-muted/30 flex items-center justify-end gap-2',
        className
      )}
    >
      {children}
    </div>
  )
}
