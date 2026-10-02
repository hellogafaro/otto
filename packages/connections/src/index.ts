import { getAgent } from "@otto/agents";
import { DomainError, required } from "@otto/db";
import {
  advanceRevision,
  type Context,
  requireAdmin,
  requireHuman,
  requireMember,
} from "@otto/workspaces";
import { and, eq, isNull } from "drizzle-orm";
import { connections, grants, operations } from "./schema";
/** Registers account metadata only. Provider credentials and private native login are never accepted here. */
export async function createConnection(
  c: Context,
  input: {
    name: string;
    kind: "github" | "mcp" | "model";
    accountRef: string;
    mode: "service" | "native_subscription";
  },
) {
  requireAdmin(c);
  if ((input.kind === "model") !== (input.mode === "native_subscription"))
    throw new DomainError("invalid");
  const row = required(
    (
      await c.tx
        .insert(connections)
        .values({
          ...input,
          workspaceId: c.workspaceId,
          ownerId: c.actor.userId,
        })
        .returning()
    )[0],
  );
  await advanceRevision(c);
  return { id: row.id, name: row.name, connected: row.connected };
}
export async function getConnection(c: Context, id: string) {
  return required(
    (
      await c.tx
        .select()
        .from(connections)
        .where(
          and(
            eq(connections.id, id),
            eq(connections.workspaceId, c.workspaceId),
          ),
        )
    )[0],
  );
}
export async function grantConnection(
  c: Context,
  connectionId: string,
  input: {
    agentId: string;
    resources: string[];
    operations: Record<string, "allowed" | "confirmation" | "disabled">;
  },
) {
  requireAdmin(c);
  const connection = await getConnection(c, connectionId);
  if (!connection.connected || connection.ownerId !== c.actor.userId)
    throw new DomainError("forbidden");
  await getAgent(c, input.agentId);
  const values = {
    ...input,
    connectionId,
    sponsorId: c.actor.userId,
    revokedAt: null,
  };
  await c.tx
    .insert(grants)
    .values(values)
    .onConflictDoUpdate({
      target: [grants.connectionId, grants.agentId],
      set: values,
    });
  await advanceRevision(c);
}
export async function snapshotGrants(c: Context, agentId: string) {
  const rows = await c.tx
    .select({ grant: grants, connection: connections })
    .from(grants)
    .innerJoin(connections, eq(connections.id, grants.connectionId))
    .where(
      and(
        eq(grants.agentId, agentId),
        eq(connections.workspaceId, c.workspaceId),
        eq(connections.connected, true),
        isNull(grants.revokedAt),
      ),
    )
    .limit(51);
  if (rows.length > 50)
    throw new DomainError("unavailable", "Connection limit");
  for (const row of rows) await requireMember(c, row.grant.sponsorId, true);
  return rows.map(({ grant, connection }) => ({
    id: grant.id,
    connectionId: connection.id,
    configToken: connection.configToken,
    resources: grant.resources,
    operations: grant.operations,
    sponsorId: grant.sponsorId,
  }));
}
export async function disconnectConnection(c: Context, id: string) {
  requireAdmin(c);
  const row = await getConnection(c, id);
  if (row.ownerId !== c.actor.userId) throw new DomainError("forbidden");
  await c.tx
    .update(connections)
    .set({ connected: false, configToken: row.configToken + 1 })
    .where(eq(connections.id, id));
  await c.tx
    .update(grants)
    .set({ revokedAt: new Date() })
    .where(eq(grants.connectionId, id));
  await advanceRevision(c);
}
/** Trusted Run/tool composition calls this after validating the current Run and output audience. No external write occurs here. */
export async function requestOperation(
  c: Context,
  input: {
    connectionId: string;
    agentId: string;
    runId: string;
    requestId: string;
    action: string;
    target: string;
  },
) {
  const connection = await getConnection(c, input.connectionId);
  if (!connection.connected) throw new DomainError("forbidden");
  const grant = required(
    (
      await c.tx
        .select()
        .from(grants)
        .where(
          and(
            eq(grants.connectionId, input.connectionId),
            eq(grants.agentId, input.agentId),
            isNull(grants.revokedAt),
          ),
        )
    )[0],
    "forbidden",
  );
  await requireMember(c, grant.sponsorId, true);
  if (
    grant.sponsorId !== c.actor.userId ||
    !grant.resources.includes(input.target)
  )
    throw new DomainError("forbidden");
  const policy = grant.operations[input.action];
  if (!policy || policy === "disabled") throw new DomainError("forbidden");
  const existing = (
    await c.tx
      .select()
      .from(operations)
      .where(
        and(
          eq(operations.runId, input.runId),
          eq(operations.requestId, input.requestId),
        ),
      )
  )[0];
  if (existing) {
    if (
      existing.connectionId !== input.connectionId ||
      existing.target !== input.target ||
      existing.action !== input.action ||
      existing.accountRef !== connection.accountRef
    )
      throw new DomainError("conflict");
    return existing;
  }
  return required(
    (
      await c.tx
        .insert(operations)
        .values({
          ...input,
          workspaceId: c.workspaceId,
          sponsorId: grant.sponsorId,
          accountRef: connection.accountRef,
          state: policy === "confirmation" ? "awaiting_approval" : "approved",
        })
        .returning()
    )[0],
  );
}
export async function approveOperation(c: Context, id: string) {
  requireHuman(c);
  const operation = required(
    (
      await c.tx
        .select()
        .from(operations)
        .where(
          and(eq(operations.id, id), eq(operations.workspaceId, c.workspaceId)),
        )
    )[0],
  );
  if (
    operation.sponsorId !== c.actor.userId ||
    operation.state !== "awaiting_approval"
  )
    throw new DomainError("forbidden");
  const connection = await getConnection(c, operation.connectionId);
  if (!connection.connected) throw new DomainError("forbidden");
  if (connection.accountRef !== operation.accountRef)
    throw new DomainError("conflict");
  await c.tx
    .update(operations)
    .set({
      state: "approved",
      approvedBy: c.actor.userId,
      expiresAt: new Date(Date.now() + 5 * 60000),
    })
    .where(eq(operations.id, id));
}
/** A lost external acknowledgement is durable uncertainty, never success or permission to retry. */
export async function markOperationUncertain(c: Context, id: string) {
  await c.tx
    .update(operations)
    .set({ state: "uncertain" })
    .where(
      and(
        eq(operations.id, id),
        eq(operations.workspaceId, c.workspaceId),
        eq(operations.state, "executing"),
      ),
    );
}
