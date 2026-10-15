import { PLACEHOLDER_THREAD_TITLE, type ScopedThreadRef } from "@otto/contracts";
import { Predicate } from "effect";
import { useCallback, useRef } from "react";

import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";

/**
 * Otto: A chat started without a title takes its first message's. Call the result after a send
 * starts its turn; a quick second send keeps the title the first one asked for.
 */
export function usePlaceholderTitle(
  threadRef: ScopedThreadRef | null,
  shellTitle: string | undefined,
) {
  const updateMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });

  const titledChatIdRef = useRef<string | null>(null);

  return useCallback(
    (title: string) => {
      if (
        threadRef === null ||
        shellTitle !== PLACEHOLDER_THREAD_TITLE ||
        titledChatIdRef.current === threadRef.threadId
      ) {
        return;
      }

      const titledChatId = threadRef.threadId;
      titledChatIdRef.current = titledChatId;
      // Best effort: the turn already started, so a failed rename only keeps the placeholder,
      // and the next send may try again.
      void updateMetadata({
        environmentId: threadRef.environmentId,
        input: { threadId: titledChatId, title },
      }).then((result) => {
        if (Predicate.isTagged(result, "Failure") && titledChatIdRef.current === titledChatId) {
          titledChatIdRef.current = null;
        }
      });
    },
    [shellTitle, threadRef, updateMetadata],
  );
}
