import {
  DomainError,
  filterPage,
  getPage,
  type PageOptions,
  parseInput,
  parsePageOptions,
  required,
} from "@otto/shared";
import {
  advanceCursor,
  type Context,
  requireHuman,
  requireMember,
  requireWriter,
} from "@otto/workspaces";
import { and, eq, gt, or } from "drizzle-orm";
import { z } from "zod";
import { subscriptions } from "./schema";

export const SUBSCRIPTION_INPUT = z
  .object({
    title: z.string().min(1).max(200),
    visibility: z.enum(["user", "workspace"]).optional(),
  })
  .strict();
export const SUBSCRIPTION_UPDATE = z
  .object({
    title: z.string().min(1).max(200).optional(),
    visibility: z.enum(["user", "workspace"]).optional(),
    status: z.enum(["needs_auth", "disabled"]).optional(),
  })
  .strict();

export async function createSubscription(
  c: Context,
  input: z.infer<typeof SUBSCRIPTION_INPUT>,
) {
  requireHuman(c);
  requireWriter(c);
  const parsed = parseInput(SUBSCRIPTION_INPUT, input);
  const row = required(
    (
      await c.tx
        .insert(subscriptions)
        .values({
          ...parsed,
          workspaceId: c.workspaceId,
          createdBy: c.actor.userId,
        })
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return getSubscription(c, row.id);
}
export async function getSubscription(c: Context, id: string) {
  const row = required(
    (
      await c.tx
        .select({
          id: subscriptions.id,
          createdBy: subscriptions.createdBy,
          title: subscriptions.title,
          visibility: subscriptions.visibility,
          status: subscriptions.status,
          createdAt: subscriptions.createdAt,
          updatedAt: subscriptions.updatedAt,
        })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.id, id),
            eq(subscriptions.workspaceId, c.workspaceId),
          ),
        )
    )[0],
  );
  await requireMember(c, row.createdBy);
  if (row.visibility === "user" && row.createdBy !== c.actor.userId)
    throw new DomainError("forbidden");
  return row;
}
export async function getSubscriptions(c: Context, options: PageOptions = {}) {
  requireHuman(c);
  const { after, limit } = parsePageOptions(options);
  const rows = await c.tx
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.workspaceId, c.workspaceId),
        or(
          eq(subscriptions.createdBy, c.actor.userId),
          eq(subscriptions.visibility, "workspace"),
        ),
        after ? gt(subscriptions.id, after) : undefined,
      ),
    )
    .orderBy(subscriptions.id)
    .limit(limit + 1);
  return filterPage(
    getPage(rows, (row) => row.id, limit),
    (row) => getSubscription(c, row.id),
  );
}
/** Human edits may revoke or request fresh verification, never assert native qualification. */
export async function updateSubscription(
  c: Context,
  id: string,
  input: z.infer<typeof SUBSCRIPTION_UPDATE>,
) {
  requireHuman(c);
  requireWriter(c);
  const row = await getSubscription(c, id);
  if (row.createdBy !== c.actor.userId) throw new DomainError("forbidden");
  const parsed = parseInput(SUBSCRIPTION_UPDATE, input);
  const changes = parsed;
  if (Object.values(changes).every((v) => v === undefined))
    throw new DomainError("invalid", "No editable fields");
  await c.tx
    .update(subscriptions)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(subscriptions.id, id));
  await advanceCursor(c);
  return getSubscription(c, id);
}
