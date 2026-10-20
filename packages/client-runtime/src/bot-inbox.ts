import type { SubscriptionAuthStatuses } from "@otto/contracts";

import type { MessageKey } from "./i18n/index.ts";

export type BotInboxItem = SubscriptionAuthStatuses["inbox"][number];

/** A silence item belongs to one chat. `null` means this chat has no server thread yet. */
export function botInboxItemInThread(item: BotInboxItem, threadId: string | null): boolean {
  if (item.kind !== "silence-watchdog-failure") return true;

  if (threadId === null) return false;

  return item.incidentKey.startsWith(`silence:${threadId}:`);
}

export function selectOpenBotInboxItems(
  inbox: ReadonlyArray<BotInboxItem>,
  botIds?: ReadonlySet<string>,
  threadId?: string | null,
): ReadonlyArray<BotInboxItem> {
  // .sort() on a copy, not .toSorted(): Hermes lacks ES2023 change-by-copy.
  return [...inbox]
    .filter(
      (item) =>
        item.status === "open" &&
        (botIds === undefined || botIds.has(item.botId)) &&
        (threadId === undefined || botInboxItemInThread(item, threadId)),
    )
    .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
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
