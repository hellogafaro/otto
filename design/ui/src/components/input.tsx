import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "cn"

// Otto: no focus ring or border change; the caret shows focus; invalid is a red
// border and a destructive/10 fill (/50 and /20 in dark). 32px, and nested in a row's actions (settings) 28px with 6px
// corners like the compact buttons beside it.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-md border border-transparent bg-input/50 px-3 py-1 text-base transition-[color,box-shadow,background-color] outline-none in-data-[slot=item-actions]:h-7 in-data-[slot=item-actions]:rounded-sm in-data-[slot=item-actions]:px-2.5 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:bg-destructive/10 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:bg-destructive/20",
        className
      )}
      {...props}
    />
  )
}

export { Input }
