import type { MessageId } from "@otto/contracts";

/** A user message the bot reads but the chat never shows: routine runs and a new bot's introduction. */
const HIDDEN_PROMPT_PREFIXES = ["routine:", "intro:"] as const;

export const BOT_INTRO_MESSAGE_PREFIX = "intro:";

export function isHiddenBotPrompt(messageId: MessageId | string): boolean {
  return HIDDEN_PROMPT_PREFIXES.some((prefix) => String(messageId).startsWith(prefix));
}

/**
 * The hidden first message a new bot answers. The bot greets the user, asks
 * for the context it needs to work with them, and once they answer proposes its
 * own instructions for them to approve. Memory picks up what they said on its own.
 */
export function botIntroPrompt(name: string, locale: string): string {
  return [
    "<bot-introduction>",
    `You were just created and named ${name}. This note starts your first chat with the user who created you. They cannot see it, so never quote or mention it.`,
    `Write in the language for locale ${locale}. Do not use a tool in this reply. This one reply may run to 90 words and use a short list.`,
    `Open with "Hey, I'm ${name}." and say you would like some context before you start, so you can work well with them over time. Do not ask for a first task.`,
    "Then ask, as a short list, for: what they do and what they want you to own; the tools and apps they use for that work; and how they like you to work with them (tone, length, when to check in).",
    "When they answer, ask at most one follow-up, and only if something essential is missing. Then end the introduction in the same reply:",
    "- Propose your new instructions with bot_update: what you do and own, the tools and apps you use for it, and how you work with them, as short lines written to yourself. Keep everything already in <instructions>. They apply once a person approves them in this chat.",
    "- Then say in one or two lines what changed in your instructions, and ask what to start on. If they declined the instructions, say you will keep working as before.",
    "</bot-introduction>",
  ].join("\n");
}
