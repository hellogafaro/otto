import { GROUP_NO_REPLY } from "../../../orchestration/group-responder.ts";

/**
 * Closing text the person should still see after a progress post.
 * Empty when it was already posted, or when the bot is passing in a group.
 */
export function withheldClosingText(input: {
  readonly posted: boolean;
  readonly text: string;
  readonly lastPostedText: string | null;
}): string | null {
  const text = input.text.trim();

  if (!input.posted || text.length === 0 || text === GROUP_NO_REPLY) return null;
  if (input.lastPostedText !== null && text === input.lastPostedText.trim()) return null;

  return text;
}
