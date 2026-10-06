"use client"

import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { Button } from "@workspace/ui/components/button"
import { Kbd } from "@workspace/ui/components/kbd"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { useIsMobile } from "@workspace/ui/hooks/use-mobile"
import { useMediaQuery } from "@workspace/ui/hooks/use-media-query"
import { cn } from "cn"
import * as React from "react"
import { MenuIcon } from "lucide-react"

// Otto: the shell's one sidebar, on the frame beside the page card (Threads'
// layout). Widths are px so the root font size never changes them: ONE width
// for every section and page, 256px (also the sheet below 768px; the Chats
// list and the Settings pages both fit), 48px as icons only (10 | 28 | 10). Nothing
// sets `--sidebar-width` per section. There is no manual toggle, cookie or shortcut: the
// sidebar is expanded from 1024px up, icons only below, and below 768px it is a
// sheet opened by the menu button in the page header. A row with
// `aria-disabled` is an area not linked yet: shown, readable, no pointer.
const SIDEBAR_WIDTH = "256px"
const SIDEBAR_WIDTH_ICON = "48px"
const SIDEBAR_EXPANDED_QUERY = "(min-width: 1024px)"

type SidebarContextProps = {
  state: "expanded" | "collapsed"
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  isMobile: boolean
}

const SidebarContext = React.createContext<SidebarContextProps | null>(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.")
  }

  return context
}

function SidebarProvider({
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const isMobile = useIsMobile()
  const expanded = useMediaQuery(SIDEBAR_EXPANDED_QUERY)
  const [openMobile, setOpenMobile] = React.useState(false)

  const state = expanded ? "expanded" : "collapsed"

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({ state, isMobile, openMobile, setOpenMobile }),
    [state, isMobile, openMobile]
  )

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        data-slot="sidebar-wrapper"
        style={
          {
            "--sidebar-width": SIDEBAR_WIDTH,
            "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
            ...style,
          } as React.CSSProperties
        }
        className={cn(
          "group/sidebar-wrapper relative flex h-full min-h-0 w-full bg-sidebar",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

// Otto: absolute inside the shell (not fixed to the viewport, so a banner above
// the shell pushes it down) and no width transition, like every panel here.
// The container's 8px padding is the gutter around the rows and the gap to the
// page card; there is no border or ring against it.
function Sidebar({
  className,
  children,
  dir,
  ...props
}: React.ComponentProps<"div">) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar()

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile} {...props}>
        <SheetContent
          dir={dir}
          data-sidebar="sidebar"
          data-slot="sidebar"
          data-mobile="true"
          initialFocus={false}
          className="bg-sidebar p-2 text-sidebar-foreground data-[side=left]:w-(--sidebar-width) [&>button]:hidden"
          style={
            { "--sidebar-width": SIDEBAR_WIDTH } as React.CSSProperties
          }
          side="left"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Sidebar</SheetTitle>
            <SheetDescription>Displays the mobile sidebar.</SheetDescription>
          </SheetHeader>
          <div className="flex h-full w-full flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <div
      className="group peer hidden text-sidebar-foreground md:block"
      data-state={state}
      data-collapsible={state === "collapsed" ? "icon" : ""}
      data-slot="sidebar"
    >
      <div
        data-slot="sidebar-gap"
        className="relative w-(--sidebar-width) bg-transparent group-data-[collapsible=icon]:w-(--sidebar-width-icon)"
      />
      <div
        data-slot="sidebar-container"
        className={cn(
          "absolute inset-y-0 left-0 z-10 hidden h-full w-(--sidebar-width) p-2 group-data-[collapsible=icon]:w-(--sidebar-width-icon) md:flex",
          className
        )}
        {...props}
      >
        <div
          data-sidebar="sidebar"
          data-slot="sidebar-inner"
          className="flex size-full min-w-0 flex-col bg-sidebar"
        >
          {children}
        </div>
      </div>
    </div>
  )
}

// Otto: the page header's menu button below 768px, where the sidebar is a
// sheet. A 28px ghost button like the header's other controls.
function SidebarTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { setOpenMobile } = useSidebar()

  return (
    <Button
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon-compact"
      className={cn("md:hidden", className)}
      onClick={(event) => {
        onClick?.(event)
        setOpenMobile(true)
      }}
      {...props}
    >
      <MenuIcon />
      <span className="sr-only">Menu</span>
    </Button>
  )
}

// Otto: icons only, the groups are 8px apart and a 16px hairline centered in
// the gap above each one marks the grouping without labels.
const iconGroupRule =
  "group-data-[collapsible=icon]:before:absolute group-data-[collapsible=icon]:before:-top-1 group-data-[collapsible=icon]:before:left-1/2 group-data-[collapsible=icon]:before:h-px group-data-[collapsible=icon]:before:w-4 group-data-[collapsible=icon]:before:-translate-x-1/2 group-data-[collapsible=icon]:before:bg-foreground/10"

