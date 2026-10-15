import { isGroupBotMember, type BotId, type GroupMembership } from "@otto/contracts";
import { GROUP_EVERYONE_MENTION, type GroupTurnReason } from "@otto/shared/groupRound";

/** A bot's reply that is exactly this word is never shown. */
export const GROUP_NO_REPLY = "NO_REPLY";

const GROUP_TURN_NOTE_PREFIX = "(Group: ";

/** Whether a message is only a hidden group turn note. */
export function isGroupTurnNote(text: string): boolean {
  return text.startsWith(GROUP_TURN_NOTE_PREFIX) && text.endsWith(")") && !text.includes("\n");
}

/** The hidden note that tells a bot why it is answering now. */
export function groupTurnNote(reason: GroupTurnReason, from?: string): string {
  switch (reason) {
    case "plain":
      return `${GROUP_TURN_NOTE_PREFIX}your turn. Answer the message above only if it is for you, otherwise reply ${GROUP_NO_REPLY}.)`;
    case "mentioned":
      return `${GROUP_TURN_NOTE_PREFIX}you were mentioned. Answer the message above.)`;
    case "everyone":
      return `${GROUP_TURN_NOTE_PREFIX}the message above is for everyone. Answer it briefly.)`;
    case "handoff":
      return `${GROUP_TURN_NOTE_PREFIX}${from ?? "another bot"} mentioned you above. Answer it.)`;
    case "fallback":
      return `${GROUP_TURN_NOTE_PREFIX}no other bot answered. Answer the message above.)`;
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
