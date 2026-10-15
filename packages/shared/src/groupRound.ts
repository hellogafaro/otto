import type { BotId } from "@otto/contracts";

import { collectComposerInlineTokens } from "./composerInlineTokens.ts";

/**
 * Who answers a person's message in a group chat. The server runs the round one bot at a time,
 * and the web shows the same plan as the bots' working rows.
 */
export const GROUP_EVERYONE_MENTION = "@everyone";

export interface GroupBot {
  readonly id: BotId;
  readonly name: string;
}

/** Why a bot runs in a round, which decides whether it may stay quiet. */
export type GroupTurnReason = "plain" | "mentioned" | "everyone" | "handoff" | "fallback";

const mentionAt = (text: string, token: string): number => {
  const lower = text.toLowerCase();
  const needle = token.toLowerCase();

  for (let index = lower.indexOf(needle); index >= 0; index = lower.indexOf(needle, index + 1)) {
    const before = text[index - 1];
    const after = text[index + needle.length];

    if (
      (before === undefined || /\s/.test(before)) &&
      (after === undefined || /[\s.,!?:;)]/.test(after))
    )
      return index;
  }

  return -1;
};

/** The bots a message names, by `@bot:<id>` token or `@Name`, in the order they appear. */
export function groupMentions(bots: ReadonlyArray<GroupBot>, text: string): ReadonlyArray<BotId> {
  const found = new Map<BotId, number>();

  for (const token of collectComposerInlineTokens(`${text}\n`)) {
    if (token.type !== "bot-mention") continue;
    const bot = bots.find((candidate) => candidate.id === token.value);

    if (bot && !found.has(bot.id)) found.set(bot.id, token.start);
  }

  for (const bot of bots) {
    const index = mentionAt(text, `@${bot.name}`);

    if (index >= 0 && (found.get(bot.id) ?? Infinity) > index) found.set(bot.id, index);
  }

  return [...found].toSorted((left, right) => left[1] - right[1]).map(([botId]) => botId);
}

export interface GroupRound {
  readonly botIds: ReadonlyArray<BotId>;
  readonly reason: GroupTurnReason;
}

/**
 * Who answers a person's message: the bots it @mentions, every bot for @everyone, or,
 * for a plain message, every bot in roster order, each seeing the replies before it.
 */
export function groupRound(
  bots: ReadonlyArray<GroupBot>,
  text: string,
  peopleNames: ReadonlyArray<string> = [],
): GroupRound {
  if (mentionAt(text, GROUP_EVERYONE_MENTION) >= 0) {
    return { botIds: bots.map((bot) => bot.id), reason: "everyone" };
  }

  const mentioned = groupMentions(bots, text);

  if (mentioned.length > 0) return { botIds: mentioned, reason: "mentioned" };

  // A message that only @mentions people is between people; no bot answers it.
  const forPeople = peopleNames.some((name) =>
    [name, name.split(/\s+/)[0] ?? name].some((label) => mentionAt(text, `@${label}`) >= 0),
  );

  return { botIds: forPeople ? [] : bots.map((bot) => bot.id), reason: "plain" };
}
