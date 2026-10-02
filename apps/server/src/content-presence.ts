import { getConversation } from "@otto/conversations";
import { DomainError } from "@otto/shared";

import { type Context, requireHuman, requireMember } from "@otto/workspaces";
/** Ephemeral, bounded human presence. Expiry is local to this server, not a saved notification record. */
export function createContentPresence() {
  const entries = new Map<
    string,
    {
      workspaceId: string;
      conversationId: string;
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
    async update(c: Context, conversationId: string, typing: boolean) {
      requireHuman(c);
      await getConversation(c, conversationId, typing);
      prune();
      const key = `${conversationId}:${c.actor.userId}`;
      if (entries.size >= 5000 && !entries.has(key))
        throw new DomainError("unavailable");
      entries.set(key, {
        workspaceId: c.workspaceId,
        conversationId,
        userId: c.actor.userId,
        typing,
        expiresAt: Date.now() + 30000,
      });
    },
    async get(c: Context, conversationId: string) {
      requireHuman(c);
      await getConversation(c, conversationId);
      prune();
      const items = [];
      for (const [key, value] of entries) {
        if (
          value.workspaceId !== c.workspaceId ||
          value.conversationId !== conversationId
        )
          continue;
        try {
          const member = await requireMember(c, value.userId);
          await getConversation(
            { ...c, actor: { userId: value.userId }, role: member.role },
            conversationId,
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
