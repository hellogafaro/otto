import { PLACEHOLDER_THREAD_TITLE } from "@otto/contracts";

/** How many of a bot's chats its side panel lists; palette search reaches the rest. */
export const BOT_CHATS_PANEL_LIMIT = 8;

export interface BotChatRow {
  readonly threadId: string;
  /** Null for a chat still carrying the placeholder title. */
  readonly title: string | null;
  readonly updatedAt: string;
  readonly current: boolean;
  /** Opening the newest chat returns the bot to its default view. */
  readonly newest: boolean;
}

/**
 * The rows of a bot's Chats list: its newest chats, the open one marked, leaving out
 * chats pinned to the top of the sidebar. The
 * open chat stays listed even when it is older than the ones shown, so the
 * list always says where you are.
 */
export function buildBotChatRows(input: {
  readonly chats: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly updatedAt: string;
  }>;
  readonly currentThreadId: string | null;
  /** Chats pinned to the sidebar's Pins, listed there instead. */
  readonly pinnedIds?: ReadonlySet<string>;
  readonly limit?: number;
}): BotChatRow[] {
  const limit = input.limit ?? BOT_CHATS_PANEL_LIMIT;
  const newestId = input.chats[0]?.id ?? null;
  const listed = input.chats.filter((chat) => !input.pinnedIds?.has(chat.id));
  const shown = listed.slice(0, limit);
  const current = listed.find((chat) => chat.id === input.currentThreadId);

  if (current && !shown.includes(current)) shown.splice(limit - 1, 1, current);

  return shown.map((chat) => ({
    threadId: chat.id,
    title: chat.title === PLACEHOLDER_THREAD_TITLE || chat.title.trim() === "" ? null : chat.title,
    updatedAt: chat.updatedAt,
    current: chat.id === input.currentThreadId,
    newest: chat.id === newestId,
  }));
}
