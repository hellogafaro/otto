import type { SubscriptionAuthStatuses } from "@otto/contracts";

import type { MessageKey, TranslationParams } from "./i18n/index.ts";

export type BotInboxItem = SubscriptionAuthStatuses["inbox"][number];

export function selectOpenBotInboxItems(
  inbox: ReadonlyArray<BotInboxItem>,
  botIds?: ReadonlySet<string>,
): ReadonlyArray<BotInboxItem> {
  // .sort() on a copy, not .toSorted(): Hermes lacks ES2023 change-by-copy.
  return [...inbox]
    .filter((item) => item.status === "open" && (botIds === undefined || botIds.has(item.botId)))
    .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
}

export type BotInboxRepairDestination = "providers" | "plugins";

export type BotInboxRowAction = BotInboxRepairDestination | "resolve";

/**
 * Where a user repairs an incident whose dependency must recover before the server closes
 * it. MCP access lives in Plugins; other connector and access failures live in Providers.
 */
export function botInboxRepairDestination(item: BotInboxItem): BotInboxRepairDestination | null {
  if (item.incidentKey.startsWith("access:mcp-")) return "plugins";

  if (item.incidentKey.startsWith("connector:") || item.incidentKey.startsWith("access:")) {
    return "providers";
  }

  return null;
}

/**
 * The one control an open inbox row offers. Repairable incidents link to their fix; everything
 * else can be resolved by hand.
 */
export function botInboxRowAction(item: BotInboxItem): BotInboxRowAction {
  return botInboxRepairDestination(item) ?? "resolve";
}

export function botInboxKindLabel(kind: BotInboxItem["kind"]): MessageKey {
  switch (kind) {
    case "silence-watchdog-failure":
      return "Bot stopped responding";
    case "approval-request":
      return "Approval needed";
    case "routine-failure":
      return "Routine failed";
    case "oauth-expired":
      return "Provider sign-in expired";
    case "connector-failure":
      return "Provider connection failed";
  }
}

/** The kind label, detail and next step an inbox row shows. */
export function botInboxItemCopy(
  item: BotInboxItem,
  t: (message: MessageKey, params?: TranslationParams) => string,
) {
  return {
    kind: t(botInboxKindLabel(item.kind)),
    detail: item.lastFailure,
    nextAction: item.nextAction,
  };
}
