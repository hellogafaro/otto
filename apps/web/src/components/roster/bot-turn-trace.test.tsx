import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { BotTurnTrace } from "./bot-turn-trace";

const NOW = new Date("2026-10-20T10:00:00.000Z");

const trace = {
  workedMs: 123_000,
  steps: [{ kind: "thought", id: "t1:thought:reply", durationMs: 5_000 }],
} as const;

describe("group clock header", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("names the bot and the group's total at the name's weight, muted", () => {
    const markup = renderToStaticMarkup(
      <BotTurnTrace trace={trace} environmentId={null} name="Cody" />,
    );

    expect(markup).toContain("Worked for 2m 3s");
    expect(markup).toContain("text-sm font-medium");
    expect(markup).not.toContain("bot-group-clock-live");
  });

  it("shimmers and counts on from the group's earlier work while the bot works", () => {
    const markup = renderToStaticMarkup(
      <BotTurnTrace
        trace={trace}
        environmentId={null}
        name="Cody"
        live={{ startedAt: NOW.getTime() - 10_000, baseMs: 123_000 }}
      />,
    );

    expect(markup).toContain("Working for 2m 13s");
    expect(markup).toContain("bot-group-clock-live");
  });

  it("shows a live clock before the group's work has any steps", () => {
    const markup = renderToStaticMarkup(
      <BotTurnTrace
        trace={undefined}
        environmentId={null}
        name="Cody"
        live={{ startedAt: NOW.getTime() - 4_000, baseMs: 0 }}
      />,
    );

    expect(markup).toContain("Working for 4s");
  });
});
