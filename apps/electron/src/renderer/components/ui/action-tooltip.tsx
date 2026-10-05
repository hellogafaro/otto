import { Kbd } from './kbd'
import { useActionLabel } from '@/actions'
import { Tooltip, TooltipTrigger, TooltipContent } from '@otto/ui'
import type { ActionId } from '@/actions/definitions'

interface ActionTooltipProps {
  action: ActionId
  children: React.ReactNode
}

export function ActionTooltip({ action, children }: ActionTooltipProps) {
  const { label, hotkey } = useActionLabel(action)

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>
        {label}
        {hotkey && <Kbd className="ml-2">{hotkey}</Kbd>}
      </TooltipContent>
    </Tooltip>
  )
}
