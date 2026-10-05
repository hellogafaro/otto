"use client"

import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { Button } from "@workspace/ui/components/button"
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
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import * as React from "react"
import { MenuIcon } from "lucide-react"

// Otto: the shell's one sidebar, on the frame beside the page card (Threads'
// layout). Widths are px so the root font size never changes them: ONE width
// for every section and page, 256px (also the sheet below 768px; the Chats
// list and the Settings pages both fit), 48px as icons only (8 | 32 | 8, the rail's old geometry). Nothing
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

// Otto: 8px above and below, no side padding (the container pads the rows).
function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-header"
      data-sidebar="header"
      className={cn("flex flex-col gap-0.5 py-2", className)}
      {...props}
    />
  )
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-footer"
      data-sidebar="footer"
      className={cn("flex flex-col gap-0.5 pt-2", className)}
      {...props}
    />
  )
}

// Otto: does not scroll by itself: its groups do, so a list can take the
// height that is left.
function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-2 overflow-hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group"
      data-sidebar="group"
      className={cn("relative flex w-full min-w-0 flex-col py-2", className)}
      {...props}
    />
  )
}

// Otto: group titles are 12px, muted, 28px tall like the rows, their text on
// the rows' label column.
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

// Otto: the section's own action ("Edit", a filter or an add button) at the end
// of the group's title row: a 24px ghost button, muted until hovered, 2px
// inside the 28px title row, corners `xs` (6 - 2).
function SidebarGroupAction({
  className,
  render,
  ...props
}: useRender.ComponentProps<"button"> & React.ComponentProps<"button">) {
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        className: cn(
          "absolute top-2.5 right-0 flex size-6 items-center justify-center rounded-xs p-0 text-xs font-medium text-muted-foreground ring-sidebar-ring outline-hidden group-data-[collapsible=icon]:hidden hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 aria-expanded:bg-sidebar-accent aria-expanded:text-foreground [&>svg]:size-3.5 [&>svg]:shrink-0",
          className
        ),
      },
      props
    ),
    render,
    state: {
      slot: "sidebar-group-action",
      sidebar: "group-action",
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
// sit on the frame, so their fills are the frame's layer: hover is
// `--sidebar-accent` at 60%, the current row `--sidebar-accent` with the
// hairline ring (white on the grey frame, 0.22 on the dark one). Rows are 28px
// buttons with 6px corners (`sm`); what leads a row sits in a 20px slot 4px in,
// the same as above and below it: avatars, icon slots, and bare icons (3px each
// side, so 7px around a 14px icon). Labels start 32px in. Icons only (below
// 1024px) the row is a 32px square, 8 | 32 | 8 in the 48px sidebar.
const sidebarMenuButtonVariants = cva(
  "peer/menu-button group/menu-button flex w-full items-center gap-2 overflow-hidden rounded-sm px-2 py-1 text-left text-sm text-muted-foreground ring-sidebar-ring outline-hidden transition-[width,height,padding] has-[>svg:first-child,>[data-slot=avatar]:first-child,>[data-slot=icon-slot]:first-child]:pl-1 [&>svg:first-child]:mx-0.75 group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:p-0! group-data-[collapsible=icon]:[&>span]:hidden group-data-[collapsible=icon]:[&>svg:not(:first-child)]:hidden group-data-[collapsible=icon]:[&>svg:first-child]:mx-0 hover:text-foreground not-data-active:group-hover/menu-item:bg-sidebar-accent/60 group-hover/menu-item:text-foreground aria-expanded:text-foreground focus-visible:ring-2 active:text-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:cursor-default data-active:bg-sidebar-accent data-active:font-medium data-active:text-foreground data-active:shadow-xs data-active:ring-1 data-active:ring-foreground/10 [&_svg]:size-3.5 [&_svg]:shrink-0 [&>span:last-child]:truncate",
  {
    variants: {
      size: {
        default: "h-7 text-sm",
        // Otto: a row that holds a 32px avatar, 4px inside (8 + 4 = 12 corners).
        lg: "h-10 rounded-xl has-[>[data-slot=avatar]:first-child]:pl-1 group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:rounded-md",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

function SidebarMenuButton({
  render,
  isActive = false,
  size = "default",
  tooltip,
  className,
  ...props
}: useRender.ComponentProps<"button"> &
  React.ComponentProps<"button"> & {
    isActive?: boolean
    tooltip?: string | React.ComponentProps<typeof TooltipContent>
  } & VariantProps<typeof sidebarMenuButtonVariants>) {
  const { isMobile, state } = useSidebar()
  const comp = useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        className: cn(sidebarMenuButtonVariants({ size }), className),
      },
      props
    ),
    render: !tooltip ? render : <TooltipTrigger render={render} />,
    state: {
      slot: "sidebar-menu-button",
      sidebar: "menu-button",
      size,
      active: isActive,
    },
  })

  if (!tooltip) {
    return comp
  }

  // Otto: a plain label shows only while the sidebar is icons only (the row
  // has its own label otherwise); a tooltip passed as props (a label and its
  // `Kbd`) shows in both.
  const content: React.ComponentProps<typeof TooltipContent> =
    typeof tooltip === "string"
      ? { children: tooltip, hidden: state !== "collapsed" || isMobile }
      : tooltip

  return (
    <Tooltip>
      {comp}
      <TooltipContent side="right" align="center" {...content} />
    </Tooltip>
  )
}

// Otto: a row's own action (more, remove): 24px, 2px inside the 28px row on
// every side, corners `xs` to nest. Hidden until the row is hovered or focused
// (always on touch); the row keeps its hover while the pointer is on it.
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
          "absolute top-0.5 right-0.5 flex size-6 items-center justify-center rounded-xs p-0 text-muted-foreground ring-sidebar-ring outline-hidden group-data-[collapsible=icon]:hidden peer-hover/menu-button:text-foreground hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 aria-expanded:opacity-100 pointer-fine:opacity-0 pointer-fine:group-focus-within/menu-item:opacity-100 pointer-fine:group-hover/menu-item:opacity-100 [&>svg]:size-3.5 [&>svg]:shrink-0",
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

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
}
