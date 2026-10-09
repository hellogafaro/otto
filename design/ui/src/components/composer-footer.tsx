import type * as React from "react"
import { cn } from "cn"

// Otto: the composer's footer is outside its surface, on the same width.
// Its 28px picker starts the row; the participant group ends it. The frame
// measures this row with the composer, never as a separate floating layer.
function ComposerFooter({
  picker,
  participants,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  picker?: React.ReactNode
  participants?: React.ReactNode
}) {
  return (
    <div
      data-slot="composer-footer"
      className={cn("flex min-h-8 w-full min-w-0 items-center justify-between gap-2 px-4 pt-1 pb-0", className)}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-center">{picker}</div>
      <div className="flex shrink-0 items-center">{participants}</div>
    </div>
  )
}

export { ComposerFooter }
