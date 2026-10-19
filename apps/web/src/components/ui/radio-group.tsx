"use client";

import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { useId, type ReactNode } from "react";

import { cn } from "~/lib/utils";

function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props) {
  return (
    <RadioGroupPrimitive
      className={cn("flex flex-col gap-3", className)}
      data-slot="radio-group"
      {...props}
    />
  );
}

function Radio({ className, ...props }: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      className={cn(
        "relative inline-flex size-4.5 shrink-0 items-center justify-center rounded-full border border-transparent bg-input outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background aria-invalid:ring-2 aria-invalid:ring-destructive/40 focus-visible:aria-invalid:ring-destructive/48 data-disabled:cursor-not-allowed data-disabled:opacity-64 sm:size-4",
        className,
      )}
      data-slot="radio"
      {...props}
    >
      <RadioPrimitive.Indicator
        className="-inset-px absolute flex size-4.5 items-center justify-center rounded-full before:size-2 before:rounded-full before:bg-message-action-foreground data-unchecked:hidden data-checked:bg-message-action sm:size-4 sm:before:size-1.5"
        data-slot="radio-indicator"
      />
    </RadioPrimitive.Root>
  );
}

/** A selectable card: title and description on the left, the radio on the right. */
function RadioCard({
  className,
  description,
  id,
  title,
  ...props
}: RadioPrimitive.Root.Props & {
  title: ReactNode;
  description?: ReactNode;
}) {
  const generatedId = useId();
  const controlId = id ?? generatedId;

  return (
    <label
      htmlFor={controlId}
      data-slot="radio-card"
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 rounded-(--control-radius) bg-secondary px-3 py-2.5 inset-ring inset-ring-control-border transition-shadow has-focus-visible:ring-2 has-focus-visible:ring-ring has-data-checked:bg-message-action/8 has-data-checked:inset-ring-message-action has-data-disabled:cursor-not-allowed has-data-disabled:opacity-64",
        className,
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        {description ? (
          <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
        ) : null}
      </span>
      <Radio id={controlId} {...props} />
    </label>
  );
}

export { RadioGroup, Radio, Radio as RadioGroupItem, RadioCard };
