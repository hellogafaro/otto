import { cn } from "cn"

// Otto: a count right after its label, softer than it ("Todo 3"). Same size as
// the label, regular weight, tabular; it takes the parent's gap (the
// icon-to-label gap), so the spacing stays proportional. A zero is not drawn by
// the caller: an empty group or section does not show.
function Count({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="count"
      className={cn(
        "font-normal text-muted-foreground/70 tabular-nums",
        className
      )}
      {...props}
    />
  )
}

export { Count }
