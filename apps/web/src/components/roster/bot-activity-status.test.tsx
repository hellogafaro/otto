import type { MessageKey } from "@otto/client-runtime/i18n";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { BotActivityStatus, THINKING_VERBS } from "./bot-activity-status";
import type { BotTraceStep } from "./bot-turn-trace.logic";

const NOW = new Date("2026-09-15T18:00:00.000Z");

const bot = { name: "Otto", avatar: { kind: "blob", shape: "circle", color: "#5B7FD4" } } as const;

const secondsAgo = (seconds: number) => new Date(NOW.getTime() - seconds * 1000).toISOString();

const step = (id: string, label: MessageKey, running: boolean): BotTraceStep => ({
  kind: "tool",
  id,
  label,
  subject: null,
  detail: null,
  durationMs: running ? null : 400,
  failed: false,
  terminal: null,
  running,
});

const render = (props: Partial<Parameters<typeof BotActivityStatus>[0]> = {}) =>
  renderToStaticMarkup(
    <BotActivityStatus
      bot={bot}
      activity={{ label: "Working", thinking: true }}
      steps={[]}
      startedAt={secondsAgo(4)}
      environmentId={null}
      {...props}
    />,
  );

describe("bot activity status", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens with the bot's working avatar and how long it has worked", () => {
    const early = render();
    const later = render({ startedAt: secondsAgo(75) });

    expect(early).toContain('data-bot-state="working"');
    expect(early).toContain("Working for 4s");
    expect(later).toContain("Working for 1m 15s");
    expect(early).not.toContain("...");
  });

  it("rotates playful verbs only before the first step", () => {
    const before = render();
    const between = render({ steps: [step("read", "Read files", false)] });

    expect(THINKING_VERBS.some((verb) => before.includes(`>${verb}<`))).toBe(true);
    expect(between).toContain(">Read files<");
    expect(between).toContain(">Thinking<");
    expect(
      THINKING_VERBS.filter((verb) => verb !== "Thinking").some((verb) =>
        between.includes(`>${verb}<`),
      ),
    ).toBe(false);
  });

  it("lists finished steps in the past tense and shimmers the running one last", () => {
    const markup = render({
      activity: { label: "Searching the web" },
      steps: [step("read", "Read files", false), step("search", "Searching the web", true)],
    });

    expect(markup.indexOf("Read files")).toBeLessThan(markup.indexOf("Searching the web"));
    expect(markup).toContain('data-status="running"');
    expect(markup.match(/Searching the web/g)).toHaveLength(1);
    expect(markup).not.toContain(">Thinking<");
  });

  it("caps the open list and scrolls inside it", () => {
    expect(render()).toContain("max-h-44 overflow-y-auto");
  });

  it("keeps the working line while the provider is quiet, never a no-response notice", () => {
    const markup = render({ activity: { label: "Running a command" }, startedAt: secondsAgo(300) });

    expect(markup).toContain("Running a command");
    expect(markup).not.toContain("No response from");
  });
});
