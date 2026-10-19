import { scopedThreadKey } from "@otto/client-runtime/environment";
import type { ScopedThreadRef } from "@otto/contracts";
import { useEffect } from "react";

import { useUiStateStore } from "../../ui-state-store";
import {
  noteChatHidden,
  noteChatShown,
  readOpenChatUnreadSince,
  retainOpenChatUnreadSince,
} from "./unread-boundary";

/**
 * The visit time from before this chat marked itself read, or null when the
 * open was already seen. Captured during render, before the visit effect.
 * A reply that finishes while the window is hidden becomes the New line when
 * the reader comes back, without moving a line already drawn for this open.
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

    const release = retainOpenChatUnreadSince(threadKey);

    const onViewChange = () => {
      const visible = document.visibilityState === "visible" && document.hasFocus();

      if (!visible) {
        noteChatHidden(Date.now());

        return;
      }

      noteChatShown(threadKey, completedAt);
    };

    document.addEventListener("visibilitychange", onViewChange);
    window.addEventListener("focus", onViewChange);
    window.addEventListener("blur", onViewChange);

    return () => {
      document.removeEventListener("visibilitychange", onViewChange);
      window.removeEventListener("focus", onViewChange);
      window.removeEventListener("blur", onViewChange);
      release();
    };
  }, [completedAt, threadKey]);

  return unreadSince;
}
