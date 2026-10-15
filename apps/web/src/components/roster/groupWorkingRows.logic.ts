import type { BotId, OrchestrationMessage } from "@otto/contracts";
import { type GroupBot, groupMentions, groupRound } from "@otto/shared/groupRound";

/** Bot-to-bot @mentions one round may follow, as the server's round does. */
const MAX_HANDOFFS = 3;

export interface GroupWorkingRow {
  readonly botId: BotId;
  /** `working` is the bot answering now; `waiting` bots answer after it, in order. */
  readonly state: "working" | "waiting";
}

/**
 * The bots still to answer a person's latest message in a group round, in the order the server
 * runs them: the same plan (@mentions, @everyone or every bot), then the bots replies hand off to.
 * Bots that replied show their message instead, and bots before the one answering now passed.
 */
export function groupWorkingRows(input: {
  readonly bots: ReadonlyArray<GroupBot>;
  readonly peopleNames: ReadonlyArray<string>;
  readonly messages: ReadonlyArray<
    Pick<OrchestrationMessage, "role" | "text" | "createdAt" | "respondingBotId">
  >;
  /** The bot the thread started last, and when its turn was asked for. */
  readonly respondingBotId: BotId | null;
  readonly turnRequestedAt: string | null;
}): ReadonlyArray<GroupWorkingRow> {
  const anchor = input.messages.findLastIndex((message) => message.role === "user");

  if (anchor < 0) return [];
  let first = anchor;

  while (first > 0 && input.messages[first - 1]?.role === "user") first -= 1;

  const prompt = input.messages
    .slice(first, anchor + 1)
    .map((message) => message.text)
    .join("\n\n");

  const replies = input.messages
    .slice(anchor + 1)
    .filter((message) => message.role === "assistant");

  const queue = [...groupRound(input.bots, prompt, input.peopleNames).botIds];
  let handoffs = 0;

  for (const reply of replies) {
    const others = input.bots.filter((bot) => bot.id !== reply.respondingBotId);

    for (const botId of groupMentions(others, reply.text)) {
      if (handoffs >= MAX_HANDOFFS) break;

      if (queue.includes(botId)) continue;
      queue.push(botId);
      handoffs += 1;
    }
  }

  const replied = new Set(replies.map((reply) => reply.respondingBotId));

  const answering =
    (input.turnRequestedAt ?? "") >= (input.messages[anchor]?.createdAt ?? "")
      ? input.respondingBotId
      : null;

  const current = answering === null ? 0 : Math.max(queue.indexOf(answering), 0);

  return queue.slice(current).flatMap((botId): GroupWorkingRow[] => {
    if (replied.has(botId)) return [];

    return [{ botId, state: botId === answering ? "working" : "waiting" }];
  });
}
