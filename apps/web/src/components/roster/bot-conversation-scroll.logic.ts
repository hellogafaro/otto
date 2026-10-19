export interface ConversationScrollMetrics {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

export const CONVERSATION_END_THRESHOLD_PX = 24;

export interface ConversationFollowState {
  readonly followingEnd: boolean;
}

/**
 * `scroll` carries `movedAway` when the reader scrolled toward older messages. Other
 * scroll events come from layout (content growth, clamping, scroll anchoring) or
 * our own pinning, and must never unpin the conversation on their own.
 */
export type ConversationFollowEvent =
  | { readonly type: "user-navigation" }
  | { readonly type: "scroll-to-end" }
  | { readonly type: "scroll"; readonly isAtEnd: boolean; readonly movedAway: boolean };

export function reduceConversationFollowState(
  state: ConversationFollowState,
  event: ConversationFollowEvent,
): ConversationFollowState {
  if (event.type === "user-navigation") return { followingEnd: false };

  if (event.type === "scroll-to-end") return { followingEnd: true };

  if (event.isAtEnd) return { followingEnd: true };

  return event.movedAway ? { followingEnd: false } : state;
}

export function isConversationAtEnd(
  metrics: ConversationScrollMetrics,
  threshold = CONVERSATION_END_THRESHOLD_PX,
): boolean {
  return metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop <= threshold;
}

/**
 * Scroll offset that puts an unread marker at the top of the viewport, or null
 * when that marker is already fully visible or the row has not been laid out.
 * A short new reply stays pinned to the end; a longer one lands on the blue New line.
 */
export function isUnreadBoundaryLaidOut(
  viewport: { readonly top: number; readonly bottom: number },
  anchor: { readonly top: number; readonly bottom: number },
): boolean {
  return viewport.bottom - viewport.top >= 1 && anchor.bottom - anchor.top >= 1;
}

export function unreadBoundaryScrollTop(
  viewport: {
    readonly scrollTop: number;
    readonly top: number;
    readonly bottom: number;
  },
  anchor: { readonly top: number; readonly bottom: number },
): number | null {
  if (viewport.bottom - viewport.top < 1 || anchor.bottom - anchor.top < 1) return null;

  if (anchor.top >= viewport.top && anchor.bottom <= viewport.bottom) return null;

  return viewport.scrollTop + (anchor.top - viewport.top);
}

/**
 * True when a scroll moved toward the start while the content and viewport kept
 * their size. Wheel, drag, keyboard, and jumps to an earlier message all look like
 * this. Layout-driven scrolls (clamping after a shrink, scroll anchoring) always
 * come with a size change.
 */
export function didScrollAwayFromEnd(
  previous: ConversationScrollMetrics,
  next: ConversationScrollMetrics,
): boolean {
  return (
    next.scrollTop < previous.scrollTop - 1 &&
    next.scrollHeight === previous.scrollHeight &&
    next.clientHeight === previous.clientHeight
  );
}
