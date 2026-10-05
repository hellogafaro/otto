/**
 * SystemMessage - Displays system/info/error/warning messages
 *
 * Used for displaying non-conversational messages like errors, warnings,
 * info notices, and general system messages. Supports different visual
 * styles based on the message type.
 *
 * Error and warning types use a flat tinted fill.
 * System and info types use a simple bordered style.
 */

import { cn } from '../../lib/utils'
import { Markdown } from '../markdown'

export type SystemMessageType = 'error' | 'info' | 'warning' | 'system'

export interface SystemMessageProps {
  /** Message content (markdown supported) */
  content: string
  /** Message type determining visual style */
  type: SystemMessageType
  /** Additional className for the outer container */
  className?: string
}

// Style configuration for each message type
// Error and warning are a flat tinted fill, others use bordered style
const MESSAGE_STYLES: Record<SystemMessageType, { className: string }> = {
  error: {
    // Uses -text variant (mixed with foreground) for better text contrast
    className: 'text-[var(--destructive-text)] bg-destructive/10',
  },
  warning: {
    // Uses -text variant (mixed with foreground) for better text contrast
    className: 'text-[var(--info-text)] bg-info/10',
  },
  info: {
    className: 'text-muted-foreground border border-muted bg-muted/30',
  },
  system: {
    className: 'text-muted-foreground border border-muted bg-muted/30',
  },
}

/**
 * SystemMessage - Renders a styled message bubble based on type
 */
export function SystemMessage({
  content,
  type,
  className,
}: SystemMessageProps) {
  const style = MESSAGE_STYLES[type]

  return (
    <div className={cn("px-4 py-2", className)}>
      <div className={cn("text-sm px-3 py-2 rounded-md", style.className)}>
        <Markdown mode="minimal">{content}</Markdown>
      </div>
    </div>
  )
}
