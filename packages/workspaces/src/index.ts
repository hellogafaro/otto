import {
  type Database,
  DomainError,
  required,
  type Transaction,
} from "@otto/db";
import { and, eq, sql } from "drizzle-orm";
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
}
/** Serializes workspace mutations and cursor advancement with permission changes. No network I/O belongs in this transaction. */
export async function inWorkspace<T>(
  db: Database,
  workspaceId: string,
  actor: Actor,
  fn: (context: Context) => Promise<T>,
  write = true,
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
    return fn({ tx, workspaceId, actor, role: member.role });
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
  name: string,
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(72183001)`);
    if ((await tx.select().from(setup)).length)
      throw new DomainError("conflict", "Installation already claimed");
    required((await tx.select().from(users).where(eq(users.id, userId)))[0]);
    const workspace = required(
      (await tx.insert(workspaces).values({ name }).returning())[0],
    );
    await tx
      .insert(members)
      .values({ workspaceId: workspace.id, userId, role: "owner" });
    await tx.insert(setup).values({ id: 1 });
    return workspace;
  });
}
export async function getWorkspaces(db: Database, userId: string) {
  return db
    .select({ id: workspaces.id, name: workspaces.name, role: members.role })
    .from(members)
    .innerJoin(workspaces, eq(workspaces.id, members.workspaceId))
    .where(eq(members.userId, userId))
    .limit(100);
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
export async function revokeInvitation(c: Context, id: string) {
  requireAdmin(c);
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
        .returning({ id: invitations.id })
    )[0],
  );
}
/** The server checks open owned Tasks and Automations before invoking this operation. */
export async function removeMember(c: Context, userId: string) {
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
  await advanceRevision(c);
}
export async function advanceRevision(c: Context) {
  return required(
    (
      await c.tx
        .update(workspaces)
        .set({ revision: sql`${workspaces.revision}+1` })
        .where(eq(workspaces.id, c.workspaceId))
        .returning({ revision: workspaces.revision })
    )[0],
  ).revision;
}
export async function getRevision(c: Context) {
  return required(
    (
      await c.tx
        .select({ revision: workspaces.revision })
        .from(workspaces)
        .where(eq(workspaces.id, c.workspaceId))
    )[0],
  ).revision;
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
