import { RiLoaderLine } from "@remixicon/react";
import { cn } from "cn";

// Otto: typed from the icon component (stock svg props allow children, which
// Remix icons reject).
function Spinner({
  className,
  ...props
}: React.ComponentProps<typeof RiLoaderLine>) {
  return (
    <RiLoaderLine
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
