import { DomainError } from "@otto/shared";
import {
  advanceCursor,
  type Context,
  requireHuman,
  requireWriter,
} from "@otto/workspaces";
import { eq } from "drizzle-orm";
import { getSubscription } from "./index";
import { subscriptions } from "./schema";

/** Trusted computer inspection confirmed this exact native account; no login/billing action or fallback. */
export async function qualifySubscription(c: Context, id: string) {
  requireHuman(c);
  requireWriter(c);
  const row = await getSubscription(c, id);
  if (row.status === "disabled")
    throw new DomainError("forbidden", "Subscription disabled");
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
