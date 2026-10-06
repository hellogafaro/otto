import * as React from "react"
import { cn } from "cn"

// Otto: no focus ring or border change; the caret shows focus; invalid is the
// Input's (red border, destructive/10 fill; /50 and /20 in dark).
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full resize-none rounded-md border border-transparent bg-input/50 px-3 py-3 text-base transition-[color,box-shadow,background-color] outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:bg-destructive/10 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:bg-destructive/20",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
