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
// - `full`: v1's full composer: the expanded anatomy on the card surface
//   (`card-surface`, `shadow-sm`), as wide as the column's track (the chat, the
//   new chat, the Inbox). Never the attention (Inbox) slot.
// The look changes in place: width AND height move together over 320ms on the
// morph curve (the height follows the measured content, so a new line, the
// rail or the grow from the bar all glide), its bottom edge pinned; none with
// reduced motion. Slots are fixed positions (a missing one is null), so React
// keeps the text field. `dragging` rings the surface while files are dragged over.
type ComposerVariant = "compact" | "expanded" | "full"

function Composer({
  variant = "compact",
  dragging = false,
  attachments,
  leading,
  context,
  tools,
  hint,
  attention,
  main,
  className,
  style,
  children,
  ...props
}: Omit<React.ComponentProps<"form">, "action"> & {
  variant?: ComposerVariant
  dragging?: boolean
  /** The rail above the text (attachments and the page's chips; not in the compact bar). */
  attachments?: React.ReactNode
  /** The + (add files), first in the bar or the action row. */
  leading?: React.ReactNode
  /** What the page is about (an entity chip), after + in the action row. */
  context?: React.ReactNode
  /** Pickers (model), 28px; the waveform and timer while listening. */
  tools?: React.ReactNode
  /** A key hint (`Kbd`) at the end of the compact bar, only while a modifier is held. */
  hint?: React.ReactNode
  /** The Inbox icon: what needs you (compact and expanded only). */
  attention?: React.ReactNode
  /** The main button (`ComposerMainButton`), last. */
  main?: React.ReactNode
}) {
  const compact = variant === "compact"
  const content = React.useRef<HTMLDivElement>(null)
  const [height, setHeight] = React.useState<number>()
  React.useLayoutEffect(() => {
    const element = content.current
    if (!element) return
    const measure = () => setHeight(element.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const row = leading || context || tools || hint || attention || main
  return (
    <form
      data-slot="composer"
      data-variant={variant}
      data-dragging={dragging || undefined}
      className={cn(
        "group/composer w-full overflow-hidden rounded-xl text-sm",
        "transition-[height,max-width,background-color] duration-320 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
        variant === "full"
          ? "card-surface bg-card [--card-shadow:var(--shadow-sm)]"
          : // A tag on the glass reads foreground on its primary tint: primary
            // text on the translucent dark glass falls under 3:1 in light.
            "dark bg-popover/70 text-popover-foreground shadow-md ring-1 ring-foreground/10 backdrop-blur-2xl backdrop-saturate-150 [&_[data-entity]]:text-foreground",
        compact ? "max-w-[28rem]" : "max-w-full",
        "data-dragging:ring-2 data-dragging:ring-ring",
        className
      )}
      style={{ height, ...style }}
      {...props}
    >
      <div
        ref={content}
        className={cn(
          "flex w-full gap-1 p-1",
          compact ? "flex-row items-center" : "flex-col"
        )}
      >
        {compact ? null : attachments}
        {compact ? leading : null}
        {children}
        {row ? (
          <ComposerRow>
            {compact ? null : leading}
            {compact ? null : context}
            {tools}
            <span
              aria-hidden
              className="flex-1 group-data-[variant=compact]/composer:hidden"
            />
            {compact && hint ? (
              <span data-slot="composer-hint" className="flex shrink-0">
                {hint}
              </span>
            ) : null}
            {variant === "full" ? null : attention}
            {main}
          </ComposerRow>
        ) : null}
      </div>
    </form>
  )
}

// Otto: the text's box; the app puts its editor inside (a contenteditable with
// `role="textbox"`). One line in the compact bar (32px, 4px of its own padding,
// so the text starts 44px in; no wrapping, it scrolls sideways, and the
// placeholder ends in an ellipsis; the app expands once the text overflows or
// breaks a line); otherwise it grows with its content from one line to 240px,
// then scrolls, 16px in (the row's 4 + 12).
function ComposerInput({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="composer-input"
      className={cn(
        "max-h-60 min-h-8 w-full min-w-0 overflow-y-auto px-3 pt-2 pb-1 leading-5 [&_[role=textbox]]:outline-none [&_[data-slot=composer-placeholder]]:text-muted-foreground",
        "group-data-[variant=compact]/composer:h-8 group-data-[variant=compact]/composer:max-h-8 group-data-[variant=compact]/composer:flex-1 group-data-[variant=compact]/composer:overflow-hidden group-data-[variant=compact]/composer:px-1 group-data-[variant=compact]/composer:py-1.5",
        "group-data-[variant=compact]/composer:[&_[role=textbox]]:no-scrollbar group-data-[variant=compact]/composer:[&_[role=textbox]]:overflow-x-auto group-data-[variant=compact]/composer:[&_[role=textbox]]:whitespace-pre group-data-[variant=compact]/composer:[&_[data-slot=composer-placeholder]]:truncate",
        className
      )}
      {...props}
    />
  )
}

// Otto: the action row: 32px controls 4px apart, 4px in (their 8px corners nest
// in the 12px surface). In the compact bar it dissolves into the bar's one row.
// `relative`, so a status can lay itself over the row.
function ComposerRow({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="composer-row"
      className={cn(
        "relative flex w-full min-w-0 items-center gap-1 group-data-[variant=compact]/composer:contents",
        className
      )}
      {...props}
    />
  )
}

// Otto: the one main action, a 32px primary icon button (Send, Stop, Dictate,
// Done, Transcribing). Its tooltip is its label, then its key. `loading` is the
// Button's (spinner, disabled) while a send or a transcription is under way.
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
