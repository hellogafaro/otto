import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * IconTile - the leading icon of a row with two lines of text (label and description): a 32px
 * `rounded-md` tile on the `muted` fill holding a 16px glyph. Lucide icons and brand logos are
 * forced to 16px; an avatar (`data-slot="avatar"`) fills the tile. Single-line rows keep a bare
 * 14px glyph in a 20px slot instead.
 */
export function IconTile({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted [&>*]:size-4! [&>[data-slot=avatar]]:size-full!",
        className
      )}
      {...props}
    />
  )
}
