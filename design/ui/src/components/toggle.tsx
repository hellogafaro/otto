"use client"

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// Otto: 32px md 8 like every control; sm is the 28px nested control with 6px
// corners; 14px icons. Padding and gap are the Button's (12 / 10px for text,
// less on an icon's side); a lone bare icon is a square (`min-w`, no
// padding); beside text an icon is marked `data-icon="inline-start|inline-end"`.
const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center rounded-md text-sm font-medium whitespace-nowrap transition-colors outline-none hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-pressed:bg-foreground/10 aria-pressed:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-input bg-transparent",
      },
      size: {
        default:
          "h-8 min-w-8 gap-2 px-3 has-[>svg:first-child:not(:last-child),>[data-icon=inline-start]]:pl-2.5 has-[>svg:last-child:not(:first-child),>[data-icon=inline-end]]:pr-2.5 has-[>svg:only-child:not([data-icon])]:px-0",
        sm: "h-7 min-w-7 gap-1.5 rounded-sm px-2.5 has-[>svg:first-child:not(:last-child),>[data-icon=inline-start]]:pl-2 has-[>svg:last-child:not(:first-child),>[data-icon=inline-end]]:pr-2 has-[>svg:only-child:not([data-icon])]:px-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
