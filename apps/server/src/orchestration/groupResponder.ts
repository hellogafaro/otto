import { isGroupBotMember, type BotId, type GroupMembership } from "@otto/contracts";
import { collectComposerInlineTokens } from "@otto/shared/composerInlineTokens";

/** A bot's reply that is exactly this word is never shown. */
export const GROUP_NO_REPLY = "NO_REPLY";

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

/** The hidden note that tells a bot why it is answering now. */
export function groupTurnNote(reason: GroupTurnReason, from?: string): string {
  switch (reason) {
    case "plain":
      return `(Group: your turn. Answer the message above only if it is for you, otherwise reply ${GROUP_NO_REPLY}.)`;
    case "mentioned":
      return "(Group: you were mentioned. Answer the message above.)";
    case "everyone":
      return "(Group: the message above is for everyone. Answer it briefly.)";
    case "handoff":
      return `(Group: ${from ?? "another bot"} mentioned you above. Answer it.)`;
    case "fallback":
      return "(Group: no other bot answered. Answer the message above.)";
  }
}

/**
 * System context telling the responding bot who else is in its group chat and
 * how the group decides which bots answer a message.
 */
export function groupRosterContext(input: {
  readonly groupName: string;
  readonly members: ReadonlyArray<GroupMembership>;
  readonly respondingBotId: BotId | null;
  readonly botNames: ReadonlyMap<BotId, string>;
}): string {
  const lines = input.members.flatMap((member) => {
    if (!isGroupBotMember(member)) return [`- ${member.displayName} (person)`];
    const name = input.botNames.get(member.botId);

    if (!name) return [];

    return [`- ${name} (${member.botId === input.respondingBotId ? "bot, you" : "bot"})`];
  });

  return [
    `You are in the group chat "${input.groupName}". Its members:`,
    ...lines,
    `No bot leads this group, even if older messages say so. Every bot hears each message. Answer only what is yours and what no bot above already covered; otherwise reply exactly ${GROUP_NO_REPLY} and nothing else, without using tools. Always answer when you are @mentioned or a person writes ${GROUP_EVERYONE_MENTION}. To hand work to another bot, @mention it by name. Messages from other bots in the history are theirs, not yours.`,
  ].join("\n");
}
