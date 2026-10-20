import { BotId } from "@otto/contracts";
import { describe, expect, it } from "vite-plus/test";

import { selectOpenBotInboxItems, type BotInboxItem } from "./bot-inbox.js";

function incident(overrides: Partial<BotInboxItem> = {}): BotInboxItem {
  return {
    id: "incident-1",
    incidentKey: "connector:anthropic:bot-1",
    kind: "connector-failure",
    status: "open",
    botId: BotId.make("bot-1"),
    botName: "Otto",
    taskOrRoutine: "Provider access",
    lastFailure: "The request failed.",
    nextAction: "Reconnect the provider.",
    firstSeenAt: "2026-08-30T10:00:00.000Z",
    lastSeenAt: "2026-08-30T10:00:00.000Z",
    occurrenceCount: 1,
    ...overrides,
  };
}

describe("selectOpenBotInboxItems", () => {
  it("filters resolved and unrelated bot items, then sorts newest first", () => {
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

  it("keeps a silence item in the chat it names, and out of a chat with no thread", () => {
    const silence = incident({
      id: "quiet",
      incidentKey: "silence:thread-1:turn-1",
      kind: "silence-watchdog-failure",
    });

    const connector = incident({ id: "connector" });

    expect(
      selectOpenBotInboxItems([silence, connector], new Set(["bot-1"]), "thread-1").map(
        (item) => item.id,
      ),
    ).toEqual(["quiet", "connector"]);
    expect(
      selectOpenBotInboxItems([silence, connector], new Set(["bot-1"]), "thread-2").map(
        (item) => item.id,
      ),
    ).toEqual(["connector"]);
    expect(
      selectOpenBotInboxItems([silence, connector], new Set(["bot-1"]), null).map(
        (item) => item.id,
      ),
    ).toEqual(["connector"]);
  });
});
