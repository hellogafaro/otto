import { getAgent } from "@otto/agents";
import {
  DomainError,
  filterPage,
  getPage,
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
import { and, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { connections, grants } from "./schema";
import {
  CONNECTION_AUDIENCE,
  CONNECTION_CONFIG,
  type ConnectionAudience,
} from "./types";

export async function getConnectionRecord(c: Context, id: string) {
  const row = required(
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
  await requireMember(c, row.ownerId);
  if (row.visibility === "user" && row.ownerId !== c.actor.userId)
    throw new DomainError("forbidden");
  return row;
}
export function connectionView(row: typeof connections.$inferSelect) {
  return {
    id: row.id,
    ownerId: row.ownerId,
    visibility: row.visibility,
    name: row.name,
    type: row.type,
    mode: row.mode,
    connected: row.connected,
    editToken: row.editToken,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
export async function createConnection(
  c: Context,
  input: {
    name: string;
    type: "github" | "mcp" | "model";
    accountRef: string;
    visibility?: "user" | "workspace";
  },
) {
  requireHuman(c);
  requireWriter(c);
  const parsed = parseInput(
    z
      .object({
        name: z.string().min(1).max(200),
        type: z.enum(["github", "mcp", "model"]),
        accountRef: z.string().min(1).max(200),
        visibility: z.enum(["user", "workspace"]).default("user"),
      })
      .strict(),
    input,
  );
  const row = required(
    (
      await c.tx
        .insert(connections)
        .values({
          ...parsed,
          mode: parsed.type === "model" ? "native_subscription" : "service",
          workspaceId: c.workspaceId,
          ownerId: c.actor.userId,
        })
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return connectionView(row);
}
export async function getConnection(c: Context, id: string) {
  const row = await getConnectionRecord(c, id);
  return connectionView(row);
}
export async function getConnections(
  c: Context,
  filter: {
    type?: "github" | "mcp" | "model";
    limit?: number;
    after?: string;
  } = {},
) {
  requireHuman(c);
  const { after, limit } = parsePageOptions(filter);
  const { after: _after, limit: _limit, ...filters } = filter;
  const parsed = parseInput(
    z
      .object({
        type: z.enum(["github", "mcp", "model"]).optional(),
      })
      .strict(),
    filters,
  );
  const rows = await c.tx
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.workspaceId, c.workspaceId),
        or(
          eq(connections.ownerId, c.actor.userId),
          eq(connections.visibility, "workspace"),
        ),
        parsed.type ? eq(connections.type, parsed.type) : undefined,
        after ? gt(connections.id, after) : undefined,
      ),
    )
    .orderBy(connections.id)
    .limit(limit + 1);
  const page = getPage(rows, (row) => row.id, limit);
  return filterPage(page, (row) => getConnection(c, row.id));
}
/** Deployment-approved credential references only; the resolver independently binds workspace and Connection. */
export async function updateConnection(
  c: Context,
  id: string,
  input: {
    name?: string;
    visibility?: "user" | "workspace";
    credentialRef?: string;
    config?: z.infer<typeof CONNECTION_CONFIG>;
    editToken: number;
  },
) {
  requireHuman(c);
  requireWriter(c);
  const row = await getConnectionRecord(c, id);
  if (row.ownerId !== c.actor.userId) throw new DomainError("forbidden");
  const parsed = parseInput(
    z
      .object({
        name: z.string().min(1).max(200).optional(),
        visibility: z.enum(["user", "workspace"]).optional(),
        editToken: z.number().int().nonnegative(),
        credentialRef: z.string().min(1).max(200).optional(),
        config: CONNECTION_CONFIG.optional(),
      })
      .strict(),
    input,
  );
  if (parsed.editToken !== row.editToken)
    throw new DomainError("conflict", "Connection changed");
  const { editToken: _editToken, ...changes } = parsed;
  if (Object.values(changes).every((value) => value === undefined))
    throw new DomainError("invalid", "No editable fields");
  if (
    parsed.config &&
    (parsed.config.type !== row.type || row.mode !== "service")
  )
    throw new DomainError("invalid");
  if (
    parsed.config?.type === "github" &&
    row.accountRef !==
      `github:${parsed.config.accountId}:${parsed.config.installationId}`
  )
    throw new DomainError("conflict", "Account association changed");
  await c.tx
    .update(connections)
    .set({
      ...changes,
      connected: parsed.config || parsed.credentialRef ? false : undefined,
      discovery: parsed.config || parsed.credentialRef ? null : undefined,
      editToken: row.editToken + 1,
      updatedAt: new Date(),
    })
    .where(eq(connections.id, id));
  await c.tx
    .update(grants)
    .set({ revokedAt: new Date(), generation: sql`${grants.generation}+1` })
    .where(eq(grants.connectionId, id));
  await advanceCursor(c);
  return getConnection(c, id);
}
export async function grantConnectionAccess(
  c: Context,
  connectionId: string,
  input: {
    agentId: string;
    audience: ConnectionAudience;
    resources: string[];
    operations: Record<string, "allowed" | "confirmation" | "disabled">;
  },
) {
  requireHuman(c);
  requireWriter(c);
  const connection = await getConnectionRecord(c, connectionId);
  if (
    !connection.connected ||
    connection.ownerId !== c.actor.userId ||
    !connection.discovery
  )
    throw new DomainError("forbidden");
  const parsed = parseInput(
    z
      .object({
        agentId: z.uuid(),
        audience: CONNECTION_AUDIENCE,
        resources: z.array(z.string().min(1).max(2000)).max(100),
        operations: z.record(
          z.string().max(200),
          z.enum(["allowed", "confirmation", "disabled"]),
        ),
      })
      .strict(),
    input,
  );
  if (
    Object.keys(parsed.operations).length > 50 ||
    parsed.resources.some(
      (resource) => !connection.discovery?.resources.includes(resource),
    ) ||
    Object.keys(parsed.operations).some(
      (action) => !connection.discovery?.actions.includes(action),
    )
  )
    throw new DomainError("forbidden");
  const agent = await getAgent(c, parsed.agentId);
  if (
    connection.visibility === "user" &&
    (agent.ownerId !== connection.ownerId ||
      parsed.audience.humans.some((id) => id !== connection.ownerId))
  )
    throw new DomainError("forbidden", "User-scoped Connection audience");
  for (const id of parsed.audience.humans) await requireMember(c, id);
  for (const id of parsed.audience.agents) {
    const recipient = await getAgent(c, id);
    if (
      connection.visibility === "user" &&
      recipient.ownerId !== connection.ownerId
    )
      throw new DomainError("forbidden", "User-scoped Connection audience");
  }
  const values = {
    ...parsed,
    connectionId,
    sponsorId: c.actor.userId,
    revokedAt: null,
  };
  await c.tx
    .insert(grants)
    .values(values)
    .onConflictDoUpdate({
      target: [grants.connectionId, grants.agentId],
      set: { ...values, generation: sql`${grants.generation}+1` },
    });
  await advanceCursor(c);
}
export async function revokeConnectionAccess(
  c: Context,
  connectionId: string,
  agentId: string,
) {
  requireHuman(c);
  requireWriter(c);
  const row = await getConnectionRecord(c, connectionId);
  if (row.ownerId !== c.actor.userId) throw new DomainError("forbidden");
  await c.tx
    .update(grants)
    .set({ revokedAt: new Date(), generation: sql`${grants.generation}+1` })
    .where(
      and(eq(grants.connectionId, connectionId), eq(grants.agentId, agentId)),
    );
  await advanceCursor(c);
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
        isNotNull(grants.audience),
      ),
    )
    .limit(51);
  if (rows.length > 50)
    throw new DomainError("unavailable", "Connection limit");
  for (const row of rows) {
    await requireMember(c, row.grant.sponsorId, true);
    if (
      row.connection.visibility === "user" &&
      row.connection.ownerId !== c.actor.userId
    )
      throw new DomainError("forbidden", "User-scoped Connection dependency");
  }
  return rows.map(({ grant, connection }) => ({
    id: grant.id,
    connectionId: connection.id,
    editToken: connection.editToken,
    resources: grant.resources,
    operations: grant.operations,
    sponsorId: grant.sponsorId,
    audience: parseInput(CONNECTION_AUDIENCE, grant.audience),
  }));
}
export async function disconnectConnection(c: Context, id: string) {
  requireHuman(c);
  requireWriter(c);
  const row = await getConnectionRecord(c, id);
  if (row.ownerId !== c.actor.userId) throw new DomainError("forbidden");
  await c.tx
    .update(connections)
    .set({
      connected: false,
      editToken: row.editToken + 1,
      updatedAt: new Date(),
    })
    .where(eq(connections.id, id));
  await c.tx
    .update(grants)
    .set({ revokedAt: new Date(), generation: sql`${grants.generation}+1` })
    .where(eq(grants.connectionId, id));
  await advanceCursor(c);
  // GitHub installation tokens may remain valid until this deadline; they never leave the server.
  return { id, connected: false, externalCredentialExpiresAt: row.expiresAt };
}

/** Trusted computer inspection confirmed this exact native account; no login or fallback occurs here. */
export async function connectNativeAccount(c: Context, id: string) {
  requireHuman(c);
  requireWriter(c);
  const row = await getConnectionRecord(c, id);
  if (row.type !== "model" || row.mode !== "native_subscription")
    throw new DomainError("forbidden");
  if (row.connected) return;
  if (row.ownerId !== c.actor.userId) throw new DomainError("forbidden");
  await c.tx
    .update(connections)
    .set({ connected: true, updatedAt: new Date() })
    .where(eq(connections.id, id));
  await advanceCursor(c);
}
