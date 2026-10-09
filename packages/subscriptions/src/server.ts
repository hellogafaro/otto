import type { Database } from "@otto/db";
import { DomainError } from "@otto/shared";
import {
  advanceCursor,
  type Context,
  inWorkspace,
  requireHuman,
  requireWriter,
} from "@otto/workspaces";
import { eq } from "drizzle-orm";
import { getSubscription } from "./index";
import { subscriptions } from "./schema";

/** Server-only: a managed gateway confirmed durable auth for this exact account/provider. */
export async function qualifySubscription(
  c: Context,
  id: string,
  provider: "codex",
) {
  requireHuman(c);
  requireWriter(c);
  const row = await getSubscription(c, id);
  if (row.provider !== provider)
    throw new DomainError("forbidden", "Account provider mismatch");
  if (row.status === "disabled" || row.status === "disconnected")
    throw new DomainError("forbidden", "Subscription unavailable");
  if (row.createdBy !== c.actor.userId) throw new DomainError("forbidden");
  if (row.status === "enabled") return;
  await c.tx
    .update(subscriptions)
    .set({
      status: "enabled",
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, id));
  await advanceCursor(c);
}

/** Trusted gateway only; authority is rechecked through the account's persisted maintainer, never a caller-supplied actor. */
export async function getGatewaySubscription(db: Database, id: string) {
  const row = (
    await db.select().from(subscriptions).where(eq(subscriptions.id, id))
  )[0];
  if (!row) throw new DomainError("not_found");
  return inWorkspace(
    db,
    row.workspaceId,
    { userId: row.createdBy },
    async (c) => {
      requireWriter(c);
      const current = await getSubscription(c, id);
      if (current.status !== "enabled")
        throw new DomainError("forbidden", "Account unavailable");
      return { ...current, workspaceId: c.workspaceId };
    },
    false,
  );
}
