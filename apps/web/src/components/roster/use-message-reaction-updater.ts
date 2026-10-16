import { Predicate } from "effect";
import type { MessageId, ScopedThreadRef } from "@otto/contracts";
import { useCallback } from "react";

import { useI18n } from "~/i18n";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import type { MessageReactionOption } from "../chat/message-controls";
import { toast } from "sonner";

export type MessageReactionHandler = (
  messageId: MessageId,
  current: MessageReactionOption | null,
  next: MessageReactionOption | null,
) => void;

/** A stable reaction updater for memoized rows; it only changes with the linked thread. */
export function useMessageReactionUpdater(threadRef: ScopedThreadRef | null) {
  const { t } = useI18n();

  const setMessageReaction = useAtomCommand(threadEnvironment.setMessageReaction, {
    reportFailure: false,
  });

  return useCallback<MessageReactionHandler>(
    (messageId, current, next) => {
      if (!threadRef) return;

      const dispatch = (emoji: MessageReactionOption, present: boolean) =>
        setMessageReaction({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, messageId, emoji, present },
        });

      void (async () => {
        if (current && current !== next) {
          const removed = await dispatch(current, false);

          if (Predicate.isTagged(removed, "Failure")) {
            toast.error(t("Reaction couldn't be updated"));

            return;
          }
        }

        if (next) {
          const added = await dispatch(next, true);

          if (Predicate.isTagged(added, "Failure")) {
            toast.error(t("Reaction couldn't be updated"));
          }
        }
      })();
    },
    [setMessageReaction, t, threadRef],
  );
}
