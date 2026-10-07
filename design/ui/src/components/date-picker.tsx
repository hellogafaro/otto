"use client"

import * as React from "react"

import { Button } from "@workspace/ui/components/button"
import { Calendar } from "@workspace/ui/components/calendar"
import { Kbd } from "@workspace/ui/components/kbd"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"

// Otto: the one date picker (shadcn's pattern: a Popover holding the
// Calendar), never the native date input. Any element opens it (a sidecar
// `PropertyRow`, a form field); the month opens on the chosen day, else today,
// with that day focused: arrows move a day or a week, Page Up / Down a month,
// Enter picks and closes, Escape closes. Its footer has Clear (⌫) and Today
// (T), each key shown as a `Kbd` and working while the calendar is open.
function DatePicker({
  value,
  onValueChange,
  trigger,
  clearLabel,
  todayLabel,
  locale,
  open: openProp,
  onOpenChange,
  align = "start",
}: {
  value: Date | null
  onValueChange: (value: Date | null) => void
  /** The element that opens it (rendered by the popover's trigger). */
  trigger: React.ReactElement
  clearLabel: string
  todayLabel: string
  /** The UI language's date-fns locale (month and weekday names, first day of the week). */
  locale?: React.ComponentProps<typeof Calendar>["locale"]
  open?: boolean
  onOpenChange?: (open: boolean) => void
  align?: "start" | "center" | "end"
}) {
  const [ownOpen, setOwnOpen] = React.useState(false)
  const open = openProp ?? ownOpen
  const setOpen = (next: boolean) => {
    setOwnOpen(next)
    onOpenChange?.(next)
  }
  const pick = (date: Date | null) => {
    onValueChange(date)
    setOpen(false)
  }
  const today = () => {
    const now = new Date()
    pick(new Date(now.getFullYear(), now.getMonth(), now.getDate()))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverContent
        align={align}
        className="w-auto"
        onKeyDown={(event) => {
          if (event.metaKey || event.ctrlKey || event.altKey) return
          if (event.key === "t" || event.key === "T") {
            event.preventDefault()
            today()
          } else if (event.key === "Backspace" || event.key === "Delete") {
            event.preventDefault()
            pick(null)
          }
        }}
      >
        <Calendar
          mode="single"
          autoFocus
          locale={locale}
          selected={value ?? undefined}
          defaultMonth={value ?? undefined}
          onSelect={(date) => (date ? pick(date) : setOpen(false))}
        />
        <div className="flex items-center justify-between gap-1 border-t border-foreground/5 pt-1">
          <Button variant="ghost" size="compact" disabled={value === null} onClick={() => pick(null)}>
            {clearLabel}
            <Kbd>⌫</Kbd>
          </Button>
          <Button variant="ghost" size="compact" onClick={today}>
            {todayLabel}
            <Kbd>T</Kbd>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export { DatePicker }
