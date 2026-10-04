import { cn } from "cn";

// Otto: xs (4px) corners and 11px text, a step under the 12px label beside
// it, so the key reads as a key, not a word. Tooltips are dark like menus, so
// keys keep the menu colors; there they are 16px, leaving 4px around them
// inside the 24px tooltip.
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-xs bg-muted px-1 font-sans text-[0.6875rem] font-medium text-muted-foreground select-none in-data-[slot=tooltip-content]:h-4 in-data-[slot=tooltip-content]:min-w-4 [&_svg:not([class*='size-'])]:size-3",
        className,
      )}
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
