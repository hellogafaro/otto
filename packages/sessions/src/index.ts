import { pageOf, sortNames, sortPlan, timeKey } from "@otto/db";
import { DomainError, type PageOptions, required } from "@otto/shared";

import { advanceCursor, type Context } from "@otto/workspaces";
import { and, desc, eq } from "drizzle-orm";
import { type SessionSource, sessions } from "./schema";

export type { SessionSource } from "./schema";
export interface SessionBinding {
  chatId: string;
  agentId: string;
  environmentId: string;
  environmentGeneration: number;
  scope: string;
  provider: string;
  model: string;
  accountId: string;
  subscriptionId: string | null;
}
export async function createSession(
  c: Context,
  binding: SessionBinding,
  mode: "manual" | "auto" = "manual",
) {
  return required(
    (
      await c.tx
        .insert(sessions)
        .values({
          ...binding,
          workspaceId: c.workspaceId,
          ownerId: c.actor.userId,
          mode,
          createdCursor: await advanceCursor(c),
          sourcesCertified: true,
        })
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
    !session.sourcesCertified ||
    session.ownerId !== c.actor.userId ||
    session.chatId !== binding.chatId ||
    session.agentId !== binding.agentId ||
    session.environmentId !== binding.environmentId ||
    session.environmentGeneration !== binding.environmentGeneration ||
    session.scope !== binding.scope ||
    session.provider !== binding.provider ||
    session.model !== binding.model ||
    session.accountId !== binding.accountId ||
    session.subscriptionId !== binding.subscriptionId
  )
    throw new DomainError("conflict", "Fresh Session required");
  return session;
}

export async function getLatestAutoSession(
  c: Context,
  chatId: string,
  agentId: string,
) {
  return (
    (
      await c.tx
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.workspaceId, c.workspaceId),
            eq(sessions.chatId, chatId),
            eq(sessions.agentId, agentId),
            eq(sessions.ownerId, c.actor.userId),
            eq(sessions.mode, "auto"),
          ),
        )
        .orderBy(desc(sessions.createdCursor), desc(sessions.id))
        .limit(1)
    )[0] ?? null
  );
}

export async function recordSessionSources(
  c: Context,
  id: string,
  sources: SessionSource[],
) {
  const session = await getSessionContext(c, id);
  if (session.ownerId !== c.actor.userId || session.agentId !== c.actor.agentId)
    throw new DomainError("forbidden");
  if (sources.length > 200)
    throw new DomainError("unavailable", "Retained source limit");
  const merged = [
    ...new Map(
      [...session.sources, ...sources].map((source) => [
        JSON.stringify(source, Object.keys(source).sort()),
        source,
      ]),
    ).values(),
  ];
  if (merged.length > 200 || Buffer.byteLength(JSON.stringify(merged)) > 65536)
    throw new DomainError("unavailable", "Retained source limit");
  await c.tx
    .update(sessions)
    .set({ sources: merged })
    .where(eq(sessions.id, id));
}

export async function invalidateSessionSources(c: Context, id: string) {
  const session = await getSessionContext(c, id);
  if (session.ownerId !== c.actor.userId || session.agentId !== c.actor.agentId)
    throw new DomainError("forbidden");
  await c.tx
    .update(sessions)
    .set({ sourcesCertified: false })
    .where(eq(sessions.id, id));
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

const sessionSorts = {
  createdAt: timeKey(sessions.createdAt),
  updatedAt: timeKey(sessions.updatedAt),
};
export const SESSION_SORTS = sortNames(sessionSorts);
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
        eq(sessions.ownerId, c.actor.userId),
        options.agentId ? eq(sessions.agentId, options.agentId) : undefined,
        plan.where,
      ),
    )
    .orderBy(...plan.orderBy)
    .limit(plan.limit + 1);
  return pageOf(items, plan, (row) => row.id);
}
