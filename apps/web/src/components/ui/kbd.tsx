import type * as React from "react";

import { cn } from "~/lib/utils";

function Kbd({
  className,
  variant,
  ...props
}: React.ComponentProps<"kbd"> & { variant?: "shortcut" | "jump" | "inline" }) {
  return (
    <kbd
      className={cn(
        "pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center gap-1 rounded bg-muted px-1 font-medium font-sans text-muted-foreground text-xs [&_svg:not([class*='size-'])]:size-3",
        variant === "shortcut" &&
          "h-5.5 min-w-5.5 rounded-[5px] border border-border/80 bg-background px-1.5 text-[11px] text-foreground shadow-xs/5",
        variant === "jump" && "rounded-sm px-1.5 text-10px",
        // Otto: A shortcut inside a button reads as its quieter trailing text, in any button color.
        variant === "inline" && "h-auto min-w-0 bg-transparent px-0 text-current opacity-64",
        className,
      )}
      data-slot="kbd"
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn("inline-flex items-center gap-1", className)}
      data-slot="kbd-group"
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
