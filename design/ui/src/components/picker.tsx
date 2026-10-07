"use client"

import * as React from "react"
import { cn } from "cn"

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxSearch,
  ComboboxTrigger,
} from "@workspace/ui/components/combobox"

// Otto: the one searchable picker (shadcn's Combobox pattern on Base UI), for
// every list of things to choose from (a project, people and agents, library
// items). Any element opens it (a sidecar `PropertyRow`, a "+" button, a form
// field); the menu has the search docked on top (`ComboboxSearch`), filters
// as you type on each item's label, says `empty` ("No projects found", or why
// there is nothing to pick) when nothing is left, and checks the current
// value(s). ↑↓ move, Enter picks, Escape closes. Rows are the menus' 28px
// rows: the item's icon or 20px avatar, then its label. One value closes it
// on a pick; `multiple` keeps it open and toggles. Short fixed sets (a task's
// three statuses) stay a `DropdownMenu` with number keys.
type PickerProps = {
  items: string[]
  itemLabel: (item: string) => string
  itemIcon?: (item: string) => React.ReactNode
  trigger: React.ReactElement
  /** The search field's placeholder. */
  search: string
  empty: React.ReactNode
  disabled?: boolean
  align?: "start" | "center" | "end"
  className?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
} & (
  | {
      multiple?: false
      /** null: nothing chosen (an "add" list). */
      value: string | null
      onValueChange: (value: string) => void
    }
  | { multiple: true; value: string[]; onValueChange: (value: string[]) => void }
)

function Picker(props: PickerProps) {
  const {
    items,
    itemLabel,
    itemIcon,
    trigger,
    search,
    empty,
    disabled,
    align = "start",
    className,
    open,
    onOpenChange,
  } = props
  const onValueChange = (next: unknown) => {
    if (props.multiple) props.onValueChange(next as string[])
    else if (typeof next === "string") props.onValueChange(next)
  }
  // Base UI types `value` by `multiple`; one root, the props cast once.
  const root = {
    items,
    multiple: props.multiple ?? false,
    value: props.value,
    onValueChange,
    itemToStringLabel: itemLabel,
    open,
    onOpenChange,
  } as React.ComponentProps<typeof Combobox>
  return (
    <Combobox {...root}>
      <ComboboxTrigger disabled={disabled} render={trigger} />
      <ComboboxContent align={align} className={cn("w-60", className)}>
        <ComboboxSearch placeholder={search} />
        <ComboboxEmpty>{empty}</ComboboxEmpty>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item}>
              {itemIcon?.(item)}
              <span className="truncate">{itemLabel(item)}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

export { Picker }
