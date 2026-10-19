import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  firstUnseenMessageId,
  noteChatHidden,
  noteChatShown,
  readOpenChatUnreadSince,
  resetOpenChatUnreadSinceForTests,
  retainOpenChatUnreadSince,
  type UnreadBoundaryTurn,
} from "./unread-boundary";

const turn: UnreadBoundaryTurn = {
  turnId: "turn-1",
  completedAt: "2026-10-19T11:00:00.000Z",
  assistantMessageId: "reply",
};

const messages = [
  { id: "older", createdAt: "2026-10-19T09:00:00.000Z", turnId: null },
  { id: "ask", createdAt: "2026-10-19T10:30:00.000Z", turnId: "turn-1" },
  { id: "reply", createdAt: "2026-10-19T10:45:00.000Z", turnId: "turn-1" },
];

describe("firstUnseenMessageId", () => {
  it("marks the first message after the visit", () => {
    expect(firstUnseenMessageId(messages, "2026-10-19T10:00:00.000Z", turn)).toBe("ask");
    expect(firstUnseenMessageId(messages, "2026-10-19T10:40:00.000Z", turn)).toBe("reply");
  });

  it("returns null when the chat was already seen or never visited", () => {
    expect(firstUnseenMessageId(messages, null, turn)).toBeNull();
    expect(firstUnseenMessageId(messages, "2026-10-19T12:00:00.000Z", turn)).toBeNull();
  });

  it("skips a message whose time cannot be read", () => {
    expect(
      firstUnseenMessageId(
        [
          { id: "bad", createdAt: "nope", turnId: null },
          { id: "reply", createdAt: "2026-10-19T10:45:00.000Z", turnId: "turn-1" },
        ],
        "2026-10-19T10:00:00.000Z",
        turn,
      ),
    ).toBe("reply");
  });

  it("falls back to the turn reply when mark unread sits after every message", () => {
    expect(firstUnseenMessageId(messages, "2026-10-19T10:59:59.999Z", turn)).toBe("reply");
  });

  it("falls back to the first message of the turn when the reply is not visible", () => {
    expect(
      firstUnseenMessageId(
        messages.filter((message) => message.id !== "reply"),
        "2026-10-19T10:59:59.999Z",
        turn,
      ),
    ).toBe("ask");
  });

  it("does not mark a reply the reader already saw just because the turn finished later", () => {
    expect(firstUnseenMessageId(messages, "2026-10-19T10:50:00.000Z", turn)).toBeNull();
    expect(firstUnseenMessageId([], "2026-10-19T10:00:00.000Z", turn)).toBeNull();
  });
});

