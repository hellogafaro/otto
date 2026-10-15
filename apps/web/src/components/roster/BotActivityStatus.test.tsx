import { ProviderDriverKind } from "@otto/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { BotActivityStatus, THINKING_VERBS } from "./BotActivityStatus";

const NOW = new Date("2026-09-15T18:00:00.000Z");

const bot = { name: "Otto", avatar: { kind: "blob", shape: "circle", color: "#5B7FD4" } } as const;

const secondsAgo = (seconds: number) => new Date(NOW.getTime() - seconds * 1000).toISOString();

describe("bot activity status", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the bot's awake avatar and what the run is doing", () => {
    const markup = renderToStaticMarkup(
      <BotActivityStatus
        bot={bot}
        activity={{ label: "Reading a skill" }}
        startedAt={secondsAgo(2)}
      />,
    );

    expect(markup).toContain('data-bot-state="working"');
    expect(markup).toContain("Reading a skill");
    expect(markup).not.toContain("...");
    expect(markup).toContain("bot-shimmer-text");
    expect(markup).not.toContain("animate-spin");
    expect(markup).not.toContain("<button");
  });

  it("shows a bot queued behind another as still and waiting, without a timer", () => {
    const markup = renderToStaticMarkup(
      <BotActivityStatus
        bot={bot}
        activity={{ label: "Reading a skill" }}
        startedAt={null}
        waiting
      />,
    );

    expect(markup).toContain('data-bot-state="idle"');
    expect(markup).toContain("Waiting to reply");
    expect(markup).not.toContain("bot-shimmer-text");
    expect(markup).not.toContain("bot-activity-time");
  });

  it("names the app or MCP server a tool works on once its name is known", () => {
    const app = {
      label: "Using an app",
      subject: { kind: "app", slug: "googlecalendar" },
    } as const;

    expect(
      renderToStaticMarkup(
        <BotActivityStatus
          bot={bot}
          activity={app}
          startedAt={null}
          subjectName="Google Calendar"
        />,
      ),
    ).toContain(">Using Google Calendar<");
    expect(
      renderToStaticMarkup(<BotActivityStatus bot={bot} activity={app} startedAt={null} />),
    ).toContain(">Using an app<");
  });

  it("rotates playful verbs while the bot only thinks", () => {
    const markup = renderToStaticMarkup(
      <BotActivityStatus
        bot={bot}
        activity={{ label: "Working", thinking: true }}
        startedAt={null}
      />,
    );

    expect(THINKING_VERBS.some((verb) => markup.includes(`>${verb}<`))).toBe(true);
    expect(markup).not.toContain("...");
  });

  it("shows its own elapsed time only after ten seconds", () => {
    const early = renderToStaticMarkup(
      <BotActivityStatus
        bot={bot}
        activity={{ label: "Reading files" }}
        startedAt={secondsAgo(4)}
      />,
    );

    const later = renderToStaticMarkup(
      <BotActivityStatus
        bot={bot}
        activity={{ label: "Reading files" }}
        startedAt={secondsAgo(75)}
      />,
    );

    expect(early).toMatch(/hidden=""[^>]*data-testid="bot-activity-time"/);
    expect(later).toContain('data-testid="bot-activity-time">1m 15s');
    expect(later).not.toMatch(/hidden=""[^>]*data-testid="bot-activity-time"/);
  });

  it("replaces the activity with a silent-run notice", () => {
    const markup = renderToStaticMarkup(
      <BotActivityStatus
        bot={bot}
        activity={{ label: "Running a command" }}
        startedAt={secondsAgo(300)}
        silentRun={{
          provider: ProviderDriverKind.make("kimi"),
          providerName: "Kimi For Coding",
          lastActivityAt: secondsAgo(120),
        }}
      />,
    );

    expect(markup).toContain("data-silent-run");
    expect(markup).toContain("No response from Kimi For Coding");
    expect(markup).toContain('data-testid="response-loading-time">2m');
    expect(markup).not.toContain("Running a command");
  });
});
