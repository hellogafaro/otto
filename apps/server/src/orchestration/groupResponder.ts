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
      return `${GROUP_TURN_NOTE_PREFIX}your turn. Answer the message above if the group rules make it yours, otherwise reply ${GROUP_NO_REPLY}.)`;
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

/** What a bot does, as its group roster line names it; long descriptions are cut. */
const GROUP_ROLE_LIMIT = 160;

/**
 * System context telling the responding bot who else is in its group chat, what each bot does,
 * and how to decide from the message itself whether a reply is its to give.
 */
export function groupRosterContext(input: {
  readonly groupName: string;
  readonly members: ReadonlyArray<GroupMembership>;
  readonly respondingBotId: BotId | null;
  /** Each member bot's name and what it does (its description, else its label). */
  readonly bots: ReadonlyMap<BotId, { readonly name: string; readonly role: string | null }>;
}): string {
  const lines = input.members.flatMap((member) => {
    if (!isGroupBotMember(member)) return [`- ${member.displayName} (person)`];
    const bot = input.bots.get(member.botId);

    if (!bot) return [];
    const who = member.botId === input.respondingBotId ? "bot, you" : "bot";
    const role = bot.role?.trim().replace(/\s+/g, " ").slice(0, GROUP_ROLE_LIMIT);

    return [`- ${bot.name} (${who})${role ? `: ${role}` : ""}`];
  });

  return [
    `You are in the group chat "${input.groupName}". Its members:`,
    ...lines,
    "No bot leads this group, even if older messages say so. Every bot hears each message; decide from the message, the chat so far, your role and tools, and the other bots' roles.",
    "- Greetings and small talk: a short reply of your own is fine; never echo what a bot above just said.",
    "- Questions, requests and tasks: answer when they fit your role and tools better than another bot's, or you add what no bot above covered. Stay out when another bot already took it or it fits another bot better.",
    `When you have nothing to add, reply exactly ${GROUP_NO_REPLY} and nothing else, without using tools. Always answer when you are @mentioned or a person writes ${GROUP_EVERYONE_MENTION}. To hand work to another bot, @mention it by name. Messages from other bots in the history are theirs, not yours.`,
  ].join("\n");
}