// Otto: the sidebar's first group, the mark, in a 52px band: the page header
// row's height, 8px from the top like it (the container's padding), so the
// mark's center and the page title's center are one horizontal line (y 34); the
// next group starts at y 60, where the page body does. No side padding (the
// container pads the rows).
function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-header"
      data-sidebar="header"
      className={cn(
        "flex h-13 flex-col justify-center gap-0.5",
        className
      )}
      {...props}
    />
  )
}

// Otto: the last group, 16px below the one above (8px icons only), with the
// hairline above it like every group.
function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-footer"
      data-sidebar="footer"
      className={cn(
        "relative mt-4 flex flex-col gap-0.5 group-data-[collapsible=icon]:mt-2",
        iconGroupRule,
        className
      )}
      {...props}
    />
  )
}

// Otto: the groups' column between the header and the footer. It does not
// scroll by itself (its groups do, so a list can take the height that is left)
// and the groups are 16px apart (8px icons only).
function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-4 overflow-hidden group-data-[collapsible=icon]:gap-2",
        className
      )}
      {...props}
    />
  )
}

// Otto: no padding of its own (the content's gap spaces the groups); a title
// row and its rows are 2px apart like any two rows.
function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group"
      data-sidebar="group"
      className={cn(
        "relative flex w-full min-w-0 flex-col gap-0.5",
        iconGroupRule,
        className
      )}
      {...props}
    />
  )
}

// Otto: group titles are 12px, muted, 28px tall like the rows, their text on
// the rows' icon line (the same 8px padding).
function SidebarGroupLabel({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div"> & React.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(
          "flex h-7 shrink-0 items-center gap-1 rounded-sm px-2 text-xs font-medium text-muted-foreground outline-hidden group-data-[collapsible=icon]:hidden [&>svg]:size-3.5 [&>svg]:shrink-0",
          className
        ),
      },
      props
    ),
    render,
    state: {
      slot: "sidebar-group-label",
      sidebar: "group-label",
    },
  })
}

function SidebarGroupContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-content"
      data-sidebar="group-content"
      className={cn("w-full text-sm", className)}
      {...props}
    />
  )
}

// Otto: 28px rows 2px apart.
function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu"
      data-sidebar="menu"
      className={cn("flex w-full min-w-0 flex-col gap-0.5", className)}
      {...props}
    />
  )
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className={cn("group/menu-item relative", className)}
      {...props}
    />
  )
}

// Otto: rows are muted at rest and foreground on hover, open or active. They
// sit on the frame, so their fills are the shared state fills (alphas of
// `foreground`, DESIGN.md Buttons): hover 5%, the current row, a row whose menu
// is open and a pressed row 10%. A flat fill: no ring, no shadow, no weight
// change (the row never changes width). The one ring is keyboard focus, drawn
// INSET: rows sit flush with the clipping edge of the content and of the
// scrolling group, so an outer ring would be cut off on both sides. Rows are
// 28px buttons with 6px corners (`sm`), 8px padding, a 14px icon and an 8px gap
// (14 / 8 is about 1 / golden ratio): the icon's left edge and the label's
// start are the same two lines on every row, 16px and 38px from the sidebar's
// edge. Icons only (below 1024px) the row is a 28px square centered in the
// 48px sidebar (10 | 28 | 10). The user menu row is one of them too (a 20px
// avatar is its icon).
const sidebarMenuButton =
  "peer/menu-button group/menu-button flex w-full items-center gap-2 overflow-hidden rounded-sm px-2 py-1 text-left text-sm text-muted-foreground outline-hidden transition-[width,height,padding] h-7 group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-7! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:p-0! group-data-[collapsible=icon]:[&>span]:hidden group-data-[collapsible=icon]:[&>svg:not(:first-child)]:hidden hover:text-foreground not-data-active:group-hover/menu-item:bg-foreground/5 group-hover/menu-item:text-foreground active:bg-foreground/10 active:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:cursor-default data-active:bg-foreground/10 data-active:text-foreground aria-[haspopup]:aria-expanded:bg-foreground/10 aria-[haspopup]:aria-expanded:text-foreground aria-[current=page]:bg-foreground/10 aria-[current=page]:text-foreground [&_svg]:size-3.5 [&_svg]:shrink-0 [&>[data-slot=icon-slot]]:size-3.5 [&>span:last-child]:truncate"

