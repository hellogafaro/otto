import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

/** The product wordmark used in the primary roster and every secondary surface. */
export function OttoWordmark({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 truncate text-xl leading-none tracking-tight font-medium",
        className,
      )}
      {...props}
    >
      <span aria-hidden="true" className="otto-wordmark-symbol inline-block shrink-0 bg-current" />
      <span>Otto</span>
    </span>
  );
}
