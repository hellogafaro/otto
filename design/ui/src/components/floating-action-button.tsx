import { Button } from "@workspace/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "cn"

// Otto: the page's one floating action (new chat), bottom-right of the card it
// is placed in (16px from the corner, which sits 8px in). 40px, card-colored,
// `xl` corners (it floats free, like the composer), the hairline ring and
// `shadow-sm`. The tooltip is its label and the action's `Kbd`, to the left.
function FloatingActionButton({
  tooltip,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "variant" | "size"> & {
  tooltip?: React.ReactNode
}) {
  const button = (
    <Button
      variant="ghost"
      size="icon-lg"
      className={cn(
        "absolute right-4 bottom-4 z-10 rounded-xl bg-card text-foreground shadow-sm ring-1 ring-foreground/10 hover:bg-card hover:text-foreground dark:hover:bg-card",
        className
      )}
      {...props}
    >
      {children}
    </Button>
  )

  if (!tooltip) return button

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent side="left">{tooltip}</TooltipContent>
    </Tooltip>
  )
}

export { FloatingActionButton }
