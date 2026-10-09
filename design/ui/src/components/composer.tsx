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

// Otto: the one composer stays full width, with a 10px outer corner, 8px
// text/control/attachment inset, 6px buttons and 8px attachment corners. The
// small two-layer shadow is darker in dark mode; the measured height and
// pointer-free page fade remain separate from its surface elevation.
const SURFACE =
  "rounded-lg bg-card text-sm text-card-foreground shadow-sm shadow-black/15 dark:shadow-black/35 ring-1 ring-foreground/10"

function Composer({
  dragging = false,
  attachments,
  leading,
  tools,
  main,
  className,
  style,
  children,
  ...props
}: Omit<React.ComponentProps<"form">, "action"> & {
  dragging?: boolean
  /** The rail above the text (attachments and the page's chips). */
  attachments?: React.ReactNode
  /** Add files beside the main action; Cancel first while dictating. */
  leading?: React.ReactNode
  /** Pickers (model), 28px; the waveform and timer while listening. */
  tools?: React.ReactNode
  /** The main button (`ComposerMainButton`), last. */
  main?: React.ReactNode
}) {
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
  const row = leading || tools || main
  return (
    <form
      data-slot="composer"
      data-dragging={dragging || undefined}
      className={cn(
        "group/composer w-full overflow-hidden",
        SURFACE,
        "transition-[height] duration-320 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
        "data-dragging:ring-ring",
        className
      )}
      style={{ height, ...style }}
      {...props}
    >
      <div ref={content} className="flex w-full flex-col">
        <div className="flex w-full flex-col gap-1 p-2">
          {attachments}
          {row ? (
            <ComposerRow>
              {children}
              {leading}
              {tools}
              {main}
            </ComposerRow>
          ) : children}
        </div>
      </div>
    </form>
  )
}

// Otto: the editor grows to 240px, with its only inset supplied by the surface.
// Dictation keeps the editor mounted while hiding its box.
function ComposerInput({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="composer-input"
      className={cn(
        "flex min-h-8 min-w-0 flex-1 items-center group-has-[[data-slot=dictation]]/composer:hidden max-h-60 overflow-y-auto leading-5 *:w-full [&_[role=textbox]]:outline-none [&_[data-slot=composer-placeholder]]:truncate [&_[data-slot=composer-placeholder]]:text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

// Otto: 32px controls remain 8px apart; the surface owns their outer inset.
// The row stays relative for the existing status overlay.
function ComposerRow({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="composer-row"
      className={cn(
        "relative flex w-full min-w-0 items-end gap-2 group-has-[[data-slot=dictation]]/composer:items-center",
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
