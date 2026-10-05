import * as React from "react"
import type { VariantProps } from "class-variance-authority"
import { Button as DsButton, buttonVariants as dsButtonVariants } from "@workspace/ui/components/button"
import { asChildProps } from "./as-child"

type DsVariants = VariantProps<typeof dsButtonVariants>

type ButtonSize = DsVariants["size"]
type ButtonVariant = DsVariants["variant"]

/** Class names for a button, for call sites that style non-button elements (calendar). */
function buttonVariants({
  variant,
  size,
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return dsButtonVariants({ variant, size, className })
}

type ButtonProps = Omit<React.ComponentProps<typeof DsButton>, "size" | "variant"> & {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Render the single child element instead of a `<button>` (Radix `asChild`). */
  asChild?: boolean
}

function Button({ variant, size, nativeButton, ...props }: ButtonProps) {
  const rest = asChildProps(props)
  // Base UI warns when a non-button element is rendered as a native button.
  const tag = React.isValidElement(rest.render) ? rest.render.type : "button"
  return (
    <DsButton
      {...rest}
      variant={variant}
      size={size}
      nativeButton={nativeButton ?? tag === "button"}
    />
  )
}

export { Button, buttonVariants }
export type { ButtonProps }
