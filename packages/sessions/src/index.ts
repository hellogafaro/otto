import { getConversation } from "@otto/conversations";
import {
  DomainError,
  getPage,
  type PageOptions,
  parsePageOptions,
  required,
} from "@otto/shared";

import type { Context } from "@otto/workspaces";
import { and, eq, gt } from "drizzle-orm";
import { sessions } from "./schema";
export interface SessionBinding {
  conversationId: string;
  agentId: string;
  environmentId: string;
  environmentGeneration: number;
  scope: string;
  harness: string;
  harnessVersion: string;
  connectionId: string | null;
}
/** Private harness bindings have no browser read endpoint and are not shared conversation history. */
export async function createSession(c: Context, binding: SessionBinding) {
  return required(
    (
      await c.tx
        .insert(sessions)
        .values({ ...binding, workspaceId: c.workspaceId })
        .returning()
    )[0],
  );
}
export async function requireSession(
  c: Context,
  id: string,
  binding: SessionBinding,
) {
  const session = required(
    (
      await c.tx
        .select()
        .from(sessions)
        .where(
          and(eq(sessions.id, id), eq(sessions.workspaceId, c.workspaceId)),
        )
    )[0],
  );
  if (
    session.conversationId !== binding.conversationId ||
    session.agentId !== binding.agentId ||
    session.environmentId !== binding.environmentId ||
    session.environmentGeneration !== binding.environmentGeneration ||
    session.scope !== binding.scope ||
    session.harness !== binding.harness ||
    session.harnessVersion !== binding.harnessVersion ||
    session.connectionId !== binding.connectionId
  )
    throw new DomainError("conflict", "Fresh Session required");
  return session;
}

/** Private context is bound once; native references never enter browser Run projections. */
export async function getSessionContext(c: Context, id: string) {
  return required(
    (
      await c.tx
        .select()
        .from(sessions)
        .where(
          and(eq(sessions.id, id), eq(sessions.workspaceId, c.workspaceId)),
        )
    )[0],
  );
}
export async function bindSessionContext(
  c: Context,
  id: string,
  contextRef: string,
) {
  const row = await getSessionContext(c, id);
  if (row.contextRef && row.contextRef !== contextRef)
    throw new DomainError("conflict", "Native context changed");
  await c.tx.update(sessions).set({ contextRef }).where(eq(sessions.id, id));
}

/** Caller must authorize the Conversation; native context/provider references remain private. */
export async function getSessions(
  c: Context,
  conversationId: string,
  options: PageOptions = {},
) {
  const { after, limit } = parsePageOptions(options);
  await getConversation(c, conversationId);
  const items = await c.tx
    .select({
      id: sessions.id,
      agentId: sessions.agentId,
      conversationId: sessions.conversationId,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.workspaceId, c.workspaceId),
        eq(sessions.conversationId, conversationId),
        after ? gt(sessions.id, after) : undefined,
      ),
    )
    .orderBy(sessions.id)
    .limit(limit + 1);
  return getPage(items, (row) => row.id, limit);
}
