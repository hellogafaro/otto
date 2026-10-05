/**
 * Dropdown menu: Craft's Radix-style API (`asChild`, `onSelect`, `Sub*`,
 * checkbox/radio items) as thin adapters over the design system's Base UI
 * menu (`@workspace/ui/components/dropdown-menu`), which owns the look.
 *
 * Mapping from Radix:
 * - `asChild` on the trigger -> Base UI `render`.
 * - item `onSelect(event)` -> `onClick`; `event.preventDefault()` keeps the menu open.
 * - `modal` and the other Root props are the same in Base UI.
 * - `data-[state=open]:*` classes on a trigger -> `aria-expanded:*` (never `data-popup-open`: a tooltip on the
 *   same trigger sets it while the tooltip shows).
 * - A label outside a group gets its own group (Base UI requires one).
 */
import * as React from "react"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem as DsCheckboxItem,
  DropdownMenuContent as DsContent,
  DropdownMenuGroup,
  DropdownMenuItem as DsItem,
  DropdownMenuLabel as DsLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem as DsRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent as DsSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger as DsTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@/lib/utils"

const SUPPORTED_HOVER_PREFIXES = ["bg-", "text-", "border-", "ring-", "opacity-"]

/** Base UI marks an open menu's trigger with `aria-expanded` (not Radix's `data-state=open`;
 * `data-popup-open` is also set by a tooltip on the trigger). */
function openStateToExpanded(className?: string): string | undefined {
  return className?.replace(/data-\[state=open\]:/g, "aria-expanded:")
}

function mirrorHoverToOpenStateClasses(className?: string): string | undefined {
  if (!className) return className

  const tokens = className.trim().split(/\s+/)
  const mirrored: string[] = []

  for (const token of tokens) {
    if (!token.includes("hover:")) continue

    const hoverIdx = token.indexOf("hover:")
    const afterHover = token.slice(hoverIdx + "hover:".length)
    const utility = afterHover.includes(":") ? afterHover.slice(afterHover.lastIndexOf(":") + 1) : afterHover

    if (!SUPPORTED_HOVER_PREFIXES.some(prefix => utility.startsWith(prefix))) continue

    mirrored.push(token.replace("hover:", "data-[state=open]:"))
  }

  return cn(...mirrored, className)
}

type TriggerProps = Omit<React.ComponentProps<typeof DsTrigger>, "render"> & {
  /** Radix: render the child element as the trigger. */
  asChild?: boolean
  /** Auto-mirror hover:* classes to the open state while the menu is open. Default: true */
  autoMirrorHoverToOpen?: boolean
}

function DropdownMenuTrigger({
  className,
  autoMirrorHoverToOpen = true,
  asChild,
  children,
  ...props
}: TriggerProps) {
  const style = (value?: string) =>
    openStateToExpanded(autoMirrorHoverToOpen ? mirrorHoverToOpenStateClasses(value) : value)

  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{ className?: string }>
    const merged = style(cn("select-none", child.props.className, className))
    // Base UI expects a <button> unless told otherwise.
    const nativeButton = typeof child.type === "string" ? child.type === "button" : true
    return (
      <DsTrigger nativeButton={nativeButton} {...props} render={React.cloneElement(child, { className: merged })} />
    )
  }

  return (
    <DsTrigger className={style(cn("select-none", className))} {...props}>
      {children}
    </DsTrigger>
  )
}

// Craft menus size to their content (min 8rem); the design system's match the
// trigger's width.
function DropdownMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof DsContent>) {
  return <DsContent className={cn("w-fit", className)} {...props} />
}

function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DsSubContent>) {
  return <DsSubContent className={cn("w-fit", className)} {...props} />
}

type SelectHandler = (event: Event) => void

/**
 * Radix `onSelect(event)` as Base UI `onClick`. Runs before Base UI's own
 * click handling; `event.preventDefault()` there keeps the menu open.
 */
function useSelectClick<E extends React.SyntheticEvent & { preventBaseUIHandler?: () => void }>(
  onClick: ((event: E) => void) | undefined,
  onSelect: SelectHandler | undefined,
) {
  return React.useCallback(
    (event: E) => {
      onClick?.(event)
      if (!onSelect) return
      onSelect(event.nativeEvent)
      if (event.nativeEvent.defaultPrevented) event.preventBaseUIHandler?.()
    },
    [onClick, onSelect],
  )
}

type WithSelect<P> = Omit<P, "onSelect"> & { onSelect?: SelectHandler }

function DropdownMenuItem({
  onClick,
  onSelect,
  ...props
}: WithSelect<React.ComponentProps<typeof DsItem>>) {
  const handleClick = useSelectClick(onClick, onSelect)
  return <DsItem onClick={handleClick} {...props} />
}

function DropdownMenuCheckboxItem({
  onClick,
  onSelect,
  ...props
}: WithSelect<React.ComponentProps<typeof DsCheckboxItem>>) {
  const handleClick = useSelectClick(onClick, onSelect)
  return <DsCheckboxItem onClick={handleClick} {...props} />
}

function DropdownMenuRadioItem({
  onClick,
  onSelect,
  ...props
}: WithSelect<React.ComponentProps<typeof DsRadioItem>>) {
  const handleClick = useSelectClick(onClick, onSelect)
  return <DsRadioItem onClick={handleClick} {...props} />
}

function DropdownMenuLabel(props: React.ComponentProps<typeof DsLabel>) {
  return (
    <DropdownMenuGroup>
      <DsLabel {...props} />
    </DropdownMenuGroup>
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
  useSelectClick,
}
export type { SelectHandler, WithSelect }
