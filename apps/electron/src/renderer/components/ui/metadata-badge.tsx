import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ToolbarChip, type ToolbarChipProps } from './toolbar-chip'

export interface MetadataBadgeProps extends Omit<ToolbarChipProps, 'tint' | 'value'> {
  /** Primary label text */
  label: string
  /** Optional secondary value text */
  value?: string
  /** When set, the value text renders as a clickable link and calls this on click.
   *  The handler stops propagation so the chip's surrounding popover/trigger doesn't toggle. */
  onValueClick?: (e: React.MouseEvent) => void
  /** Optional leading icon */
  icon?: React.ReactNode
  /** Optional trailing hint icon when no value is set */
  valueHintIcon?: React.ReactNode
  /** Tint color of the chip; none leaves it neutral */
  badgeColor?: string
  /** Show dropdown chevron on the right */
  showChevron?: boolean
}

export function MetadataBadge({
  label,
  value,
  onValueClick,
  icon,
  valueHintIcon,
  badgeColor,
  showChevron = false,
  type = 'button',
  className,
  ...chipProps
}: MetadataBadgeProps) {
  return (
    <ToolbarChip
      type={type}
      tint={badgeColor}
      className={cn(badgeColor && 'text-[color-mix(in_srgb,var(--foreground)_80%,var(--chip-tint))]', className)}
      {...chipProps}
    >
      {icon}

      <span className="whitespace-nowrap">{label}</span>

      {value ? (
        <>
          <span className="opacity-30">·</span>
          <span
            className={cn(
              'whitespace-nowrap max-w-[140px] truncate',
              onValueClick
                ? 'opacity-80 cursor-pointer hover:underline underline-offset-2'
                : 'opacity-60'
            )}
            title={onValueClick ? value : undefined}
            onClick={onValueClick ? (e) => { e.stopPropagation(); onValueClick(e) } : undefined}
          >
            {value}
          </span>
        </>
      ) : (
        valueHintIcon && (
          <>
            <span className="opacity-30">·</span>
            {valueHintIcon}
          </>
        )
      )}

      {showChevron && <ChevronDown className="size-3 opacity-40 shrink-0" />}
    </ToolbarChip>
  )
}
