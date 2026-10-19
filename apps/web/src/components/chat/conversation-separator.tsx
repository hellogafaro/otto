import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";
import { UNREAD_BOUNDARY_ATTRIBUTE } from "./unread-boundary";

/**
 * Marks where a conversation resumes after a break: a new day, or a long enough gap
 * that the next message belongs to a new sitting. Rendered as a faint wavy rule, like
 * Claude's, so it reads as punctuation between turns rather than as a message of its own.
 *
 * The wave is the shared `wavy-rule`. `secondary` keeps the day-divider treatment.
 * `primary` paints that same wave and the label in the primary accent.
 */
const conversationSeparatorRuleVariants = cva("wavy-rule h-1.5 min-w-4 flex-1", {
  defaultVariants: {
    variant: "secondary",
  },
  variants: {
    variant: {
      primary: "text-primary",
      secondary: "text-border",
    },
  },
});

const conversationSeparatorLabelVariants = cva("shrink-0 text-xs tabular-nums", {
  defaultVariants: {
    variant: "secondary",
  },
  variants: {
    variant: {
      primary: "text-primary",
      secondary: "text-muted-foreground/70",
    },
  },
});

type ConversationSeparatorVariant = NonNullable<
  VariantProps<typeof conversationSeparatorRuleVariants>["variant"]
>;

export function ConversationSeparator({
  label,
  variant = "secondary",
  boundaryId,
}: {
  readonly label: string;
  readonly variant?: ConversationSeparatorVariant;
  /** Set on the blue New mark so the open chat can land on that message. */
  readonly boundaryId?: string;
}) {
  return (
    <div
      className="mt-4 mb-1 flex items-center gap-3 first:mt-0"
      data-testid="conversation-separator"
      data-variant={variant}
      {...(boundaryId ? { [UNREAD_BOUNDARY_ATTRIBUTE]: boundaryId } : {})}
      role="separator"
      aria-label={label}
    >
      <span aria-hidden="true" className={cn(conversationSeparatorRuleVariants({ variant }))} />
      <span className={cn(conversationSeparatorLabelVariants({ variant }))}>{label}</span>
      <span aria-hidden="true" className={cn(conversationSeparatorRuleVariants({ variant }))} />
    </div>
  );
}

export { conversationSeparatorLabelVariants, conversationSeparatorRuleVariants };
