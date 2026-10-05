/**
 * Select: Craft's Radix-style API (string `value`, `onValueChange(value: string)`,
 * `SelectContent container`) as a thin adapter over the design system's Base UI
 * select (`@workspace/ui/components/select`). The look comes from there.
 */
import * as React from "react"
import type { Select as SelectPrimitive } from "@base-ui/react/select"
import { cn } from "@/lib/utils"
import {
  Select as DsSelect,
  SelectContent as DsSelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger as DsSelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"

/** Plain text of a node, for the trigger label of an item. */
function nodeText(node: React.ReactNode): string | null {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) {
    const parts = node.map(nodeText)
    return parts.every((p) => p !== null) ? parts.join("") : null
  }
  return null
}

/**
 * Base UI shows an item's label in the trigger only once the popup has
 * mounted; before that it would show the raw value. Collect `value -> text`
 * from the SelectItem elements in our children so the trigger is right from
 * the first render (what Radix did by rendering items eagerly).
 */
function collectItems(
  node: React.ReactNode,
  out: Record<string, React.ReactNode> = {},
): Record<string, React.ReactNode> {
  React.Children.forEach(node, (child) => {
    if (!React.isValidElement(child)) return
    const props = child.props as { value?: unknown; children?: React.ReactNode }
    if (child.type === SelectItem) {
      const text = nodeText(props.children)
      if (typeof props.value === "string" && text !== null) out[props.value] = text
      return
    }
    if (props.children) collectItems(props.children, out)
  })
  return out
}

type SelectProps = Omit<
  SelectPrimitive.Root.Props<string>,
  "onValueChange" | "value" | "defaultValue" | "multiple"
> & {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
}

function Select({
  value,
  defaultValue,
  onValueChange,
  items,
  children,
  ...props
}: SelectProps) {
  const derivedItems = React.useMemo(
    () => items ?? collectItems(children),
    [items, children],
  )
  // Radix treats "" as "no selection" (placeholder); Base UI uses null.
  const controlled: { value?: string | null } =
    value !== undefined ? { value: value === "" ? null : value } : {}
  return (
    <DsSelect
      items={derivedItems}
      defaultValue={defaultValue === "" ? null : defaultValue}
      onValueChange={(next) => {
        if (next != null) onValueChange?.(next as string)
      }}
      {...controlled}
      {...props}
    >
      {children}
    </DsSelect>
  )
}

// Craft selects fill their container; the design system's are w-fit.
function SelectTrigger({
  className,
  ...props
}: React.ComponentProps<typeof DsSelectTrigger>) {
  return <DsSelectTrigger className={cn("w-full", className)} {...props} />
}

function SelectContent({
  // Radix-only: Base UI always positions as a popper here.
  position: _position,
  ...props
}: React.ComponentProps<typeof DsSelectContent> & {
  position?: "popper" | "item-aligned"
}) {
  return <DsSelectContent {...props} />
}

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}
