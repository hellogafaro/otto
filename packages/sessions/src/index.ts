import { getChat } from "@otto/chats";
import { pageOf, sortNames, sortPlan, timeKey } from "@otto/db";
import { DomainError, type PageOptions, required } from "@otto/shared";

import type { Context } from "@otto/workspaces";
import { and, eq } from "drizzle-orm";
import { sessions } from "./schema";
export interface SessionBinding {
  chatId: string;
  agentId: string;
  environmentId: string;
  environmentGeneration: number;
  scope: string;
  piVersion: string;
  provider: string;
  model: string;
  accountId: string;
  subscriptionId: string | null;
}
/** Private Pi bindings have no browser read endpoint and are not shared chat history. */
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
  const session = await getSessionContext(c, id);
  if (
    session.chatId !== binding.chatId ||
    session.agentId !== binding.agentId ||
    session.environmentId !== binding.environmentId ||
    session.environmentGeneration !== binding.environmentGeneration ||
    session.scope !== binding.scope ||
    session.piVersion !== binding.piVersion ||
    session.provider !== binding.provider ||
    session.model !== binding.model ||
    session.accountId !== binding.accountId ||
    session.subscriptionId !== binding.subscriptionId
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
    throw new DomainError("conflict", "Pi context changed");
  await c.tx.update(sessions).set({ contextRef }).where(eq(sessions.id, id));
}

const sessionSorts = {
  createdAt: timeKey(sessions.createdAt),
  updatedAt: timeKey(sessions.updatedAt),
};
export const SESSION_SORTS = sortNames(sessionSorts);
/** Authorizes the Chat and exposes metadata only; native context/provider references remain private. */
export async function getSessions(
  c: Context,
  chatId: string,
  options: PageOptions & {
    sort?: string;
    order?: string;
    agentId?: string;
  } = {},
) {
  const plan = sortPlan({
    operation: `getSessions:${chatId}`,
    scope: c,
    filter: options,
    keys: sessionSorts,
    id: sessions.id,
  });
  await getChat(c, chatId);
  const items = await c.tx
    .select({
      id: sessions.id,
      agentId: sessions.agentId,
      chatId: sessions.chatId,
      createdAt: sessions.createdAt,
      position: plan.position,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.workspaceId, c.workspaceId),
        eq(sessions.chatId, chatId),
        options.agentId ? eq(sessions.agentId, options.agentId) : undefined,
        plan.where,
      ),
    )
    .orderBy(...plan.orderBy)
    .limit(plan.limit + 1);
  return pageOf(items, plan, (row) => row.id);
}
