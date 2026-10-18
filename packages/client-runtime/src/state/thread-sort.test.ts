import { describe, expect, it } from "vite-plus/test";

import {
  compareThreadActivity,
  planPinnedMove,
  sortPinnedThreadsByOrderKey,
  sortThreads,
  type ThreadActivityInput,
  type ThreadSortInput,
} from "./thread-sort.ts";

type TestThread = { readonly id: string } & ThreadSortInput;

function makeThread(overrides: Partial<TestThread> = {}): TestThread {
  return {
    id: "thread-1",
    createdAt: "2026-03-09T10:00:00.000Z",
    updatedAt: "2026-03-09T10:00:00.000Z",
    messages: [],
    latestUserMessageAt: null,
    ...overrides,
  };
}

describe("sortThreads", () => {
  it("falls back to updatedAt and createdAt when latestUserMessageAt is invalid and there are no messages", () => {
    const sorted = sortThreads(
      [
        makeThread({
          id: "thread-1",
          latestUserMessageAt: "not-a-date",
          createdAt: "2026-03-09T10:00:00.000Z",
          updatedAt: "2026-03-09T10:05:00.000Z",
        }),
        makeThread({
          id: "thread-2",
          latestUserMessageAt: "still-not-a-date",
          createdAt: "invalid-created-at",
          updatedAt: "invalid-updated-at",
        }),
        makeThread({
          id: "thread-3",
          latestUserMessageAt: "invalid-latest-user-message-at",
          createdAt: "2026-03-09T10:06:00.000Z",
          updatedAt: "invalid-updated-at",
        }),
      ],
      "updated_at",
    );

    expect(sorted.map((thread) => thread.id)).toEqual(["thread-3", "thread-1", "thread-2"]);
  });

  it("falls back to the latest valid user message when latestUserMessageAt is invalid", () => {
    const sorted = sortThreads(
      [
        makeThread({
          id: "thread-1",
          latestUserMessageAt: "invalid-latest-user-message-at",
          updatedAt: "2026-03-09T10:00:00.000Z",
          messages: [
            { role: "user", createdAt: "2026-03-09T10:05:00.000Z" },
            { role: "assistant", createdAt: "2026-03-09T10:30:00.000Z" },
            { role: "user", createdAt: "2026-03-09T10:20:00.000Z" },
          ],
        }),
        makeThread({
          id: "thread-2",
          createdAt: "2026-03-09T10:15:00.000Z",
          updatedAt: "2026-03-09T10:15:00.000Z",
        }),
      ],
      "updated_at",
    );

    expect(sorted.map((thread) => thread.id)).toEqual(["thread-1", "thread-2"]);
  });
});

describe("planPinnedMove", () => {
  it("moves a thread up with a single key write", () => {
    const assignments = planPinnedMove({
      orderedIds: ["a", "b", "c"],
      keysById: new Map([
        ["a", "f"],
        ["b", "m"],
        ["c", "t"],
      ]),
      movedId: "c",
      direction: "up",
    });

    expect(assignments).toHaveLength(1);
    expect(assignments![0]!.id).toBe("c");
    expect(assignments![0]!.orderKey > "f" && assignments![0]!.orderKey < "m").toBe(true);
  });

  it("returns null when the move falls off the end of the list", () => {
    const input = {
      orderedIds: ["a", "b"],
      keysById: new Map([
        ["a", "f"],
        ["b", "m"],
      ]),
    };

    expect(planPinnedMove({ ...input, movedId: "a", direction: "up" })).toBeNull();
    expect(planPinnedMove({ ...input, movedId: "b", direction: "down" })).toBeNull();
  });

  it("materializes keys for the whole section when a neighbor is keyless", () => {
    const assignments = planPinnedMove({
      orderedIds: ["a", "b", "c"],
      keysById: new Map([
        ["a", null],
        ["b", "m"],
        ["c", null],
      ]),
      movedId: "b",
      direction: "up",
    });

    expect(assignments).not.toBeNull();
    const keys = assignments!.map((entry) => entry.orderKey);
    expect([...keys].sort()).toEqual(keys);
  });
});

describe("sortPinnedThreadsByOrderKey", () => {
  it("breaks equal keys by id THEN environment so merged lists are stable everywhere", () => {
    const sorted = sortPinnedThreadsByOrderKey([
      {
        id: "thread-1",
        createdAt: "2026-03-09T10:00:00.000Z",
        pinOrderKey: "m",
        environmentId: "env-b",
      },
      {
        id: "thread-1",
        createdAt: "2026-03-09T11:00:00.000Z",
        pinOrderKey: "m",
        environmentId: "env-a",
      },
    ]);

    expect(sorted.map((thread) => thread.environmentId)).toEqual(["env-a", "env-b"]);
  });
});

describe("compareThreadActivity", () => {
  const chat = (id: string, overrides: Partial<ThreadActivityInput> = {}): ThreadActivityInput => ({
    id,
    createdAt: "2026-03-09T10:00:00.000Z",
    latestUserMessageAt: null,
    latestTurn: null,
    ...overrides,
  });

  const order = (chats: ThreadActivityInput[]) =>
    chats.toSorted(compareThreadActivity).map((thread) => thread.id);

  it("keeps a chat in place while its turn runs, then moves it up when the turn settles", () => {
    const working = chat("working", {
      latestUserMessageAt: "2026-03-09T10:01:00.000Z",
      latestTurn: {
        state: "running",
        requestedAt: "2026-03-09T10:01:00.000Z",
        completedAt: "2026-03-09T10:09:00.000Z",
      },
    });

    const newer = chat("newer", { latestUserMessageAt: "2026-03-09T10:02:00.000Z" });

    expect(order([working, newer])).toEqual(["newer", "working"]);

    const settled = {
      ...working,
      latestTurn: { ...working.latestTurn!, state: "completed" as const },
    };

    expect(order([settled, newer])).toEqual(["working", "newer"]);
  });

  it("moves a chat up when a person sends a message", () => {
    const idle = chat("idle", { latestUserMessageAt: "2026-03-09T10:05:00.000Z" });

    const finished = chat("finished", {
      latestTurn: {
        state: "completed",
        requestedAt: "2026-03-09T10:01:00.000Z",
        completedAt: "2026-03-09T10:04:00.000Z",
      },
    });

    expect(order([finished, idle])).toEqual(["idle", "finished"]);
  });

  it("falls back to creation time and breaks ties on id", () => {
    expect(
      order([chat("a"), chat("b"), chat("c", { createdAt: "2026-03-09T11:00:00.000Z" })]),
    ).toEqual(["c", "b", "a"]);
  });
});
