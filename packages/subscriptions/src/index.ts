import {
  authorizedPage,
  matchesText,
  pageOf,
  sortNames,
  sortPlan,
  textKey,
  timeKey,
} from "@otto/db";
import {
  DomainError,
  type PageOptions,
  parseInput,
  required,
} from "@otto/shared";
import {
  advanceCursor,
  type Context,
  creatorIsMember,
  requireHuman,
  requireMember,
  requireWriter,
} from "@otto/workspaces";
import { and, eq, or } from "drizzle-orm";
import { z } from "zod";
import { subscriptions } from "./schema";

export const SUBSCRIPTION_INPUT = z
  .object({
    title: z.string().min(1).max(200),
    provider: z.literal("codex"),
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
          provider: subscriptions.provider,
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
const subscriptionSorts = {
  title: textKey(subscriptions.title),
  createdAt: timeKey(subscriptions.createdAt),
  updatedAt: timeKey(subscriptions.updatedAt),
};
export const SUBSCRIPTION_SORTS = sortNames(subscriptionSorts);
/** Filters narrow only readable Subscriptions; the gateway account behind one is never filterable or returned. */
export async function getSubscriptions(
  c: Context,
  filter: PageOptions & {
    sort?: string;
    order?: string;
    status?: (typeof subscriptions.$inferSelect)["status"];
    provider?: (typeof subscriptions.$inferSelect)["provider"];
    visibility?: "user" | "workspace";
    createdBy?: string;
    query?: string;
  } = {},
) {
  requireHuman(c);
  const plan = sortPlan({
    operation: "getSubscriptions",
    scope: c,
    filter,
    keys: subscriptionSorts,
    id: subscriptions.id,
  });
  const rows = await c.tx
    .select({ id: subscriptions.id, position: plan.position })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.workspaceId, c.workspaceId),
        or(
          eq(subscriptions.createdBy, c.actor.userId),
          eq(subscriptions.visibility, "workspace"),
        ),
        creatorIsMember(c, subscriptions.createdBy),
        filter.status ? eq(subscriptions.status, filter.status) : undefined,
        filter.provider
          ? eq(subscriptions.provider, filter.provider)
          : undefined,
        filter.visibility
          ? eq(subscriptions.visibility, filter.visibility)
          : undefined,
        filter.createdBy
          ? eq(subscriptions.createdBy, filter.createdBy)
          : undefined,
        filter.query
          ? matchesText(subscriptions.title, filter.query)
          : undefined,
        plan.where,
      ),
    )
    .orderBy(...plan.orderBy)
    .limit(plan.limit + 1);
  return authorizedPage(
    pageOf(rows, plan, (row) => row.id),
    (row) => getSubscription(c, row.id),
    plan,
  );
}
/** Human edits may revoke or request fresh verification, never assert gateway qualification. */
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
