/**
 * Context menu: Craft's Radix-style API (`asChild`, `onSelect`, `Sub*`,
 * checkbox/radio items) as thin adapters over the design system's Base UI
 * context menu (`@workspace/ui/components/context-menu`), which owns the look.
 *
 * Mapping from Radix: `asChild` on the trigger -> `render`; item
 * `onSelect(event)` -> `onClick` (`preventDefault()` keeps the menu open);
 * `modal` is dropped (Base UI's context menu has no such prop); a label outside
 * a group gets its own group (Base UI requires one). Item `shortcut` shows the
 * key and runs it while the menu is open (design system behaviour).
 */
import * as React from "react"
import {
  ContextMenu as DsContextMenu,
  ContextMenuCheckboxItem as DsCheckboxItem,
  ContextMenuContent as DsContent,
  ContextMenuGroup,
  ContextMenuItem as DsItem,
  ContextMenuLabel as DsLabel,
  ContextMenuPortal,
  ContextMenuRadioGroup,
  ContextMenuRadioItem as DsRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent as DsSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger as DsTrigger,
} from "@workspace/ui/components/context-menu"
import { asChildProps } from "./as-child"
import { useSelectClick, type WithSelect } from "./dropdown-menu"

function ContextMenu({
  // Radix-only: Base UI's context menu has no `modal`.
  modal: _modal,
  ...props
}: React.ComponentProps<typeof DsContextMenu> & { modal?: boolean }) {
  return <DsContextMenu {...props} />
}

function ContextMenuTrigger({
  asChild,
  children,
  ...props
}: Omit<React.ComponentProps<typeof DsTrigger>, "render"> & { asChild?: boolean }) {
  return <DsTrigger {...asChildProps({ asChild, children, ...props })} />
}

function ContextMenuContent(props: React.ComponentProps<typeof DsContent>) {
  return <DsContent {...props} />
}

function ContextMenuSubContent(props: React.ComponentProps<typeof DsSubContent>) {
  return <DsSubContent {...props} />
}

function ContextMenuItem({
  onClick,
  onSelect,
  ...props
}: WithSelect<React.ComponentProps<typeof DsItem>>) {
  const handleClick = useSelectClick(onClick, onSelect)
  return <DsItem onClick={handleClick} {...props} />
}

function ContextMenuCheckboxItem({
  onClick,
  onSelect,
  ...props
}: WithSelect<React.ComponentProps<typeof DsCheckboxItem>>) {
  const handleClick = useSelectClick(onClick, onSelect)
  return <DsCheckboxItem onClick={handleClick} {...props} />
}

function ContextMenuRadioItem({
  onClick,
  onSelect,
  ...props
}: WithSelect<React.ComponentProps<typeof DsRadioItem>>) {
  const handleClick = useSelectClick(onClick, onSelect)
  return <DsRadioItem onClick={handleClick} {...props} />
}

function ContextMenuLabel(props: React.ComponentProps<typeof DsLabel>) {
  return (
    <ContextMenuGroup>
      <DsLabel {...props} />
    </ContextMenuGroup>
  )
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup,
}
