import type { OrchestrationMessageReaction } from "@otto/contracts";

import { useI18n } from "~/i18n";
import { cn } from "~/lib/utils";
import { reactionOptionFromEmoji } from "./message-controls";

/**
 * Applied reactions under a message. When the caller passes `onToggle`, the chip the
 * current person owns becomes a button that removes it again, so a reaction is never a
 * one-way door for anyone who cannot reach the hover picker.
 *
 * A stored emoji this client cannot send back — one from another client, or from an older
 * option set — stays plain text. Offering a button that cannot act would be a dead control.
 */
export function MessageReactions({
  reactions,
  selectedEmoji = null,
  align = "start",
  onToggle,
}: {
  readonly reactions: ReadonlyArray<OrchestrationMessageReaction>;
  readonly selectedEmoji?: string | null;
  readonly align?: "start" | "end";
  readonly onToggle?: (emoji: string) => void;
}) {
  const { t } = useI18n();
  const counts = new Map<string, number>();

  for (const reaction of reactions) {
    counts.set(reaction.emoji, (counts.get(reaction.emoji) ?? 0) + 1);
  }

  if (counts.size === 0) return null;

  return (
    <div
      className={cn("mt-1 flex flex-wrap gap-1", align === "end" && "justify-end")}
      data-testid="message-reactions"
    >
      {[...counts].map(([emoji, count]) => {
        const mine = selectedEmoji === emoji;

        const label = (
          <>
            {emoji}
            {count > 1 ? (
              <span className="font-sans text-xs font-medium text-muted-foreground">{count}</span>
            ) : null}
          </>
        );

        // Otto: A 24px pill at body size, like the message toolbar; yours is a shade filled.
        const className = cn(
          "inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-sm leading-none font-emoji",
          mine ? "border-foreground/16 bg-foreground/8" : "border-border/70",
        );

        if (!onToggle || reactionOptionFromEmoji(emoji) === null) {
          return (
            <span className={className} data-reaction-emoji={emoji} key={emoji}>
              {label}
            </span>
          );
        }

        return (
          <button
            aria-label={
              mine ? t("Remove your {emoji} reaction", { emoji }) : t("React {emoji}", { emoji })
            }
            aria-pressed={mine}
            className={cn(
              className,
              "cursor-pointer transition-colors hover:bg-foreground/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
            data-reaction-emoji={emoji}
            key={emoji}
            onClick={() => onToggle(emoji)}
            type="button"
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
