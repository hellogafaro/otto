import { Button } from "@workspace/ui/components/button"
import {
  ButtonGroup,
  ButtonGroupSeparator,
} from "@workspace/ui/components/button-group"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "cn"
import { ArrowLeftIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react"
import * as React from "react"

// Otto: Superhuman's detail controls, floating in the left gutter beside the
// column: Back and, under it, Previous (up) and Next (down) as a vertical
// `ButtonGroup` with a separator between them. They are our standard raised
// icon button (`outline`, 32px, md 8 corners, 14px icons), never round and
// with no wrapper of their own, 8px apart. They are the page's only way back and
// through its list: the title row has no back button and no crumbs.
// `PageHeader` portals them into the frame's left gutter, 20px from the column,
// with Back centered on the top axis (`--axis-y`: Back's center, the page
// title's at scroll 0, the chat's pinned title and the sidebar mark's are one
// line), and only while that gutter is at least 72px wide; narrower, the same
// actions move into the title row's trailing actions (`FloatingNavButtons`).
// The gutter never scrolls, so they stay put while the title scrolls away.
type NavAction = {
  label: string
  onClick: () => void
  disabled?: boolean
  /** The tooltip's content: the label and its `Kbd`. Defaults to the label. */
  tooltip?: React.ReactNode
}

function NavButton({
  action,
  icon,
}: {
  action: NavAction
  icon: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="outline"
            size="icon"
            aria-label={action.label}
            disabled={action.disabled}
            onClick={action.onClick}
          >
            {icon}
          </Button>
        }
      />
      <TooltipContent side="right">
        {action.tooltip ?? action.label}
      </TooltipContent>
    </Tooltip>
  )
}

function FloatingNav({
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
  if (!back && !previous && !next) return null
  return (
    <nav
      data-slot="floating-nav"
      className={cn("flex flex-col gap-2", className)}
    >
      {back && <NavButton action={back} icon={<ArrowLeftIcon />} />}
      {(previous || next) && (
        <ButtonGroup orientation="vertical">
          {previous && (
            <NavButton action={previous} icon={<ChevronUpIcon />} />
          )}
          {previous && next && (
            <ButtonGroupSeparator orientation="horizontal" />
          )}
          {next && <NavButton action={next} icon={<ChevronDownIcon />} />}
        </ButtonGroup>
      )}
    </nav>
  )
}

// Otto: the narrow frame's navigation: Back, previous and next as 28px ghost
// buttons for the title row's trailing actions (never leading, never beside the
// title), shown while `FloatingNav` is hidden.
function FloatingNavButtons({
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
      data-slot="floating-nav-buttons"
      className={cn("flex items-center gap-1", className)}
    >
      {items.map(({ action, icon }) => (
        <Tooltip key={action.label}>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-compact"
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

export { FloatingNav, FloatingNavButtons, type NavAction }
