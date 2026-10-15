import type { BotId, OrchestrationMessage } from "@otto/contracts";
import { type GroupBot, groupMentions, groupRound } from "@otto/shared/groupRound";

/** Bot-to-bot @mentions one round may follow, as the server's round does. */
const MAX_HANDOFFS = 3;

export interface GroupWorkingRow {
  readonly botId: BotId;
  /** `working` is the bot answering now; `waiting` bots answer after it, in order. */
  readonly state: "working" | "waiting";
}

type RowMessage = Pick<OrchestrationMessage, "role" | "text" | "createdAt" | "respondingBotId">;

/**
 * The bots still to answer a person's latest message in a group round, in the order the server
 * runs them: the same plan (@mentions, @everyone or every bot), then the bots replies hand off to.
 * Bots that replied show their message instead, and bots before the one answering now passed.
 *
 * A message sent while a bot works joins that bot's turn, as the server does: the bots still
 * waiting drop out, and only the other bots it @mentions (or everyone, for @everyone) answer next.
 * A message only for other bots waits, with every later one, for a new round after that turn.
 */
export function groupWorkingRows(input: {
  readonly bots: ReadonlyArray<GroupBot>;
  readonly peopleNames: ReadonlyArray<string>;
  readonly messages: ReadonlyArray<RowMessage>;
  /** The bot the thread started last, and when its turn was asked for and ended. */
  readonly respondingBotId: BotId | null;
  readonly turn: { readonly requestedAt: string; readonly completedAt: string | null } | null;
}): ReadonlyArray<GroupWorkingRow> {
  const anchor = input.messages.findLastIndex((message) => message.role === "user");

  if (anchor < 0) return [];
  const anchorAt = input.messages[anchor]?.createdAt ?? "";
  const turn = input.turn;

  const replies = input.messages
    .slice(anchor + 1)
    .filter((message) => message.role === "assistant");

  const replied = new Set(replies.map((reply) => reply.respondingBotId));
  const answering = input.respondingBotId;

  if (
    turn !== null &&
    answering !== null &&
    turn.requestedAt < anchorAt &&
    (turn.completedAt === null || anchorAt <= turn.completedAt)
  ) {
    return lateRows({ ...input, answering, turn, replied });
  }

  let first = anchor;

  while (first > 0 && input.messages[first - 1]?.role === "user") first -= 1;

  const prompt = input.messages
    .slice(first, anchor + 1)
    .map((message) => message.text)
    .join("\n\n");

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

  const started = (turn?.requestedAt ?? "") >= anchorAt ? answering : null;
  const current = started === null ? 0 : Math.max(queue.indexOf(started), 0);

  return queue.slice(current).flatMap((botId): GroupWorkingRow[] => {
    if (replied.has(botId)) return [];

    return [{ botId, state: botId === started ? "working" : "waiting" }];
  });
}

/** Rows when the latest person messages arrived while `answering` was working. */
function lateRows(input: {
  readonly bots: ReadonlyArray<GroupBot>;
  readonly peopleNames: ReadonlyArray<string>;
  readonly messages: ReadonlyArray<RowMessage>;
  readonly answering: BotId;
  readonly turn: { readonly requestedAt: string; readonly completedAt: string | null };
  readonly replied: ReadonlySet<BotId | null | undefined>;
}): ReadonlyArray<GroupWorkingRow> {
  let next: ReadonlyArray<BotId> = [];
  const batch: string[] = [];

  for (const message of input.messages) {
    if (message.role !== "user" || message.createdAt <= input.turn.requestedAt) continue;
    const plan = groupRound(input.bots, message.text, input.peopleNames);

    if (
      batch.length > 0 ||
      (plan.reason === "mentioned" && !plan.botIds.includes(input.answering))
    ) {
      batch.push(message.text);
      continue;
    }

    next = plan.reason === "plain" ? [] : plan.botIds.filter((botId) => botId !== input.answering);
  }

  const waiting =
    batch.length > 0 ? groupRound(input.bots, batch.join("\n\n"), input.peopleNames).botIds : next;

  const rows: GroupWorkingRow[] =
    input.turn.completedAt === null ? [{ botId: input.answering, state: "working" }] : [];

  for (const botId of waiting) {
    if (input.replied.has(botId) || rows.some((row) => row.botId === botId)) continue;
    rows.push({ botId, state: "waiting" });
  }

  return rows;
}
