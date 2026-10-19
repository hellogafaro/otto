import { selectOpenBotInboxItems } from "@otto/client-runtime/bot-inbox";
import { BotId, type SubscriptionAuthStatuses } from "@otto/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { BotInboxAlerts } from "./bot-inbox-alerts";

type BotInboxItem = SubscriptionAuthStatuses["inbox"][number];

function incident(overrides: Partial<BotInboxItem> = {}): BotInboxItem {
  return {
    id: "incident-1",
    incidentKey: "connector:claude:bot-1",
    kind: "connector-failure",
    status: "open",
    botId: BotId.make("bot-1"),
    botName: "Otto",
    taskOrRoutine: "Research brief",
    lastFailure: "Claude rejected the request.",
    nextAction: "Reconnect Claude in Settings.",
    firstSeenAt: "2026-08-30T10:00:00.000Z",
    lastSeenAt: "2026-08-30T10:00:00.000Z",
    occurrenceCount: 1,
    ...overrides,
  };
}

describe("bot inbox alerts", () => {
  it("shows only open incidents for the visible bots, newest first", () => {
    const selected = selectOpenBotInboxItems(
      [
        incident({ id: "older" }),
        incident({ id: "resolved", status: "resolved" }),
        incident({ id: "other", botId: BotId.make("bot-2") }),
        incident({ id: "newer", lastSeenAt: "2026-08-30T11:00:00.000Z" }),
      ],
      new Set(["bot-1"]),
    );

    expect(selected.map((item) => item.id)).toEqual(["newer", "older"]);
  });

  it("renders the incident as a chat alert: what failed, what happens next, the error", () => {
    const markup = renderToStaticMarkup(
      <BotInboxAlerts
        items={[incident({ lastFailure: "Claude stopped answering." })]}
        environmentId={null}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Provider connection failed");
    expect(markup).toContain("Reconnect Claude in Settings.");
    expect(markup).toContain("Claude stopped answering.");
    expect(markup).not.toContain("Research brief");
  });

  it("leaves approval requests to the inline approval card", () => {
    const markup = renderToStaticMarkup(
      <BotInboxAlerts
        environmentId={null}
        items={[
          incident({
            kind: "approval-request",
            lastFailure: "Allow Shell?",
            nextAction: "Open the thread and approve or decline the request.",
          }),
        ]}
      />,
    );

    expect(markup).toBe("");
  });

  it("leaves routine failures in the inbox instead of blocking chat", () => {
    const markup = renderToStaticMarkup(
      <BotInboxAlerts items={[incident({ kind: "routine-failure" })]} environmentId={null} />,
    );

    expect(markup).toBe("");
  });
});
