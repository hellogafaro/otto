/**
 * HeaderIconButton
 *
 * The icon button of a page header and of a list's section header: a 28px
 * ghost button (the design system's `icon-compact`), with an optional tooltip.
 */

import * as React from 'react'
import { Button } from '@workspace/ui/components/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '@otto/ui'
import { cn } from '@/lib/utils'

interface HeaderIconButtonProps extends Omit<React.ComponentProps<typeof Button>, 'children'> {
  /** Icon as React element - caller controls size/styling */
  icon: React.ReactNode
  /** Optional tooltip text */
  tooltip?: string
}

export function HeaderIconButton({ icon, tooltip, className, ...props }: HeaderIconButtonProps) {
  const button = (
    <Button
      variant="ghost"
      size="icon-compact"
      aria-label={props['aria-label'] ?? tooltip}
      className={cn('titlebar-no-drag', className)}
      {...props}
    >
      {icon}
    </Button>
  )

  if (tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    )
  }

  return button
}
