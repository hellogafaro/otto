import { DomainError, required } from "@otto/db";
import type { Context } from "@otto/workspaces";
import { and, eq } from "drizzle-orm";
import { sessions } from "./schema";
export interface SessionBinding {
  conversationId: string;
  agentId: string;
  environmentId: string;
  environmentGeneration: number;
  scope: string;
  harness: string;
  harnessRelease: string;
  accountConnectionId: string | null;
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
    session.harnessRelease !== binding.harnessRelease ||
    session.accountConnectionId !== binding.accountConnectionId
  )
    throw new DomainError("conflict", "Fresh Session required");
  return session;
}
