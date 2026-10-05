/**
 * Info_Badge
 *
 * Colored badge with optional icon for status indicators.
 * Features rounded-lg (8px) corners and tinted shadow based on color.
 */

import * as React from 'react'
import { cn } from '@/lib/utils'

export type BadgeColor = 'success' | 'warning' | 'destructive' | 'default' | 'muted'

export interface Info_BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Badge color variant */
  color?: BadgeColor
  /** Optional icon (renders before text) */
  icon?: React.ReactNode
  /** Badge text */
  children: React.ReactNode
}

const colorConfig: Record<
  BadgeColor,
  { bg: string; text: string }
> = {
  success: {
    bg: 'bg-[oklch(from_var(--success)_l_c_h_/_0.08)]',
    text: 'text-[var(--success-text)]',
  },
  warning: {
    bg: 'bg-[oklch(from_var(--info)_l_c_h_/_0.08)]',
    text: 'text-[var(--info-text)]',
  },
  destructive: {
    bg: 'bg-[oklch(from_var(--destructive)_l_c_h_/_0.08)]',
    text: 'text-[var(--destructive-text)]',
  },
  default: {
    bg: 'bg-foreground/10',
    text: 'text-foreground/70',
  },
  muted: {
    bg: 'bg-foreground/5',
    text: 'text-foreground/70',
  },
}

export function Info_Badge({
  color = 'default',
  icon,
  children,
  className,
  style,
  ...props
}: Info_BadgeProps) {
  const config = colorConfig[color]

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm pl-2.5 pr-3 py-1 text-xs font-medium',
        config.bg,
        config.text,
        className
      )}
      style={style}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </span>
  )
}
