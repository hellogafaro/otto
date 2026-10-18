/**
 * Marks where a conversation resumes after a break: a new day, or a long enough gap
 * that the next message belongs to a new sitting. Rendered as a faint wavy rule, like
 * Claude's, so it reads as punctuation between turns rather than as a message of its own.
 */
export function ConversationSeparator({ label }: { readonly label: string }) {
  return (
    <div
      className="mt-4 mb-1 flex items-center gap-3 first:mt-0"
      data-testid="conversation-separator"
      role="separator"
      aria-label={label}
    >
      <span aria-hidden="true" className="wavy-rule h-1.5 min-w-4 flex-1 text-border" />
      <span className="shrink-0 text-xs text-muted-foreground/70 tabular-nums">{label}</span>
      <span aria-hidden="true" className="wavy-rule h-1.5 min-w-4 flex-1 text-border" />
    </div>
  );
}
