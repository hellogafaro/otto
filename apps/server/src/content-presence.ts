import { getChat } from "@otto/chats";
import { DomainError } from "@otto/shared";

import { type Context, requireHuman, requireMember } from "@otto/workspaces";
/** Ephemeral, bounded human presence. Expiry is local to this server, not a saved notification record. */
export function createContentPresence() {
  const entries = new Map<
    string,
    {
      workspaceId: string;
      chatId: string;
      userId: string;
      typing: boolean;
      expiresAt: number;
    }
  >();
  function prune() {
    for (const [key, value] of entries)
      if (value.expiresAt <= Date.now()) entries.delete(key);
  }
  return {
    async update(c: Context, chatId: string, typing: boolean) {
      requireHuman(c);
      await getChat(c, chatId, typing);
      prune();
      const key = `${chatId}:${c.actor.userId}`;
      if (entries.size >= 5000 && !entries.has(key))
        throw new DomainError("unavailable");
      entries.set(key, {
        workspaceId: c.workspaceId,
        chatId,
        userId: c.actor.userId,
        typing,
        expiresAt: Date.now() + 30000,
      });
    },
    async get(c: Context, chatId: string) {
      requireHuman(c);
      await getChat(c, chatId);
      prune();
      const items = [];
      for (const [key, value] of entries) {
        if (value.workspaceId !== c.workspaceId || value.chatId !== chatId)
          continue;
        try {
          const member = await requireMember(c, value.userId);
          await getChat(
            { ...c, actor: { userId: value.userId }, role: member.role },
            chatId,
          );
          items.push({ userId: value.userId, typing: value.typing });
        } catch (error) {
          if (
            !(error instanceof DomainError) ||
            !["forbidden", "not_found"].includes(error.code)
          )
            throw error;
          entries.delete(key);
        }
        if (items.length === 100) break;
      }
      return items;
    },
  };
}
