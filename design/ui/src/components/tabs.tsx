import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cn } from "cn"

// Otto: `size` is the Button's two heights. Tabs on a page are `default` (32px); tabs inside a card,
// dialog or popover are `compact` (28px). The triggers read it from the root (`data-size`).
function Tabs({
  className,
  size = "default",
  ...props
}: TabsPrimitive.Root.Props & { size?: "default" | "compact" }) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-size={size}
      className={cn("group/tabs flex gap-2 data-horizontal:flex-col", className)}
      {...props}
    />
  )
}

// Otto: tabs are buttons (the Button's heights and padding) 4px apart; the open one has the selected
// fill (`foreground/10`), like every selected item.
function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex w-fit items-center gap-1 data-vertical:flex-col data-vertical:items-stretch",
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex h-8 items-center justify-center gap-2 rounded-md border border-transparent px-3 text-sm has-[>svg:first-child:not([data-icon=inline-end]),>[data-icon=inline-start]]:pl-2.5 has-[>svg:last-child:not(:first-child),>[data-icon=inline-end]]:pr-2.5 font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none select-none hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-active:bg-foreground/10 data-active:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 group-data-[size=compact]/tabs:h-7 group-data-[size=compact]/tabs:gap-1.5 group-data-[size=compact]/tabs:rounded-sm group-data-[size=compact]/tabs:px-2.5 group-data-[size=compact]/tabs:has-[>svg:first-child:not([data-icon=inline-end]),>[data-icon=inline-start]]:pl-2 group-data-[size=compact]/tabs:has-[>svg:last-child:not(:first-child),>[data-icon=inline-end]]:pr-2",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
