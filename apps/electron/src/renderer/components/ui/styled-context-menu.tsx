import * as React from "react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "./context-menu"
import { cn } from "@/lib/utils"

/**
 * Styled Context Menu Components
 *
 * Craft's "styled" names over the context-menu adapters. The surface, radii,
 * item sizes and colors all come from the design system; these only keep the
 * exports and props (`minWidth`, `variant`) existing call sites use.
 */

export { ContextMenu, ContextMenuTrigger }

interface StyledContextMenuContentProps
  extends React.ComponentProps<typeof ContextMenuContent> {
  /** Minimum width class, e.g. "min-w-48". Defaults to the design system's. */
  minWidth?: string
}

export function StyledContextMenuContent({
  className,
  minWidth,
  ...props
}: StyledContextMenuContentProps) {
  return <ContextMenuContent className={cn("w-fit", minWidth, className)} {...props} />
}

type StyledContextMenuItemProps = React.ComponentProps<typeof ContextMenuItem>

export function StyledContextMenuItem(props: StyledContextMenuItemProps) {
  return <ContextMenuItem {...props} />
}

export function StyledContextMenuSeparator(
  props: React.ComponentProps<typeof ContextMenuSeparator>
) {
  return <ContextMenuSeparator {...props} />
}

export { ContextMenuSub as StyledContextMenuSub }

export function StyledContextMenuSubTrigger(
  props: React.ComponentProps<typeof ContextMenuSubTrigger>
) {
  return <ContextMenuSubTrigger {...props} />
}

interface StyledContextMenuSubContentProps
  extends React.ComponentProps<typeof ContextMenuSubContent> {
  /** Minimum width class, e.g. "min-w-48". Defaults to the design system's. */
  minWidth?: string
}

export function StyledContextMenuSubContent({
  className,
  minWidth,
  ...props
}: StyledContextMenuSubContentProps) {
  return <ContextMenuSubContent className={cn("w-fit", minWidth, className)} {...props} />
}
