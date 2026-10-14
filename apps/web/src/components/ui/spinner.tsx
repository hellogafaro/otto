import { RiLoaderLine } from "@remixicon/react";

import { cn } from "~/lib/utils";

function Spinner({ className, ...props }: React.ComponentProps<typeof RiLoaderLine>) {
  return (
    <RiLoaderLine
      aria-label="Loading"
      className={cn("animate-spin", className)}
      role="status"
      {...props}
    />
  );
}

export { Spinner };
