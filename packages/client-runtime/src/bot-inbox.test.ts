import { BotId } from "@otto/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  botInboxItemCopy,
  botInboxRepairDestination,
  botInboxRowAction,
  selectOpenBotInboxItems,
  type BotInboxItem,
} from "./bot-inbox.js";
import { createTranslator } from "./i18n/index.ts";

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
});

describe("botInboxItemCopy", () => {
  it("keeps the server copy for other items", () => {
    expect(botInboxItemCopy(incident(), createTranslator("en").t)).toEqual({
      kind: "Provider connection failed",
      detail: "The request failed.",
      nextAction: "Reconnect the provider.",
    });
  });
});

describe("botInboxRepairDestination", () => {
  it("opens Plugins for MCP incidents", () => {
    expect(
      botInboxRepairDestination(incident({ incidentKey: "access:mcp-builtin-exa:bot-1" })),
    ).toBe("plugins");
  });

  it.each(["connector:anthropic:bot-1", "access:cursor-acp:bot-1"])(
    "opens Providers for %s",
    (incidentKey) => {
      expect(botInboxRepairDestination(incident({ incidentKey }))).toBe("providers");
    },
  );

  it("does not add a dead action for approval requests", () => {
    expect(botInboxRepairDestination(incident({ incidentKey: "approval:req-1" }))).toBeNull();
  });
});

describe("botInboxRowAction", () => {
  it("resolves every incident without a repair destination", () => {
    for (const [incidentKey, kind] of [
      ["approval:req-1", "approval-request"],
      ["user-action:bot-1:request_box_help:login", "approval-request"],
      ["silence:bot-1", "silence-watchdog-failure"],
      ["routine:routine-1", "routine-failure"],
    ] as const) {
      expect(botInboxRowAction(incident({ incidentKey, kind }))).toBe("resolve");
    }
  });

  it("links repairable incidents to their fix instead of resolving them", () => {
    expect(botInboxRowAction(incident())).toBe("providers");
    expect(botInboxRowAction(incident({ incidentKey: "access:mcp-builtin-exa:bot-1" }))).toBe(
      "plugins",
    );
  });
});
