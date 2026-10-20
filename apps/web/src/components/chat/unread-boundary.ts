import { hasUnseenCompletion } from "./chat-actions.logic";

/** Marks the blue New separator so the open chat can land on it. */
export const UNREAD_BOUNDARY_ATTRIBUTE = "data-unread-boundary";

export interface UnreadBoundaryMessage {
  readonly id: string;
  readonly createdAt: string;
  readonly turnId: string | null;
}

/** True for a message the reader wrote; it never counts as unread for them. */
export type IsReaderMessage<M extends UnreadBoundaryMessage> = (message: M) => boolean;

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
 * The reader's own messages are never new to them, so the line skips past them.
 */
export function firstUnseenMessageId<M extends UnreadBoundaryMessage>(
  messages: ReadonlyArray<M>,
  unreadSince: string | null,
  latestTurn: UnreadBoundaryTurn | null,
  isReaderMessage: IsReaderMessage<M> = () => false,
): string | null {
  if (!unreadSince || !hasUnseenCompletion(latestTurn?.completedAt, unreadSince)) {
    return null;
  }

  const visitedMs = Date.parse(unreadSince);

  if (Number.isNaN(visitedMs)) return null;

  for (const message of messages) {
    if (isReaderMessage(message)) continue;

    const createdMs = Date.parse(message.createdAt);

    if (!Number.isNaN(createdMs) && createdMs > visitedMs) {
      return message.id;
    }
  }

  if (!latestTurn) return null;

  const completedMs = latestTurn.completedAt ? Date.parse(latestTurn.completedAt) : Number.NaN;

  const markUnreadRewind =
    !Number.isNaN(completedMs) && visitedMs < completedMs && completedMs - visitedMs <= 1;

  if (!markUnreadRewind) return null;

  if (latestTurn.assistantMessageId !== null) {
    const assistant = messages.find((message) => message.id === latestTurn.assistantMessageId);

    if (assistant) return assistant.id;
  }

  return (
    messages.find((message) => message.turnId === latestTurn.turnId && !isReaderMessage(message))
      ?.id ?? null
  );
}

type OpenCapture = {
  threadKey: string;
  unreadSince: string | null;
  settled: boolean;
  holders: number;
};

let capture: OpenCapture | null = null;

let releaseTimer: ReturnType<typeof setTimeout> | null = null;

let hiddenAtMs: number | null = null;

/** Remember the moment the open chat left view, keeping the earliest hide. */
export function noteChatHidden(atMs: number): void {
  if (!Number.isFinite(atMs)) return;

  if (hiddenAtMs === null || atMs < hiddenAtMs) hiddenAtMs = atMs;
}

/**
 * A reply that finished while the chat was hidden becomes the New line when
 * the reader comes back. An unread boundary from opening the chat stays put.
 */
export function noteChatShown(threadKey: string, completedAt: string | null): string | null {
  const hidden = hiddenAtMs;

  hiddenAtMs = null;

  if (capture?.threadKey === threadKey && capture.settled && capture.unreadSince !== null) {
    return capture.unreadSince;
  }

  const completedMs = completedAt ? Date.parse(completedAt) : Number.NaN;

  const missedWhileHidden = hidden !== null && !Number.isNaN(completedMs) && completedMs > hidden;

  if (!missedWhileHidden) {
    return capture?.threadKey === threadKey && capture.settled ? capture.unreadSince : null;
  }

  const unreadSince = new Date(hidden).toISOString();

  capture = {
    threadKey,
    unreadSince,
    settled: true,
    holders: capture?.threadKey === threadKey ? capture.holders : 0,
  };

  return unreadSince;
}

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

    if (capture.holders > 0) capture.holders -= 1;

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
  hiddenAtMs = null;
}
