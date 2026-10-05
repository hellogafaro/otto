import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cn } from "cn"

// Otto: the grid, for navigation hubs (the Settings index): `PageGrid` is the
// responsive grid and `GridCard` its item, the standard card with its icon and
// its title INSIDE. Columns follow the page column's width (`@container/panel`):
// three from 640px, two from 400px, one below. Cards in a row are equal height.
function PageGrid({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="page-grid"
      className={cn(
        "grid grid-cols-1 gap-3 @[25rem]/panel:grid-cols-2 @[40rem]/panel:grid-cols-3",
        className
      )}
      {...props}
    />
  )
}

// Otto: the card surface (`card-surface`, `bg-card`, `xl` 12) with 16px padding:
// the page's 14px icon in a 32px `md` tile (`bg-muted`) at the top left, 12px
// above the title (`text-sm`, medium). The whole card is the link or button
// (`render`); hover steps the fill to `muted` at 40%, focus draws the ring
// inside. No description unless the page has one.
function GridCard({
  icon,
  title,
  render,
  className,
  ...props
}: Omit<useRender.ComponentProps<"button">, "title"> &
  Omit<React.ComponentProps<"button">, "title"> & {
    icon: React.ReactNode
    title: React.ReactNode
  }) {
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        className: cn(
          "group/grid-card flex flex-col items-start gap-3 card-surface rounded-xl bg-card p-4 text-left text-card-foreground outline-hidden transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
          className
        ),
        children: (
          <>
            <span className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover/grid-card:text-foreground [&>svg]:size-3.5">
              {icon}
            </span>
            <span className="text-sm font-medium">{title}</span>
          </>
        ),
      },
      props
    ),
    render,
    state: { slot: "grid-card" },
  })
}

export { GridCard, PageGrid }
