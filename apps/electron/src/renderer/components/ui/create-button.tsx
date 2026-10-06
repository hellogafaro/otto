/**
 * CreateButton
 *
 * The one create action of a page, a section, a tab or a group: a ghost "+" icon
 * button whose `aria-label` and tooltip are the label ("New task", "Invite member"),
 * with the action's key as a `Kbd` after it when it has one (DESIGN.md, Header actions).
 * 28px by default (page header, section, tab row); `size="icon-xs"` is the 24px
 * one of a group band and a sidecar section. It is also the trigger of a menu or
 * a picker: `<DropdownMenuTrigger render={<CreateButton label=… />} />`.
 */

import * as React from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'

interface CreateButtonProps extends Omit<React.ComponentProps<typeof Button>, 'children' | 'variant' | 'size'> {
  /** What it creates: the tooltip and the accessible name. */
  label: string
  /** The action's key, shown as a `Kbd` after the label. */
  hotkey?: string
  size?: 'icon-compact' | 'icon-xs'
}

export function CreateButton({ label, hotkey, size = 'icon-compact', className, ...props }: CreateButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <Button variant="ghost" size={size} aria-label={label} className={cn('titlebar-no-drag', className)} {...props}>
            <Plus />
          </Button>
        )}
      />
      <TooltipContent side="bottom">
        {label}
        {hotkey && <Kbd>{hotkey}</Kbd>}
      </TooltipContent>
    </Tooltip>
  )
}
