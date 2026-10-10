import { getAgent } from "@otto/agents";
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
import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
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
  await requireMember(c, row.createdBy);
  if (row.visibility === "user" && row.createdBy !== c.actor.userId)
    throw new DomainError("forbidden");
  return row;
}
export function connectionView(row: typeof connections.$inferSelect) {
  return {
    id: row.id,
    createdBy: row.createdBy,
    visibility: row.visibility,
    title: row.title,
    type: row.type,
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
    title: string;
    type: "github" | "mcp";
    accountRef: string;
    visibility?: "user" | "workspace";
  },
) {
  requireHuman(c);
  requireWriter(c);
  const parsed = parseInput(
    z
      .object({
        title: z.string().min(1).max(200),
        type: z.enum(["github", "mcp"]),
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
          workspaceId: c.workspaceId,
          createdBy: c.actor.userId,
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
export async function getConnectionDetails(c: Context, id: string) {
  requireHuman(c);
  const row = await getConnectionRecord(c, id);
  const config = row.config ? CONNECTION_CONFIG.parse(row.config) : null;
  const target = (value: string) => {
    try {
      const uri = new URL(value);
      uri.username = "";
      uri.password = "";
      uri.search = "";
      uri.hash = "";
      return uri.href;
    } catch {
      if (
        /^[a-z][a-z0-9+.-]*:|:\/\/|^\/\/|^https?[/\\]|[?&#](?:access[_-]?token|api[_-]?key|auth|password|secret|credential|token|key)\s*=/i.test(
          value,
        )
      )
        return "[redacted target]";
      return value;
    }
  };
  const scope = !config
    ? null
    : config.type === "github"
      ? {
          type: config.type,
          repositories: config.repositories.map(({ id, name }) => ({
            id,
            name,
          })),
          permissions: { ...config.permissions },
        }
      : {
          type: config.type,
          authentication: config.authentication ?? "bearer",
          tools: config.tools.map(({ name, targetArgument, readOnly }) => ({
            name,
            targetArgument,
            readOnly,
          })),
          resources: config.resources.map(target),
        };
  return {
    ...connectionView(row),
    observation: "cached" as const,
    scope,
    discovery: row.discovery
      ? {
          actions: row.discovery.actions.slice(0, 100),
          resources: row.discovery.resources.slice(0, 100).map(target),
        }
      : null,
  };
}
const connectionSorts = {
  title: textKey(connections.title),
  createdAt: timeKey(connections.createdAt),
  updatedAt: timeKey(connections.updatedAt),
};
export const CONNECTION_SORTS = sortNames(connectionSorts);
/** Filters narrow only the caller's readable Connections; account and credential references are never filterable. */
export async function getConnections(
  c: Context,
  filter: PageOptions & {
    sort?: string;
    order?: string;
    type?: "github" | "mcp";
    visibility?: "user" | "workspace";
    createdBy?: string;
    connected?: boolean;
    query?: string;
  } = {},
) {
  requireHuman(c);
  const {
    after: _after,
    limit: _limit,
    sort: _sort,
    order: _order,
    ...filters
  } = filter;
  const parsed = parseInput(
    z
      .object({
        type: z.enum(["github", "mcp"]).optional(),
        visibility: z.enum(["user", "workspace"]).optional(),
        createdBy: z.string().min(1).max(128).optional(),
        connected: z.boolean().optional(),
        query: z.string().max(200).optional(),
      })
      .strict(),
    filters,
  );
  const plan = sortPlan({
    operation: "getConnections",
    scope: c,
    filter,
    keys: connectionSorts,
    id: connections.id,
  });
  const rows = await c.tx
    .select({ id: connections.id, position: plan.position })
    .from(connections)
    .where(
      and(
        eq(connections.workspaceId, c.workspaceId),
        or(
          eq(connections.createdBy, c.actor.userId),
          eq(connections.visibility, "workspace"),
        ),
        creatorIsMember(c, connections.createdBy),
        parsed.type ? eq(connections.type, parsed.type) : undefined,
        parsed.visibility
          ? eq(connections.visibility, parsed.visibility)
          : undefined,
        parsed.createdBy
          ? eq(connections.createdBy, parsed.createdBy)
          : undefined,
        parsed.connected === undefined
          ? undefined
          : eq(connections.connected, parsed.connected),
        parsed.query ? matchesText(connections.title, parsed.query) : undefined,
        plan.where,
      ),
    )
    .orderBy(...plan.orderBy)
    .limit(plan.limit + 1);
  return authorizedPage(
    pageOf(rows, plan, (row) => row.id),
    (row) => getConnection(c, row.id),
    plan,
  );
}
/** Deployment-approved credential references only; the resolver independently binds workspace and Connection. */
export async function updateConnection(
  c: Context,
  id: string,
  input: {
    title?: string;
    visibility?: "user" | "workspace";
    credentialRef?: string;
    config?: z.infer<typeof CONNECTION_CONFIG>;
    editToken?: number;
  },
) {
  requireHuman(c);
  requireWriter(c);
  const row = await getConnectionRecord(c, id);
  if (row.createdBy !== c.actor.userId) throw new DomainError("forbidden");
  const parsed = parseInput(
    z
      .object({
        title: z.string().min(1).max(200).optional(),
        visibility: z.enum(["user", "workspace"]).optional(),
        editToken: z.number().int().nonnegative().optional(),
        credentialRef: z.string().min(1).max(200).optional(),
        config: CONNECTION_CONFIG.optional(),
      })
      .strict(),
    input,
  );
  const policyChanged =
    parsed.visibility !== undefined ||
    parsed.config !== undefined ||
    parsed.credentialRef !== undefined;
  if (policyChanged && parsed.editToken !== row.editToken)
    throw new DomainError("conflict", "Connection changed");
  const { editToken: _editToken, ...changes } = parsed;
  if (Object.values(changes).every((value) => value === undefined))
    throw new DomainError("invalid", "No editable fields");
  if (parsed.config && parsed.config.type !== row.type)
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
      editToken: policyChanged ? row.editToken + 1 : undefined,
      updatedAt: new Date(),
    })
    .where(eq(connections.id, id));
  if (policyChanged)
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
    connection.createdBy !== c.actor.userId ||
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
    (agent.createdBy !== connection.createdBy ||
      parsed.audience.humans.some((id) => id !== connection.createdBy))
  )
    throw new DomainError("forbidden", "User-scoped Connection audience");
  for (const id of parsed.audience.humans) await requireMember(c, id);
  for (const id of parsed.audience.agents) {
    const recipient = await getAgent(c, id);
    if (
      connection.visibility === "user" &&
      recipient.createdBy !== connection.createdBy
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
  if (row.createdBy !== c.actor.userId) throw new DomainError("forbidden");
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
      row.connection.createdBy !== c.actor.userId
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
  if (row.createdBy !== c.actor.userId) throw new DomainError("forbidden");
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
