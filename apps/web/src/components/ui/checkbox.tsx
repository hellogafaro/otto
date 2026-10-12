"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { RiCheckLine, RiSubtractLine } from "@remixicon/react";

import { cn } from "~/lib/utils";

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "relative inline-flex size-4.5 shrink-0 items-center justify-center rounded-[.25rem] border border-transparent bg-input outline-none ring-ring transition-shadow focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-background aria-invalid:ring-2 aria-invalid:ring-destructive/40 focus-visible:aria-invalid:ring-destructive/48 data-disabled:cursor-not-allowed data-disabled:opacity-64 sm:size-4",
        className,
      )}
      data-slot="checkbox"
      {...props}
    >
      <CheckboxPrimitive.Indicator
        className="-inset-px absolute flex items-center justify-center rounded-[.25rem] text-message-action-foreground data-unchecked:hidden data-checked:bg-message-action data-indeterminate:text-foreground"
        data-slot="checkbox-indicator"
        render={(props, state) => (
          <span {...props}>
            {state.indeterminate ? (
              <RiSubtractLine className="size-3.5 sm:size-3" aria-hidden="true" />
            ) : (
              <RiCheckLine className="size-3.5 sm:size-3" aria-hidden="true" />
            )}
          </span>
        )}
      />
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