describe("open chat unread snapshot", () => {
  afterEach(() => {
    resetOpenChatUnreadSinceForTests();
    vi.useRealTimers();
  });

  it("keeps the visit from before the chat marks itself read", () => {
    expect(
      readOpenChatUnreadSince(
        "chat-1",
        "2026-10-19T10:00:00.000Z",
        "2026-10-19T11:00:00.000Z",
        true,
      ),
    ).toBe("2026-10-19T10:00:00.000Z");
    expect(
      readOpenChatUnreadSince(
        "chat-1",
        "2026-10-19T12:00:00.000Z",
        "2026-10-19T11:00:00.000Z",
        true,
      ),
    ).toBe("2026-10-19T10:00:00.000Z");
  });

  it("does not settle before the thread is ready", () => {
    expect(readOpenChatUnreadSince("chat-1", "2026-10-19T10:00:00.000Z", null, false)).toBeNull();
    expect(
      readOpenChatUnreadSince(
        "chat-1",
        "2026-10-19T10:00:00.000Z",
        "2026-10-19T11:00:00.000Z",
        true,
      ),
    ).toBe("2026-10-19T10:00:00.000Z");
  });

  it("settles a seen chat so a later completion does not grow a marker", () => {
    expect(
      readOpenChatUnreadSince(
        "chat-1",
        "2026-10-19T12:00:00.000Z",
        "2026-10-19T11:00:00.000Z",
        true,
      ),
    ).toBeNull();
    expect(
      readOpenChatUnreadSince(
        "chat-1",
        "2026-10-19T09:00:00.000Z",
        "2026-10-19T11:00:00.000Z",
        true,
      ),
    ).toBeNull();
  });

  it("replaces the snapshot when another chat opens", () => {
    readOpenChatUnreadSince("chat-1", "2026-10-19T10:00:00.000Z", "2026-10-19T11:00:00.000Z", true);
    expect(
      readOpenChatUnreadSince(
        "chat-2",
        "2026-10-19T08:00:00.000Z",
        "2026-10-19T09:00:00.000Z",
        true,
      ),
    ).toBe("2026-10-19T08:00:00.000Z");
  });

  it("survives the strict remount gap and clears after a real close", () => {
    vi.useFakeTimers();
    readOpenChatUnreadSince("chat-1", "2026-10-19T10:00:00.000Z", "2026-10-19T11:00:00.000Z", true);
    const release = retainOpenChatUnreadSince("chat-1");

    release();
    expect(
      readOpenChatUnreadSince(
        "chat-1",
        "2026-10-19T12:00:00.000Z",
        "2026-10-19T11:00:00.000Z",
        true,
      ),
    ).toBe("2026-10-19T10:00:00.000Z");

    const releaseAgain = retainOpenChatUnreadSince("chat-1");

    vi.runAllTimers();
    expect(
      readOpenChatUnreadSince(
        "chat-1",
        "2026-10-19T12:00:00.000Z",
        "2026-10-19T11:00:00.000Z",
        true,
      ),
    ).toBe("2026-10-19T10:00:00.000Z");

    releaseAgain();
    vi.runAllTimers();
    expect(
      readOpenChatUnreadSince(
        "chat-1",
        "2026-10-19T12:00:00.000Z",
        "2026-10-19T11:00:00.000Z",
        true,
      ),
    ).toBeNull();
  });

  it("draws a New line for a reply that finished while the window was hidden", () => {
    readOpenChatUnreadSince("chat-1", "2026-10-19T10:00:00.000Z", "2026-10-19T09:00:00.000Z", true);
    noteChatHidden(Date.parse("2026-10-19T10:30:00.000Z"));
    noteChatHidden(Date.parse("2026-10-19T10:40:00.000Z"));

    expect(noteChatShown("chat-1", "2026-10-19T11:00:00.000Z")).toBe("2026-10-19T10:30:00.000Z");
    expect(firstUnseenMessageId(messages, "2026-10-19T10:30:00.000Z", turn)).toBe("reply");
  });

  it("does not move a New line already drawn for this open", () => {
    readOpenChatUnreadSince("chat-1", "2026-10-19T10:00:00.000Z", "2026-10-19T11:00:00.000Z", true);
    noteChatHidden(Date.parse("2026-10-19T10:30:00.000Z"));

    expect(noteChatShown("chat-1", "2026-10-19T11:00:00.000Z")).toBe("2026-10-19T10:00:00.000Z");
  });

  it("does not let a closed chat clear the chat that replaced it", () => {
    vi.useFakeTimers();
    readOpenChatUnreadSince("chat-1", "2026-10-19T10:00:00.000Z", "2026-10-19T11:00:00.000Z", true);
    const releaseChat1 = retainOpenChatUnreadSince("chat-1");

    releaseChat1();
    readOpenChatUnreadSince("chat-2", "2026-10-19T08:00:00.000Z", "2026-10-19T09:00:00.000Z", true);
    retainOpenChatUnreadSince("chat-2");
    vi.runAllTimers();

    expect(
      readOpenChatUnreadSince(
        "chat-2",
        "2026-10-19T12:00:00.000Z",
        "2026-10-19T09:00:00.000Z",
        true,
      ),
    ).toBe("2026-10-19T08:00:00.000Z");
  });
});
