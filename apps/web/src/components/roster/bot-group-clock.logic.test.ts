import { describe, expect, it } from "vite-plus/test";

import { buildGroupClocks, lastGroupHead, liveGroupClock } from "./bot-group-clock.logic";
import type { BotTurnTrace } from "./bot-turn-trace.logic";

const entry = (
  id: string,
  role: "user" | "assistant",
  turnId: string | null,
  startsGroup: boolean,
) => ({
  message: { id, role, turnId },
  startsGroup,
});

const trace = (workedMs: number): BotTurnTrace => ({
  workedMs,
  steps: [{ kind: "thought", id: "thought:reply", durationMs: workedMs }],
});

describe("buildGroupClocks", () => {
  const traces = new Map([
    ["t1", trace(12_000)],
    ["t2", trace(30_000)],
    ["t3", trace(5_000)],
  ]);

  it("adds up every turn in a group on its first reply", () => {
    const clocks = buildGroupClocks(
      [
        entry("ask", "user", null, true),
        entry("a", "assistant", "t1", true),
        entry("b", "assistant", "t1", false),
        entry("c", "assistant", "t2", false),
      ],
      traces,
    );

    expect([...clocks.keys()]).toEqual(["a"]);
    expect(clocks.get("a")?.workedMs).toBe(42_000);
    expect(clocks.get("a")?.steps.map((step) => step.id)).toEqual([
      "t1:thought:reply",
      "t2:thought:reply",
    ]);
  });

  it("starts a new clock after someone writes", () => {
    const clocks = buildGroupClocks(
      [
        entry("a", "assistant", "t1", true),
        entry("ask", "user", null, true),
        entry("b", "assistant", "t3", true),
      ],
      traces,
    );

    expect(clocks.get("a")?.workedMs).toBe(12_000);
    expect(clocks.get("b")?.workedMs).toBe(5_000);
  });

  it("leaves the running turn to the live header", () => {
    const clocks = buildGroupClocks(
      [entry("a", "assistant", "t1", true), entry("b", "assistant", "t2", false)],
      traces,
      "t2",
    );

    expect(clocks.get("a")?.workedMs).toBe(12_000);
  });
});

describe("lastGroupHead", () => {
  it("finds the first reply of a trailing bot group", () => {
    expect(
      lastGroupHead([
        entry("ask", "user", null, true),
        entry("a", "assistant", "t1", true),
        entry("b", "assistant", "t2", false),
      ]),
    ).toBe("a");
  });

  it("is null when a person wrote last", () => {
    expect(
      lastGroupHead([entry("a", "assistant", "t1", true), entry("ask", "user", null, true)]),
    ).toBeNull();
  });
});

describe("liveGroupClock", () => {
  const traces = new Map([["t1", trace(12_000)]]);

  const running = {
    turnId: "t2",
    state: "running",
    startedAt: "2026-10-20T10:00:00.000Z",
    requestedAt: "2026-10-20T09:59:59.000Z",
  };

  it("counts a continuation on from the group's earlier work", () => {
    const live = liveGroupClock({
      entries: [
        entry("ask", "user", null, true),
        entry("a", "assistant", "t1", true),
        entry("b", "assistant", "t2", false),
      ],
      traces,
      turn: running,
    });

    expect(live).toEqual({
      headId: "a",
      clock: { startedAt: Date.parse(running.startedAt), baseMs: 12_000 },
    });
  });

  it("has no group to continue when a person wrote last", () => {
    expect(
      liveGroupClock({
        entries: [entry("a", "assistant", "t1", true), entry("ask", "user", null, true)],
        traces,
        turn: running,
      }),
    ).toBeNull();
  });

  it("is off once the turn finished", () => {
    expect(
      liveGroupClock({
        entries: [entry("a", "assistant", "t1", true)],
        traces,
        turn: { ...running, state: "completed" },
      }),
    ).toBeNull();
  });
});
