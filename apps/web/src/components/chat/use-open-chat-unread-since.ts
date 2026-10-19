import { scopedThreadKey } from "@otto/client-runtime/environment";
import type { ScopedThreadRef } from "@otto/contracts";
import { useEffect } from "react";

import { useUiStateStore } from "../../ui-state-store";
import { readOpenChatUnreadSince, retainOpenChatUnreadSince } from "./unread-boundary";

/**
 * The visit time from before this chat marked itself read, or null when the
 * open was already seen. Captured during render, before the visit effect.
 */
export function useOpenChatUnreadSince(
  threadRef: ScopedThreadRef | null,
  completedAt: string | null,
): string | null {
  const threadKey = threadRef ? scopedThreadKey(threadRef) : null;

  const lastVisitedAt = useUiStateStore((state) =>
    threadKey ? state.threadLastVisitedAtById[threadKey] : undefined,
  );

  const unreadSince =
    threadKey === null
      ? null
      : readOpenChatUnreadSince(threadKey, lastVisitedAt, completedAt, true);

  useEffect(() => {
    if (!threadKey) return;

    return retainOpenChatUnreadSince(threadKey);
  }, [threadKey]);

  return unreadSince;
}
