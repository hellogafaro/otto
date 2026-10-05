import * as React from "react"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { cn } from "cn"
import { ChevronRightIcon, CheckIcon } from "lucide-react"

import { Kbd } from "@workspace/ui/components/kbd"

function DropdownMenu({ ...props }: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuPortal({ ...props }: MenuPrimitive.Portal.Props) {
  return <MenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
}

function DropdownMenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

// Otto: a lg surface (4px padding + 6px item radius, concentric), dark in both
// themes and translucent. Items are 28px (h-7) with 6px corners; a menu item's
// key runs it while the menu is open (see runMenuShortcut).
function DropdownMenuContent({
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  className,
  ...props
}: MenuPrimitive.Popup.Props &
  Pick<
    MenuPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className="isolate z-[var(--z-popup,50)] outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          onKeyDownCapture={runMenuShortcut}
          className={cn("dark z-[var(--z-popup,50)] max-h-(--available-height) w-(--anchor-width) min-w-32 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95 animate-none! relative bg-popover/70 before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-2xl before:backdrop-saturate-150 **:data-[slot$=-item]:focus:bg-foreground/10 **:data-[slot$=-item]:data-highlighted:bg-foreground/10 **:data-[slot$=-separator]:bg-foreground/5 **:data-[slot$=-trigger]:focus:bg-foreground/10 **:data-[slot$=-trigger]:aria-expanded:bg-foreground/10! **:data-[variant=destructive]:focus:bg-destructive/20! **:data-[variant=destructive]:data-highlighted:bg-destructive/20!", className )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function DropdownMenuGroup({ ...props }: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
}

function DropdownMenuLabel({
  className,
  inset,
  shortcut,
  children,
  ...props
}: MenuPrimitive.GroupLabel.Props & {
  inset?: boolean
  /** Key that opens this menu; shown as a Kbd on the right (Otto). */
  shortcut?: React.ReactNode
}) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "flex items-center justify-between gap-2 px-2 py-1.5 text-xs font-medium text-muted-foreground has-data-[slot=kbd]:pr-1 data-inset:pl-8",
        className
      )}
      {...props}
    >
      {children}
      {shortcut !== undefined && <Kbd>{shortcut}</Kbd>}
    </MenuPrimitive.GroupLabel>
  )
}

// Otto: a menu item's key ("P", "⌫" for Backspace or Delete) runs it while its
// menu is open, ahead of typeahead.
function runMenuShortcut(event: React.KeyboardEvent<HTMLElement>) {
  if (event.metaKey || event.ctrlKey || event.altKey) return
  const key =
    event.key === "Backspace" || event.key === "Delete"
      ? "⌫"
      : event.key.length === 1
        ? event.key.toUpperCase()
        : undefined
  if (!key) return
  const item = event.currentTarget.querySelector<HTMLElement>(
    `[data-shortcut="${key}"]:not([data-disabled])`
  )
  if (!item) return
  event.preventDefault()
  event.stopPropagation()
  item.click()
}

// Otto: highlighted items recolor their text only; colored icons keep their
// color. Destructive items (Delete) are always red, their highlight a red
// tint. `shortcut` shows the item's key as a Kbd on the right and runs it.

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  shortcut,
  children,
  ...props
}: MenuPrimitive.Item.Props & {
  inset?: boolean
  variant?: "default" | "destructive"
  shortcut?: string
}) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      data-shortcut={shortcut}
      className={cn(
        "group/dropdown-menu-item relative flex cursor-default items-center h-7 gap-2 rounded-sm px-2 text-sm outline-hidden select-none has-[>[data-slot=dropdown-menu-shortcut]:last-child]:pr-1 focus:bg-accent focus:text-accent-foreground data-inset:pl-8 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 data-[variant=destructive]:*:[svg]:text-destructive",
        className
      )}
      {...props}
    >
      {children}
      {shortcut && (
        <Kbd data-slot="dropdown-menu-shortcut" className="ml-auto">
          {shortcut}
        </Kbd>
      )}
    </MenuPrimitive.Item>
  )
}

function DropdownMenuSub({ ...props }: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "flex h-7 cursor-default items-center gap-2 rounded-sm px-2 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-inset:pl-8 data-popup-open:bg-accent data-popup-open:text-accent-foreground data-open:bg-accent data-open:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto" />
    </MenuPrimitive.SubmenuTrigger>
  )
}

function DropdownMenuSubContent({
  align = "start",
  alignOffset = -3,
  side = "right",
  sideOffset = 0,
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      data-slot="dropdown-menu-sub-content"
      className={cn("w-auto min-w-[96px]", className)}
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  shortcut,
  ...props
}: MenuPrimitive.CheckboxItem.Props & {
  inset?: boolean
  /** Key that picks this option; the check replaces it when selected (Otto). */
  shortcut?: React.ReactNode
}) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      data-shortcut={
        typeof shortcut === "string" || typeof shortcut === "number"
          ? String(shortcut).toUpperCase()
          : undefined
      }
      className={cn(
        "relative flex cursor-default items-center h-7 gap-2 rounded-sm pr-8 pl-2 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-inset:pl-8 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      checked={checked}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-1 flex min-w-5 items-center justify-center"
        data-slot="dropdown-menu-checkbox-item-indicator"
      >
        {shortcut !== undefined && (
          <Kbd className="in-data-checked:hidden">{shortcut}</Kbd>
        )}
        <MenuPrimitive.CheckboxItemIndicator>
          <CheckIcon />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({ ...props }: MenuPrimitive.RadioGroup.Props) {
  return (
    <MenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  )
}

function DropdownMenuRadioItem({
  className,
  children,
  inset,
  shortcut,
  ...props
}: MenuPrimitive.RadioItem.Props & {
  inset?: boolean
  /** Key that picks this option; the check replaces it when selected (Otto). */
  shortcut?: React.ReactNode
}) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      data-shortcut={
        typeof shortcut === "string" || typeof shortcut === "number"
          ? String(shortcut).toUpperCase()
          : undefined
      }
      className={cn(
        "relative flex cursor-default items-center h-7 gap-2 rounded-sm pr-8 pl-2 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-inset:pl-8 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-1 flex min-w-5 items-center justify-center"
        data-slot="dropdown-menu-radio-item-indicator"
      >
        {shortcut !== undefined && (
          <Kbd className="in-data-checked:hidden">{shortcut}</Kbd>
        )}
        <MenuPrimitive.RadioItemIndicator>
          <CheckIcon />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

// Otto: shortcuts always render as the stock Kbd, pushed to the right.
function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"kbd">) {
  return (
    <Kbd
      data-slot="dropdown-menu-shortcut"
      className={cn("ml-auto", className)}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  runMenuShortcut,
}
