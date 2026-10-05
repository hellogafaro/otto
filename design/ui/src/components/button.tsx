import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// Otto: ONE state table for every button (DESIGN.md, Buttons). State fills are
// alphas of `foreground`, so they read the same on the frame, on a card and in
// dark: hover 5%, pressed / open / selected 10%. A ring means keyboard focus
// only (inset: rows and bars clip an outer one). Selected is `aria-pressed`,
// `aria-selected`, `aria-checked`, `aria-current`, `data-active`,
// `data-state=on`; open is `aria-expanded` (not `data-popup-open`: a
// tooltip trigger carries it while its tooltip shows). No shadow, no
// weight change, no press offset.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/80 active:bg-primary/70 aria-expanded:bg-primary/80",
        // Otto: the card surface's hairline at rest (flat, no shadow); the fill
        // steps are laid over the card color so they stay lighter than rest in
        // dark too.
        outline:
          "border-(--card-ring) bg-card text-foreground [--step-1:color-mix(in_oklab,var(--card),var(--foreground)_5%)] [--step-2:color-mix(in_oklab,var(--card),var(--foreground)_10%)] hover:bg-(--step-1) active:bg-(--step-2) aria-expanded:bg-(--step-2) aria-pressed:bg-(--step-2) aria-checked:bg-(--step-2) aria-selected:bg-(--step-2) aria-[current=page]:bg-(--step-2) data-active:bg-(--step-2) data-[state=on]:bg-(--step-2)",
        // Otto: a quiet fill; not a selected state.
        secondary:
          "bg-foreground/10 text-foreground hover:bg-foreground/15 active:bg-foreground/20 aria-expanded:bg-foreground/15",
        // Otto: muted at rest; foreground on hover, open, pressed or current.
        ghost:
          "text-muted-foreground hover:bg-foreground/5 hover:text-foreground active:bg-foreground/10 active:text-foreground aria-expanded:bg-foreground/10 aria-expanded:text-foreground aria-pressed:bg-foreground/10 aria-pressed:text-foreground aria-checked:bg-foreground/10 aria-checked:text-foreground aria-selected:bg-foreground/10 aria-selected:text-foreground aria-[current=page]:bg-foreground/10 aria-[current=page]:text-foreground data-active:bg-foreground/10 data-active:text-foreground data-[state=on]:bg-foreground/10 data-[state=on]:text-foreground",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 active:bg-destructive/30 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:active:bg-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // Otto: two heights, 32px (`default`, md 8) and 28px (`compact`, sm 6);
        // 24px (`xs`) for the smallest actions. Horizontal padding follows the
        // content: text gets 12px at 32 (32 x 0.382, 1 / phi squared), 10px at
        // 28 and 8px at 24; an icon beside text takes less on its own side
        // (10 / 8 / 6px) so icon and label balance optically. A leading or
        // `svg` is detected structurally, so no call site sets padding. CSS cannot
        // see text nodes, so a lone `svg` beside bare text counts as the leading
        // icon; a trailing one after bare text, or a wrapper (an avatar stack),
        // is marked `data-icon="inline-end|inline-start"`. The icon-label gap is
        // 8px (6px / 4px at compact / xs). Icon-only buttons use the `icon` sizes. 32px buttons are
        // md 8 (4px inside a 12px card, 8 + 4); 28px and 24px ones sm 6 (never
        // fully round).
        default:
          "h-8 gap-2 px-3 has-[>svg:first-child:not([data-icon=inline-end]),>[data-icon=inline-start]]:pl-2.5 has-[>svg:last-child:not(:first-child),>[data-icon=inline-end]]:pr-2.5",
        compact:
          "h-7 gap-1.5 rounded-sm px-2.5 has-[>svg:first-child:not([data-icon=inline-end]),>[data-icon=inline-start]]:pl-2 has-[>svg:last-child:not(:first-child),>[data-icon=inline-end]]:pr-2 [&_svg:not([class*='size-'])]:size-3.5",
        xs: "h-6 gap-1 rounded-sm px-2 text-xs has-[>svg:first-child:not([data-icon=inline-end]),>[data-icon=inline-start]]:pl-1.5 has-[>svg:last-child:not(:first-child),>[data-icon=inline-end]]:pr-1.5 [&_svg:not([class*='size-'])]:size-3",
        icon: "size-8",
        "icon-compact": "size-7 rounded-sm",
        "icon-xs": "size-6 rounded-sm [&_svg:not([class*='size-'])]:size-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
