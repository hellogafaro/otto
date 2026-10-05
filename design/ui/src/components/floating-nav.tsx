import { Button } from "@workspace/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "cn"
import { ArrowLeftIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react"
import * as React from "react"

// Otto: Superhuman's detail controls, floating in the card's left margin: a
// round Back button and, under it, a vertical pill with previous (up) and next
// (down). Card-colored with the hairline ring and `shadow-sm`; 32px wide, 14px
// icons; round on purpose (they float free of the rows and bars, which are
// never round). Place it inside a `ContentCard` (the card is its container):
// it is absolutely positioned 56px from the top, 56px left of the 768px
// content column, so it floats beside the column without taking any width. It
// shows only while the card is at least 896px wide; narrower, it hides and the
// same actions move into the header (`FloatingNavButtons` for previous / next
// in its trailing actions, Back in its leading slot).
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
  className,
}: {
  action: NavAction
  icon: React.ReactNode
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={action.label}
            disabled={action.disabled}
            onClick={action.onClick}
            className={cn("rounded-full", className)}
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
      className={cn(
        "absolute top-14 left-[max(0.75rem,calc(50%-24rem-3.5rem))] z-10 hidden flex-col gap-2",
        "@[896px]/panel:flex",
        className
      )}
    >
      {back && (
        <div className="rounded-full bg-card shadow-sm ring-1 ring-foreground/10">
          <NavButton action={back} icon={<ArrowLeftIcon />} />
        </div>
      )}
      {(previous || next) && (
        <div className="flex flex-col rounded-full bg-card shadow-sm ring-1 ring-foreground/10">
          {previous && (
            <NavButton action={previous} icon={<ChevronUpIcon />} />
          )}
          {next && <NavButton action={next} icon={<ChevronDownIcon />} />}
        </div>
      )}
    </nav>
  )
}

// Otto: the narrow card's previous / next: two 28px ghost buttons for the
// header's actions, shown while `FloatingNav` is hidden.
function FloatingNavButtons({
  previous,
  next,
  className,
}: {
  previous?: NavAction
  next?: NavAction
  className?: string
}) {
  if (!previous && !next) return null
  return (
    <div
      data-slot="floating-nav-buttons"
      className={cn("flex items-center gap-1", "@[896px]/panel:hidden", className)}
    >
      {[
        previous && { action: previous, icon: <ChevronUpIcon /> },
        next && { action: next, icon: <ChevronDownIcon /> },
      ]
        .filter((item) => !!item)
        .map(({ action, icon }) => (
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
