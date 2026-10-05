import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area"
import { cn } from "cn"

// Otto: a 6px thumb in the hairline color, shown only while hovering or
// scrolling; `viewportRef` reaches the scrolling element.
function ScrollArea({
  className,
  children,
  viewportRef,
  viewportClassName,
  ...props
}: ScrollAreaPrimitive.Root.Props & {
  viewportRef?: ScrollAreaPrimitive.Viewport.Props["ref"]
  viewportClassName?: string
}) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative overflow-hidden", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        data-slot="scroll-area-viewport"
        className={cn(
          "size-full rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          viewportClassName
        )}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "flex touch-none p-px opacity-0 transition-opacity select-none data-hovering:opacity-100 data-scrolling:opacity-100 data-horizontal:h-2 data-horizontal:flex-col data-vertical:w-2",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-border"
      />
    </ScrollAreaPrimitive.Scrollbar>
  )
}

export { ScrollArea, ScrollBar }
