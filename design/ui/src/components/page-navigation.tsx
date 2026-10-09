import { Button } from "@workspace/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "cn"
import { ArrowLeftIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react"
import * as React from "react"

// Otto: parent-route Back and previous/next item controls sit directly at the
// panel corners. Their optional shortcut content belongs in the shared tooltip.
type NavAction = {
  label: string
  onClick: () => void
  disabled?: boolean
  /** The tooltip's content: the label and its `Kbd`. Defaults to the label. */
  tooltip?: React.ReactNode
}

function PageNavigationButtons({
  back,
  previous,
  next,
  className,
}: {
  back?: NavAction
  previous?: NavAction
  next?: NavAction
  className?: string
}) {
  const items = [
    back && { action: back, icon: <ArrowLeftIcon /> },
    previous && { action: previous, icon: <ChevronUpIcon /> },
    next && { action: next, icon: <ChevronDownIcon /> },
  ].filter((item) => !!item)
  if (items.length === 0) return null
  return (
    <div
      data-slot="page-navigation-buttons"
      className={cn("flex items-center gap-1", className)}
    >
      {items.map(({ action, icon }) => (
        <Tooltip key={action.label}>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label={action.label}
                disabled={action.disabled}
                onClick={action.onClick}
              >
                {icon}
              </Button>
            }
          />
          <TooltipContent side="bottom">
            {action.tooltip ?? action.label}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}

export { PageNavigationButtons, type NavAction }
