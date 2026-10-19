import { describe, expect, it } from "vite-plus/test";

import { reasoningActivityText } from "./events.ts";

describe("reasoningActivityText", () => {
  it("keeps a reasoning delta so a thinking provider still counts as alive", () => {
    expect(
      reasoningActivityText({
        type: "reasoning-delta",
        id: "msg-1",
        delta: "still thinking",
      } as never),
    ).toBe("still thinking");
  });

  it("ignores an empty reasoning delta", () => {
    expect(
      reasoningActivityText({
        type: "reasoning-delta",
        id: "msg-1",
        delta: "",
      } as never),
    ).toBeUndefined();
  });

  it("pulses once for a reasoning part snapshot", () => {
    expect(
      reasoningActivityText({
        type: "part",
        id: "msg-1",
        index: 0,
        part: { type: "reasoning", reasoning: "a long thought" },
      } as never),
    ).toBe(" ");
  });

  it("does not treat assistant text as thinking", () => {
    expect(
      reasoningActivityText({
        type: "text-delta",
        id: "msg-1",
        delta: "hello",
      } as never),
    ).toBeUndefined();
  });
});
