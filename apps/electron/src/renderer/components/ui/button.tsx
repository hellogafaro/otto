import * as React from "react"
import type { VariantProps } from "class-variance-authority"
import { Button as DsButton, buttonVariants as dsButtonVariants } from "@workspace/ui/components/button"
import { asChildProps } from "./as-child"

type DsVariants = VariantProps<typeof dsButtonVariants>

// Craft's sizes by pixel height, mapped onto the design system's:
// default 32 -> sm, sm 28 -> compact, xs 24 -> xs, lg 36 -> default, icon 32 -> icon-sm.
const SIZE_MAP = {
  default: "sm",
  sm: "compact",
  xs: "xs",
  lg: "default",
  icon: "icon-sm",
} as const

type OttoSize = keyof typeof SIZE_MAP
type ButtonSize = OttoSize | NonNullable<DsVariants["size"]> | null
type ButtonVariant = DsVariants["variant"]

function resolveSize(size: ButtonSize | undefined): DsVariants["size"] {
  if (size == null) return SIZE_MAP.default
  return size in SIZE_MAP ? SIZE_MAP[size as OttoSize] : (size as DsVariants["size"])
}

/** Class names for a button, for call sites that style non-button elements (calendar). */
function buttonVariants({
  variant,
  size,
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return dsButtonVariants({ variant, size: resolveSize(size), className })
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
      size={resolveSize(size)}
      nativeButton={nativeButton ?? tag === "button"}
    />
  )
}

export { Button, buttonVariants }
export type { ButtonProps }
