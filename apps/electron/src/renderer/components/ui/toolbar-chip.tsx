import * as React from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface ToolbarChipProps extends Omit<React.ComponentProps<typeof Button>, 'variant' | 'size'> {
  /** `icon-compact` is the same chip with only an icon (a 28px square). */
  size?: 'default' | 'icon' | 'compact' | 'icon-compact'
  /** Any CSS color (`var(--info)`, an entity color): tints the chip 10%, hover 15%, open 20%. */
  tint?: string
  /** Controlled open state for chips that are not a Radix trigger (it sets `aria-expanded` itself). */
  open?: boolean
}

/** The one 28px chip of the composer and its toolbars: a ghost compact button with an optional tint. */
export function ToolbarChip({ tint, open, size = 'compact', className, style, ...props }: ToolbarChipProps) {
  return (
    <Button
      variant="ghost"
      size={size}
      data-size={size}
      data-popup-open={open || undefined}
      style={tint ? ({ ...style, '--chip-tint': tint } as React.CSSProperties) : style}
      className={cn(
        'shrink-0',
        tint &&
          'bg-(--chip-tint)/10 hover:bg-(--chip-tint)/15 active:bg-(--chip-tint)/20 aria-expanded:bg-(--chip-tint)/20 data-popup-open:bg-(--chip-tint)/20',
        className,
      )}
      {...props}
    />
  )
}
