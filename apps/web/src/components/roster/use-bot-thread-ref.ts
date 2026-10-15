import { scopeThreadRef } from "@otto/client-runtime/environment";
import type { ScopedThreadRef } from "@otto/contracts";
import { useMemo } from "react";

import { usePrimaryEnvironmentId } from "../../state/environments";
import { useLatestBotThreadId } from "../../state/entities";

/** Otto: the bot's latest chat with you, for surfaces about the bot rather than one chat. */
export function useLatestBotChatRef(botId: string): ScopedThreadRef | null {
  const environmentId = usePrimaryEnvironmentId();
  const threadId = useLatestBotThreadId(environmentId, botId);

  return useMemo(
    () => (environmentId && threadId ? scopeThreadRef(environmentId, threadId) : null),
    [environmentId, threadId],
  );
}
