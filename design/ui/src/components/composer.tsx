"use client"

import { cn } from "cn"
import * as React from "react"

import { Button } from "@workspace/ui/components/button"
import { Kbd } from "@workspace/ui/components/kbd"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

// Otto: the ONE composer (DESIGN.md, Composer; docs/composer.md). Presentational:
// the app owns the text, the state machine and the send path. Three looks, one
// structure, so the text field never remounts when the look changes:
// - `compact`: the 40px glass bar (the command palette's surface: dark in both
//   themes, popover at 70%, blurred), 448px (28rem) wide, ONE row 4px in:
//   leading (+) · text (44px in) · hint · tools · attention · main.
// - `expanded`: the same glass grown to the column's content width (720px; its
//   bottom edge stays put), rows top to bottom: attachments, text (up to 240px,
//   16px in), the action row (leading, context, tools … attention, main).
// - `full`: the expanded anatomy on the card surface (`card-surface`,
//   `shadow-sm`), in the layout flow (the chat; W2).
// Width changes over 320ms on the morph curve, none with reduced motion. Slots
// are fixed positions (a missing one is null), so React keeps the text field.
type ComposerVariant = "compact" | "expanded" | "full"

function Composer({
  variant = "compact",
  attachments,
  leading,
  context,
  tools,
  hint,
  attention,
  main,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"form">, "action"> & {
  variant?: ComposerVariant
  /** The attachment rail, above the text (not in the compact bar). */
  attachments?: React.ReactNode
  /** The + (add files), first in the bar or the action row. */
  leading?: React.ReactNode
  /** What the page is about (an entity chip), after + in the action row. */
  context?: React.ReactNode
  /** Pickers (model, permission), 28px. */
  tools?: React.ReactNode
  /** A short key hint (`Kbd`) at the end of the idle compact bar. */
  hint?: React.ReactNode
  /** The Inbox icon: what needs you (compact and expanded only). */
  attention?: React.ReactNode
  /** The main button (`ComposerMainButton`), last. */
  main?: React.ReactNode
}) {
  const compact = variant === "compact"
  return (
    <form
      data-slot="composer"
      data-variant={variant}
      className={cn(
        "group/composer flex w-full gap-1 rounded-xl p-1 text-sm",
        "transition-[max-width] duration-320 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
        variant === "full"
          ? "card-surface bg-card [--card-shadow:var(--shadow-sm)]"
          : "dark bg-popover/70 text-popover-foreground shadow-md ring-1 ring-foreground/10 backdrop-blur-2xl backdrop-saturate-150",
        compact ? "max-w-[28rem] flex-row items-center" : "max-w-full flex-col",
        className
      )}
      {...props}
    >
      {compact ? null : attachments}
      {compact ? leading : null}
      {children}
      <ComposerRow>
        {compact ? null : leading}
        {compact ? null : context}
        {tools}
        <span aria-hidden className="flex-1 group-data-[variant=compact]/composer:hidden" />
        {compact && hint ? (
          // Phones have no shortcut keys: the hint gives the text its room.
          <span data-slot="composer-hint" className="flex shrink-0 max-md:hidden">
            {hint}
          </span>
        ) : null}
        {variant === "full" ? null : attention}
        {main}
      </ComposerRow>
    </form>
  )
}

// Otto: the text. One line in the compact bar (32px, 4px of its own padding, so
// it starts 44px in; no wrapping, a long placeholder ends in an ellipsis, and
// the app expands once the text overflows or breaks a line); otherwise
// it grows with its content from one line to 240px, 16px in (the row's 4 + 12).
function ComposerInput({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="composer-input"
      rows={1}
      className={cn(
        "field-sizing-content max-h-60 min-h-8 w-full min-w-0 resize-none bg-transparent px-3 pt-2 pb-1 leading-5 outline-none placeholder:text-muted-foreground disabled:opacity-50",
        "group-data-[variant=compact]/composer:h-8 group-data-[variant=compact]/composer:flex-1 group-data-[variant=compact]/composer:overflow-hidden group-data-[variant=compact]/composer:px-1 group-data-[variant=compact]/composer:py-1.5 group-data-[variant=compact]/composer:text-ellipsis group-data-[variant=compact]/composer:whitespace-nowrap",
        className
      )}
      {...props}
    />
  )
}

// Otto: the action row: 32px controls 4px apart, 4px in (their 8px corners nest
// in the 12px surface). In the compact bar it dissolves into the bar's one row.
function ComposerRow({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="composer-row"
      className={cn(
        "flex w-full min-w-0 items-center gap-1 group-data-[variant=compact]/composer:contents",
        className
      )}
      {...props}
    />
  )
}

// Otto: the one main action, a 32px primary icon button (Send, Stop; Dictate
// and Done come with dictation). Its tooltip is its label, then its key.
// `loading` is the Button's (spinner, disabled) while a send is under way.
function ComposerMainButton({
  label,
  shortcut,
  children,
  ...props
}: React.ComponentProps<typeof Button> & {
  label: string
  /** The key, shown as a `Kbd` after the label in the tooltip. */
  shortcut?: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="default"
            size="icon"
            aria-label={label}
            {...props}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut && <Kbd>{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  )
}

export { Composer, ComposerInput, ComposerMainButton, ComposerRow }
export type { ComposerVariant }
