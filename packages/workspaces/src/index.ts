import {
  type CursorCodec,
  type Database,
  matchesText,
  pageOf,
  sortNames,
  sortPlan,
  type Transaction,
  textKey,
} from "@otto/db";
import { DomainError, type PageOptions, required } from "@otto/shared";

import { type AnyColumn, and, eq, sql } from "drizzle-orm";
import { invitations, members, setup, users, workspaces } from "./schema";

export interface Actor {
  userId: string;
  agentId?: string;
}
export interface Context {
  tx: Transaction;
  workspaceId: string;
  actor: Actor;
  role: "owner" | "admin" | "contributor" | "viewer";
  /** Seals sorted list positions; the API composition supplies it, so a sorted list without it is unavailable. */
  cursors?: CursorCodec;
}
/** Serializes workspace mutations and cursor advancement with permission changes. No network I/O belongs in this transaction. */
export async function inWorkspace<T>(
  db: Database,
  workspaceId: string,
  actor: Actor,
  fn: (context: Context) => Promise<T>,
  write = true,
  cursors?: CursorCodec,
): Promise<T> {
  return db.transaction(async (tx) => {
    required(
      (
        await tx
          .select()
          .from(workspaces)
          .where(eq(workspaces.id, workspaceId))
          .for(write ? "update" : "share")
      )[0],
    );
    const member = required(
      (
        await tx
          .select()
          .from(members)
          .where(
            and(
              eq(members.workspaceId, workspaceId),
              eq(members.userId, actor.userId),
            ),
          )
      )[0],
      "forbidden",
    );
    return fn({ tx, workspaceId, actor, role: member.role, cursors });
  });
}
export function requireHuman(c: Context) {
  if (c.actor.agentId) throw new DomainError("forbidden");
}
export function requireWriter(c: Context) {
  if (c.role === "viewer") throw new DomainError("forbidden");
}
export function requireAdmin(c: Context) {
  requireHuman(c);
  if (c.role !== "admin" && c.role !== "owner")
    throw new DomainError("forbidden");
}
export async function requireMember(c: Context, userId: string, write = false) {
  const row = required(
    (
      await c.tx
        .select()
        .from(members)
        .where(
          and(
            eq(members.workspaceId, c.workspaceId),
            eq(members.userId, userId),
          ),
        )
    )[0],
    "forbidden",
  );
  if (write && row.role === "viewer") throw new DomainError("forbidden");
  return row;
}
/** Runs only from the operator CLI against an existing human account. Registration never calls this. */
export async function claimInstallation(
  db: Database,
  userId: string,
  title: string,
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(72183001)`);
    if ((await tx.select().from(setup)).length)
      throw new DomainError("conflict", "Installation already claimed");
    required((await tx.select().from(users).where(eq(users.id, userId)))[0]);
    const workspace = required(
      (await tx.insert(workspaces).values({ title }).returning())[0],
    );
    await tx
      .insert(members)
      .values({ workspaceId: workspace.id, userId, role: "owner" });
    await tx.insert(setup).values({ id: 1 });
    return workspace;
  });
}
/** SQL form of `requireMember`: the creator still holds a workspace membership. Narrowing only. */
export const creatorIsMember = (c: Context, userId: AnyColumn) =>
  sql`exists (select 1 from ${members} where ${members.workspaceId} = ${c.workspaceId} and ${members.userId} = ${userId})`;
/** Display name for another domain's roster rows (sort and search); never email, credentials or sessions. */
export const userNameOf = (userId: AnyColumn) =>
  sql<string>`(select ${users.name} from ${users} where ${users.id} = ${userId})`;
type Role = (typeof members.$inferSelect)["role"];
const workspaceSorts = { title: textKey(workspaces.title) };
export const WORKSPACE_SORTS = sortNames(workspaceSorts);
/** The caller's own Workspaces; discovery filters narrow only memberships they already hold. */
export async function getWorkspaces(
  db: Database,
  userId: string,
  options: PageOptions & {
    sort?: string;
    order?: string;
    role?: Role;
    query?: string;
  } = {},
  cursors?: CursorCodec,
) {
  const plan = sortPlan({
    operation: "getWorkspaces",
    scope: { workspaceId: "", actor: { userId }, cursors },
    filter: options,
    keys: workspaceSorts,
    id: workspaces.id,
  });
  const rows = await db
    .select({
      id: workspaces.id,
      title: workspaces.title,
      role: members.role,
      position: plan.position,
    })
    .from(members)
    .innerJoin(workspaces, eq(workspaces.id, members.workspaceId))
    .where(
      and(
        eq(members.userId, userId),
        options.role ? eq(members.role, options.role) : undefined,
        options.query
          ? matchesText(workspaces.title, options.query)
          : undefined,
        plan.where,
      ),
    )
    .orderBy(...plan.orderBy)
    .limit(plan.limit + 1);
  return pageOf(rows, plan, (row) => row.id);
}
export async function createInvitation(
  c: Context,
  input: { email: string; role: "admin" | "contributor" | "viewer" },
) {
  requireAdmin(c);
  if (input.role === "admin" && c.role !== "owner")
    throw new DomainError("forbidden");
  return required(
    (
      await c.tx
        .insert(invitations)
        .values({
          ...input,
          email: input.email.toLowerCase(),
          workspaceId: c.workspaceId,
          expiresAt: new Date(Date.now() + 7 * 86400000),
        })
        .returning()
    )[0],
  );
}
/** Invitation IDs are recipient-bound selectors, never bearer credentials. */
export async function acceptInvitation(
  db: Database,
  userId: string,
  id: string,
) {
  return db.transaction(async (tx) => {
    const invitation = required(
      (await tx.select().from(invitations).where(eq(invitations.id, id)))[0],
    );
    required(
      (
        await tx
          .select()
          .from(workspaces)
          .where(eq(workspaces.id, invitation.workspaceId))
          .for("update")
      )[0],
    );
    const current = required(
      (await tx.select().from(invitations).where(eq(invitations.id, id)))[0],
    );
    const user = required(
      (await tx.select().from(users).where(eq(users.id, userId)))[0],
    );
    if (
      !user.emailVerified ||
      user.email.toLowerCase() !== current.email ||
      current.revokedAt ||
      current.acceptedAt ||
      current.expiresAt <= new Date()
    )
      throw new DomainError("forbidden");
    await tx
      .insert(members)
      .values({ workspaceId: current.workspaceId, userId, role: current.role })
      .onConflictDoNothing();
    await tx
      .update(invitations)
      .set({ acceptedAt: new Date() })
      .where(eq(invitations.id, id));
    return { workspaceId: current.workspaceId };
  });
}
/** Admin-only status edit of a current invitation; recipient acceptance stays a separate transaction. */
export async function updateInvitation(
  c: Context,
  id: string,
  input: { status: "revoked" },
) {
  if (input.status !== "revoked") throw new DomainError("invalid");
  await getInvitation(c, id);
  return required(
    (
      await c.tx
        .update(invitations)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(invitations.id, id),
            eq(invitations.workspaceId, c.workspaceId),
          ),
        )
        .returning()
    )[0],
  );
}
/** The server checks open owned Tasks and Schedules before invoking this operation. */
export async function deleteMember(c: Context, userId: string) {
  requireAdmin(c);
  const member = await requireMember(c, userId);
  if (
    member.role === "owner" ||
    (member.role === "admin" && c.role !== "owner")
  )
    throw new DomainError("forbidden");
  await c.tx
    .delete(members)
    .where(
      and(eq(members.workspaceId, c.workspaceId), eq(members.userId, userId)),
    );
  const user = required(
    (
      await c.tx
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId))
    )[0],
  );
  await c.tx
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(invitations.workspaceId, c.workspaceId),
        eq(invitations.email, user.email.toLowerCase()),
      ),
    );
  await advanceCursor(c);
}
export async function advanceCursor(c: Context) {
  return required(
    (
      await c.tx
        .update(workspaces)
        .set({ cursor: sql`${workspaces.cursor}+1` })
        .where(eq(workspaces.id, c.workspaceId))
        .returning({ cursor: workspaces.cursor })
    )[0],
  ).cursor;
}
export async function getCursor(c: Context) {
  return required(
    (
      await c.tx
        .select({ cursor: workspaces.cursor })
        .from(workspaces)
        .where(eq(workspaces.id, c.workspaceId))
    )[0],
  ).cursor;
}

/** Complete bounded audience; refuse an oversized audience rather than silently omitting recipients. */
export async function getWorkspaceAudience(c: Context) {
  const audience = await c.tx
    .select({ userId: members.userId })
    .from(members)
    .where(eq(members.workspaceId, c.workspaceId))
    .orderBy(members.userId)
    .limit(501);
  if (audience.length > 500)
    throw new DomainError("unavailable", "Audience exceeds initial limit");
  return audience.map((row) => row.userId);
}

const memberSorts = { name: textKey(users.name) };
export const MEMBER_SORTS = sortNames(memberSorts);
/** Bounded human member directory; auth account/session data is never returned. */
export async function getMembers(
  c: Context,
  input: PageOptions & {
    sort?: string;
    order?: string;
    role?: Role;
    query?: string;
  } = {},
) {
  requireHuman(c);
  const plan = sortPlan({
    operation: "getMembers",
    scope: c,
    filter: input,
    keys: memberSorts,
    id: members.userId,
    idKind: "text",
  });
  const rows = await c.tx
    .select({
      userId: members.userId,
      name: users.name,
      role: members.role,
      position: plan.position,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(
      and(
        eq(members.workspaceId, c.workspaceId),
        input.role ? eq(members.role, input.role) : undefined,
        input.query ? matchesText(users.name, input.query) : undefined,
        plan.where,
      ),
    )
    .orderBy(...plan.orderBy)
    .limit(plan.limit + 1);
  return pageOf(rows, plan, (row) => row.userId);
}
/** The server checks owned Tasks and Schedules before a demotion to viewer. */
export async function updateMemberRole(
  c: Context,
  userId: string,
  role: "admin" | "contributor" | "viewer",
) {
  requireAdmin(c);
  const member = await requireMember(c, userId);
  if (
    member.role === "owner" ||
    ((member.role === "admin" || role === "admin") && c.role !== "owner")
  )
    throw new DomainError("forbidden");
  const updated = required(
    (
      await c.tx
        .update(members)
        .set({ role })
        .where(
          and(
            eq(members.workspaceId, c.workspaceId),
            eq(members.userId, userId),
          ),
        )
        .returning({ userId: members.userId, role: members.role })
    )[0],
  );
  await advanceCursor(c);
  return updated;
}
/** Rechecks the current invitation before an explicit delivery retry. */
export async function getInvitation(c: Context, id: string) {
  requireAdmin(c);
  const invitation = required(
    (
      await c.tx
        .select()
        .from(invitations)
        .where(
          and(
            eq(invitations.workspaceId, c.workspaceId),
            eq(invitations.id, id),
          ),
        )
    )[0],
  );
  if (
    invitation.revokedAt ||
    invitation.acceptedAt ||
    invitation.expiresAt <= new Date()
  )
    throw new DomainError("conflict");
  if (invitation.role === "admin" && c.role !== "owner")
    throw new DomainError("forbidden");
  return invitation;
}