function SidebarMenuButton({
  render,
  isActive = false,
  tooltip,
  className,
  ...props
}: useRender.ComponentProps<"button"> &
  React.ComponentProps<"button"> & {
    isActive?: boolean
    tooltip?: string | React.ComponentProps<typeof TooltipContent>
  }) {
  const { isMobile, state } = useSidebar()
  const comp = useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        className: cn(sidebarMenuButton, className),
      },
      props
    ),
    render: !tooltip ? render : <TooltipTrigger render={render} />,
    state: {
      slot: "sidebar-menu-button",
      sidebar: "menu-button",
      active: isActive,
    },
  })

  if (!tooltip) {
    return comp
  }

  // Otto: a tooltip (a label, or a label and its `Kbd` passed as props) shows
  // only while the sidebar is icons only: expanded, the row has its own label
  // and shows its key itself while the reveal key is held (`SidebarMenuKbd`), so a tooltip would repeat it.
  const content: React.ComponentProps<typeof TooltipContent> = {
    ...(typeof tooltip === "string" ? { children: tooltip } : tooltip),
    hidden: state !== "collapsed" || isMobile,
  }

  return (
    <Tooltip>
      {comp}
      <TooltipContent side="right" align="center" {...content} />
    </Tooltip>
  )
}

// Otto: a row's shortcut, a `Kbd` over the row's end, muted: the 20px key in a
// 28px row is 4px from the top, the right and the bottom (its own `xs` corners;
// the concentric 6 - 4 = 2px would look sharp on a key). Hidden until the
// reveal key is held (Option in the browser, ⌘ on the desktop): the sidebar
// carries `data-reveal-shortcuts="true"` then and every row's key fades in at
// once, never on hover. It takes no width, so nothing shifts. Icons only it is
// hidden: the tooltip carries the key then.
function SidebarMenuKbd({ className, ...props }: React.ComponentProps<typeof Kbd>) {
  return (
    <Kbd
      className={cn(
        "absolute top-1/2 right-1 -translate-y-1/2 opacity-0 transition-opacity duration-100 in-data-[reveal-shortcuts=true]:opacity-100 group-data-[collapsible=icon]:hidden",
        className
      )}
      {...props}
    />
  )
}

// Otto: a row's own action (more, pin, archive): a 20px square, `xs` corners,
// muted until hovered (`foreground/10`, which stacks on the row's fill), open
// `foreground/10`, pressed `/20`, the shared inset focus ring, 14px icons.
const sidebarRowAction =
  "flex size-5 shrink-0 items-center justify-center rounded-xs p-0 text-muted-foreground outline-hidden hover:bg-foreground/10 hover:text-foreground active:bg-foreground/20 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-expanded:bg-foreground/10 aria-expanded:text-foreground [&>svg]:size-3.5 [&>svg]:shrink-0"

// Otto: a row's own action, alone: 4px inside the 28px row on every side (like
// the key). Hidden until the row is hovered or focused (always on touch); the
// row keeps its hover while the pointer is on it.
function SidebarMenuAction({
  className,
  render,
  ...props
}: useRender.ComponentProps<"button"> & React.ComponentProps<"button">) {
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        className: cn(
          sidebarRowAction,
          "absolute top-1 right-1 group-data-[collapsible=icon]:hidden peer-hover/menu-button:text-foreground aria-expanded:opacity-100 pointer-fine:opacity-0 pointer-fine:group-focus-within/menu-item:opacity-100 pointer-fine:group-hover/menu-item:opacity-100",
          className
        ),
      },
      props
    ),
    render,
    state: {
      slot: "sidebar-menu-action",
      sidebar: "menu-action",
    },
  })
}

// Otto: the right end of a row, for what a row shows over its title: a status,
// a time, a key, or its actions (one thing at a time, which the row decides:
// stack the layers in the one cell, `col-start-1 row-start-1`). 4px inside the
// 28px row on the top, the right and the bottom (a 20px lane); it takes no
// width of its own and lets clicks through to the row except where a layer
// sets `pointer-events-auto`. The row fades its title under the lane with a
// mask, so the lane needs no fill of its own and matches every row state.
function SidebarMenuSlot({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-menu-slot"
      className={cn(
        "pointer-events-none absolute inset-y-1 right-1 grid grid-cols-1 items-center justify-items-end group-data-[collapsible=icon]:hidden",
        className
      )}
      {...props}
    />
  )
}

// Otto: a button in a `SidebarMenuSlot` (the row's actions), 20px, in line.
function SidebarMenuSlotAction({
  className,
  render,
  ...props
}: useRender.ComponentProps<"button"> & React.ComponentProps<"button">) {
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">({ className: cn(sidebarRowAction, className) }, props),
    render,
    state: {
      slot: "sidebar-menu-slot-action",
      sidebar: "menu-slot-action",
    },
  })
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuKbd,
  SidebarMenuSlot,
  SidebarMenuSlotAction,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
}
