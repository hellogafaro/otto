/**
 * StyledDropdown - Shared dropdown components for @otto/ui
 *
 * Craft's "styled" names (and Radix-style `asChild` / `onSelect`) as thin
 * wrappers over the design system's Base UI dropdown menu
 * (`@workspace/ui/components/dropdown-menu`). Surface, radii, item sizes and
 * colors come from there; nothing here adds its own.
 *
 * Mapping from Radix:
 * - `asChild` on the trigger -> Base UI `render`.
 * - item `onSelect(event)` -> `onClick`; `event.preventDefault()` keeps the menu open.
 * - `data-[state=open]:*` classes on a trigger -> `aria-expanded:*` (never `data-popup-open`: a tooltip on the
 *   same trigger sets it while the tooltip shows).
 * - Dropped (no Base UI equivalent, accepted and ignored): `onInteractOutside`,
 *   `light`.
 */

import * as React from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger as DsTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { cn } from '../../lib/utils'

const SUPPORTED_HOVER_PREFIXES = ['bg-', 'text-', 'border-', 'ring-', 'opacity-']

/**
 * Mirror hover styles to open-state styles for triggers.
 *
 * Example:
 * - hover:bg-foreground/5 -> data-[state=open]:bg-foreground/5
 *
 * Consumers can still provide explicit data-[state=open]:* classes to override.
 */
export function mirrorHoverToOpenStateClasses(className?: string): string | undefined {
  if (!className) return className

  const tokens = className.trim().split(/\s+/)
  const mirrored: string[] = []

  for (const token of tokens) {
    if (!token.includes('hover:')) continue

    const hoverIdx = token.indexOf('hover:')
    const afterHover = token.slice(hoverIdx + 'hover:'.length)
    const utility = afterHover.includes(':') ? afterHover.slice(afterHover.lastIndexOf(':') + 1) : afterHover

    if (!SUPPORTED_HOVER_PREFIXES.some(prefix => utility.startsWith(prefix))) continue

    mirrored.push(token.replace('hover:', 'data-[state=open]:'))
  }

  return cn(...mirrored, className)
}

/** Base UI marks an open menu's trigger with `aria-expanded` (not Radix's `data-state=open`;
 * `data-popup-open` is also set by a tooltip on the trigger). */
function openStateToExpanded(className?: string): string | undefined {
  return className?.replace(/data-\[state=open\]:/g, 'aria-expanded:')
}

export { DropdownMenu, DropdownMenuSub, DropdownMenuShortcut }

// ── Trigger ──────────────────────────────────────────────────────────────────

interface DropdownMenuTriggerProps extends Omit<React.ComponentProps<typeof DsTrigger>, 'render'> {
  /** Radix: render the child element as the trigger. */
  asChild?: boolean
  /** Auto-mirror hover:* classes to the open state while the menu is open. Default: true */
  autoMirrorHoverToOpen?: boolean
}

export function DropdownMenuTrigger({
  className,
  autoMirrorHoverToOpen = true,
  asChild,
  children,
  ...props
}: DropdownMenuTriggerProps) {
  const style = (value?: string) =>
    openStateToExpanded(autoMirrorHoverToOpen ? mirrorHoverToOpenStateClasses(value) : value)

  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{ className?: string }>
    const merged = style(cn(child.props.className, className))
    // Base UI expects a <button> unless told otherwise.
    const nativeButton = typeof child.type === 'string' ? child.type === 'button' : true
    return (
      <DsTrigger nativeButton={nativeButton} {...props} render={React.cloneElement(child, { className: merged })} />
    )
  }

  return (
    <DsTrigger className={typeof className === 'function' ? className : style(className)} {...props}>
      {children}
    </DsTrigger>
  )
}

// ── Content ──────────────────────────────────────────────────────────────────

interface StyledDropdownMenuContentProps extends React.ComponentProps<typeof DropdownMenuContent> {
  /** Minimum width class, e.g. "min-w-48". Defaults to the design system's. */
  minWidth?: string
  /** Ignored: the design system's menus have one look. */
  light?: boolean
  /** Ignored: Base UI closes on outside press. */
  onInteractOutside?: unknown
}

export function StyledDropdownMenuContent({
  className,
  minWidth,
  light: _light,
  onInteractOutside: _onInteractOutside,
  ...props
}: StyledDropdownMenuContentProps) {
  // Content sizes to its items (the design system's matches the trigger's width).
  return <DropdownMenuContent className={cn('w-fit', minWidth, className)} {...props} />
}

// ── Item ─────────────────────────────────────────────────────────────────────

type StyledDropdownMenuItemProps = Omit<React.ComponentProps<typeof DropdownMenuItem>, 'onSelect'> & {
  /** Radix: run on select; `event.preventDefault()` keeps the menu open. */
  onSelect?: (event: Event) => void
}

export function StyledDropdownMenuItem({ onClick, onSelect, ...props }: StyledDropdownMenuItemProps) {
  const handleClick = React.useCallback(
    (event: Parameters<NonNullable<typeof onClick>>[0]) => {
      onClick?.(event)
      if (!onSelect) return
      onSelect(event.nativeEvent)
      if (event.nativeEvent.defaultPrevented) event.preventBaseUIHandler()
    },
    [onClick, onSelect],
  )
  return <DropdownMenuItem onClick={handleClick} {...props} />
}

// ── Separator ────────────────────────────────────────────────────────────────

export function StyledDropdownMenuSeparator(props: React.ComponentProps<typeof DropdownMenuSeparator>) {
  return <DropdownMenuSeparator {...props} />
}

// ── Sub-menu ─────────────────────────────────────────────────────────────────

export function StyledDropdownMenuSubTrigger(props: React.ComponentProps<typeof DropdownMenuSubTrigger>) {
  return <DropdownMenuSubTrigger {...props} />
}

interface StyledDropdownMenuSubContentProps extends React.ComponentProps<typeof DropdownMenuSubContent> {
  /** Minimum width class, e.g. "min-w-48". Defaults to the design system's. */
  minWidth?: string
}

export function StyledDropdownMenuSubContent({ className, minWidth, ...props }: StyledDropdownMenuSubContentProps) {
  return <DropdownMenuSubContent className={cn('w-fit', minWidth, className)} {...props} />
}
