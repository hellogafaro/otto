"use client";

import { Form as FormPrimitive } from "@base-ui/react/form";

import { cn } from "~/lib/utils";

function Form({
  className,
  spacing = "default",
  ...props
}: FormPrimitive.Props & { spacing?: "default" | "compact" }) {
  return (
    <FormPrimitive
      // Otto: Compact forms follow the shared auth spacing rhythm.
      className={cn("flex w-full flex-col", spacing === "compact" ? "gap-3" : "gap-4", className)}
      data-slot="form"
      {...props}
    />
  );
}

export { Form };
