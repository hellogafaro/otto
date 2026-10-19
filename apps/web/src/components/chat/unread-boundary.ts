import { hasUnseenCompletion } from "./chat-actions.logic";

/** Marks the blue New separator so the open chat can land on it. */
export const UNREAD_BOUNDARY_ATTRIBUTE = "data-unread-boundary";

export interface UnreadBoundaryMessage {
  readonly id: string;
  readonly createdAt: string;
  readonly turnId: string | null;
}

export interface UnreadBoundaryTurn {
  readonly turnId: string;
  readonly completedAt: string | null;
  readonly assistantMessageId: string | null;
}

/**
 * First message the reader had not seen when they opened the chat.
 * `unreadSince` is the visit captured before this open recorded a new one.
 * Mark unread rewinds that visit to 1ms before the turn finished, which can
 * sit after every message in the turn, so the turn's reply is the fallback.
 */
export function firstUnseenMessageId(
  messages: ReadonlyArray<UnreadBoundaryMessage>,
  unreadSince: string | null,
  latestTurn: UnreadBoundaryTurn | null,
): string | null {
  if (!unreadSince || !hasUnseenCompletion(latestTurn?.completedAt, unreadSince)) {
    return null;
  }

  const visitedMs = Date.parse(unreadSince);

  if (Number.isNaN(visitedMs)) return null;

  for (const message of messages) {
    const createdMs = Date.parse(message.createdAt);

    if (!Number.isNaN(createdMs) && createdMs > visitedMs) {
      return message.id;
    }
  }

  if (!latestTurn) return null;

  if (latestTurn.assistantMessageId !== null) {
    const assistant = messages.find((message) => message.id === latestTurn.assistantMessageId);

    if (assistant) return assistant.id;
  }

  return messages.find((message) => message.turnId === latestTurn.turnId)?.id ?? null;
}

type OpenCapture = {
  threadKey: string;
  unreadSince: string | null;
  settled: boolean;
  holders: number;
};

let capture: OpenCapture | null = null;

let releaseTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Snapshot the visit for an open chat before the visit effect overwrites it.
 * The first settled read wins for this open, including a StrictMode remount.
 */
export function readOpenChatUnreadSince(
  threadKey: string,
  lastVisitedAt: string | undefined,
  completedAt: string | null,
  ready: boolean,
): string | null {
  if (capture?.threadKey === threadKey && capture.settled) {
    return capture.unreadSince;
  }

  if (!ready) return null;

  const unreadSince = hasUnseenCompletion(completedAt, lastVisitedAt)
    ? (lastVisitedAt ?? null)
    : null;

  capture = {
    threadKey,
    unreadSince,
    settled: true,
    holders: capture?.threadKey === threadKey ? capture.holders : 0,
  };

  return unreadSince;
}

/** Keep the snapshot across the StrictMode unmount/remount gap. */
export function retainOpenChatUnreadSince(threadKey: string): () => void {
  if (releaseTimer !== null) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }

  if (capture?.threadKey === threadKey) {
    capture.holders += 1;
  }

  return () => {
    if (capture?.threadKey !== threadKey) return;
    capture.holders -= 1;

    if (capture.holders > 0) return;

    const snapshot = capture;

    releaseTimer = setTimeout(() => {
      releaseTimer = null;

      if (capture === snapshot && capture.holders <= 0) {
        capture = null;
      }
    }, 0);
  };
}

export function resetOpenChatUnreadSinceForTests(): void {
  if (releaseTimer !== null) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }

  capture = null;
}
