import { cn } from "cn";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // Otto: radius-xs (4px): the 8px md radius turns 12 to 20px placeholders into pills.
      className={cn("animate-pulse rounded-xs bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
