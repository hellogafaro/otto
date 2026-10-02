import { createHash } from "node:crypto";
import {
  DomainError,
  filterPage,
  getPage,
  parseInput,
  parsePageOptions,
  required,
} from "@otto/shared";

import { type Context, requireHuman, requireMember } from "@otto/workspaces";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { githubAction } from "./github";
import { getConnectionRecord } from "./lifecycle";
import { mcpAction } from "./mcp";
import { connections, grants, operations } from "./schema";
import {
  CONNECTION_AUDIENCE,
  CONNECTION_CONFIG,
  type ConnectionAudience,
  type JsonValue,
  OPERATION_APPROVAL,
  OPERATION_REQUEST,
  type OperationRequest,
  type OperationResult,
  type RunProof,
} from "./types";

export type ValidateRun = (
  c: Context,
  proof: RunProof,
) => Promise<{ agentId: string; audience: ConnectionAudience }>;
/** Server composition must validate current Run, attempt, sponsor, saved/current audience and Environment generation. */
export interface ConnectionBoundary {
  transact<T>(work: (c: Context) => Promise<T>): Promise<T>;
  validateRun: ValidateRun;
  /** Called under the same workspace transaction as the final grant check and result persistence. */
  publishResult(c: Context, result: OperationResult): Promise<void>;
}
export function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson(value[key] ?? null)}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
export async function authorizeOperation(
  c: Context,
  input: OperationRequest,
  validateRun: ValidateRun,
) {
  const validated = await validateRun(c, {
    runId: input.runId,
    launchKey: input.launchKey,
    attempt: input.attempt,
    environmentGeneration: input.environmentGeneration,
  });
  const agentId = validated.agentId;
  const parsedAudience = parseInput(CONNECTION_AUDIENCE, validated.audience);
  const audience = {
    humans: [...new Set(parsedAudience.humans)].sort(),
    agents: [...new Set(parsedAudience.agents)].sort(),
  };
  if (c.actor.agentId && c.actor.agentId !== agentId)
    throw new DomainError("forbidden");
  const connection = await getConnectionRecord(c, input.connectionId);
  if (!connection.connected || !connection.config || !connection.credentialRef)
    throw new DomainError("forbidden");
  const grant = required(
    (
      await c.tx
        .select()
        .from(grants)
        .where(
          and(
            eq(grants.connectionId, connection.id),
            eq(grants.agentId, agentId),
            isNull(grants.revokedAt),
          ),
        )
    )[0],
    "forbidden",
  );
  await requireMember(c, grant.sponsorId, true);
  const policy = grant.operations[input.action];
  if (
    !grant.audience ||
    audience.humans.some((id) => !grant.audience?.humans.includes(id)) ||
    audience.agents.some((id) => !grant.audience?.agents.includes(id)) ||
    grant.sponsorId !== connection.ownerId ||
    !grant.resources.includes(input.target) ||
    !policy ||
    policy === "disabled"
  )
    throw new DomainError("forbidden");
  const config = parseInput(CONNECTION_CONFIG, connection.config);
  const mapped =
    config.type === "github"
      ? githubAction(config, input.action, input.target, input.arguments)
      : mcpAction(config, input.action, input.target, input.arguments);
  const identity = createHash("sha256")
    .update(
      canonicalJson({
        ...input,
        agentId,
        audience,
        sponsorId: c.actor.userId,
        accountRef: connection.accountRef,
        editToken: connection.editToken,
        grantGeneration: grant.generation,
      }),
    )
    .digest("hex");
  return {
    connection,
    grant,
    agentId,
    audience,
    policy,
    identity,
    isWrite: mapped.isWrite,
  };
}
export function operationRequest(
  row: typeof operations.$inferSelect,
): OperationRequest {
  return parseInput(OPERATION_REQUEST, {
    runId: row.runId,
    launchKey: row.launchKey,
    attempt: row.attempt,
    environmentGeneration: row.environmentGeneration,
    connectionId: row.connectionId,
    requestId: row.requestId,
    action: row.action,
    target: row.target,
    arguments: row.arguments,
  });
}
export async function getOperationRecord(c: Context, id: string) {
  return required(
    (
      await c.tx
        .select()
        .from(operations)
        .where(
          and(eq(operations.id, id), eq(operations.workspaceId, c.workspaceId)),
        )
    )[0],
  );
}
export function operationView(row: typeof operations.$inferSelect) {
  return {
    id: row.id,
    connectionId: row.connectionId,
    runId: row.runId,
    action: row.action,
    target: row.target,
    arguments: row.arguments,
    audience: row.audience,
    identity: row.identity,
    state: row.state,
    expiresAt: row.expiresAt,
    retryCount: row.retryCount,
    outcome: row.outcome,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
export async function getOperation(c: Context, id: string) {
  requireHuman(c);
  const row = await getOperationRecord(c, id);
  await getConnectionRecord(c, row.connectionId);
  if (row.sponsorId !== c.actor.userId) throw new DomainError("forbidden");
  return operationView(row);
}
export async function getOperations(
  c: Context,
  filter: {
    connectionId?: string;
    state?: (typeof operations.$inferSelect)["state"];
    after?: string;
    limit?: number;
  } = {},
) {
  requireHuman(c);
  const { after, limit } = parsePageOptions(filter);
  const { after: _after, limit: _limit, ...filters } = filter;
  const parsed = parseInput(
    z
      .object({
        connectionId: z.uuid().optional(),
        state: z
          .enum([
            "awaiting_approval",
            "approved",
            "executing",
            "succeeded",
            "failed",
            "uncertain",
          ])
          .optional(),
      })
      .strict(),
    filters,
  );
  if (parsed.connectionId) {
    await getConnectionRecord(c, parsed.connectionId);
  }
  const rows = await c.tx
    .select({ operation: operations })
    .from(operations)
    .innerJoin(connections, eq(connections.id, operations.connectionId))
    .where(
      and(
        eq(operations.workspaceId, c.workspaceId),
        eq(connections.workspaceId, c.workspaceId),
        or(
          eq(connections.ownerId, c.actor.userId),
          eq(connections.visibility, "workspace"),
        ),
        parsed.connectionId
          ? eq(operations.connectionId, parsed.connectionId)
          : undefined,
        after ? gt(operations.id, after) : undefined,
        eq(operations.sponsorId, c.actor.userId),
        parsed.state ? eq(operations.state, parsed.state) : undefined,
      ),
    )
    .orderBy(operations.id)
    .limit(limit + 1);
  const page = getPage(rows, (row) => row.operation.id, limit);
  return filterPage(page, ({ operation }) => getOperation(c, operation.id));
}
export async function requestOperation(
  c: Context,
  input: OperationRequest,
  validateRun: ValidateRun,
) {
  const parsed = parseInput(OPERATION_REQUEST, input);
  if (Buffer.byteLength(canonicalJson(parsed.arguments)) > 32768)
    throw new DomainError("invalid", "Operation arguments exceed limit");
  const authorized = await authorizeOperation(c, parsed, validateRun);
  const existing = (
    await c.tx
      .select()
      .from(operations)
      .where(
        and(
          eq(operations.runId, parsed.runId),
          eq(operations.requestId, parsed.requestId),
        ),
      )
  )[0];
  if (existing) {
    if (
      existing.workspaceId !== c.workspaceId ||
      existing.identity !== authorized.identity
    )
      throw new DomainError("conflict");
    return operationView(existing);
  }
  const row = required(
    (
      await c.tx
        .insert(operations)
        .values({
          ...parsed,
          workspaceId: c.workspaceId,
          agentId: authorized.agentId,
          audience: authorized.audience,
          sponsorId: c.actor.userId,
          accountRef: authorized.connection.accountRef,
          editToken: authorized.connection.editToken,
          grantGeneration: authorized.grant.generation,
          identity: authorized.identity,
          isWrite: authorized.isWrite,
          state:
            authorized.policy === "confirmation"
              ? "awaiting_approval"
              : "approved",
          expiresAt: new Date(Date.now() + 300_000),
        })
        .returning()
    )[0],
  );
  return operationView(row);
}
export async function validateOperation(
  c: Context,
  row: typeof operations.$inferSelect,
  validateRun: ValidateRun,
) {
  const current = await authorizeOperation(
    c,
    operationRequest(row),
    validateRun,
  );
  if (row.identity !== current.identity || row.agentId !== current.agentId)
    throw new DomainError("conflict");
  if (!row.expiresAt || row.expiresAt.getTime() <= Date.now())
    throw new DomainError("forbidden", "Operation approval expired");
  return current;
}
/** Human approves the exact displayed request digest, never an id with mutable arguments. */
export async function approveOperation(
  c: Context,
  id: string,
  input: z.infer<typeof OPERATION_APPROVAL>,
  validateRun: ValidateRun,
) {
  requireHuman(c);
  const parsed = parseInput(OPERATION_APPROVAL, input);
  const row = await getOperationRecord(c, id);
  if (row.sponsorId !== c.actor.userId || row.state !== "awaiting_approval")
    throw new DomainError("forbidden");
  await validateOperation(c, row, validateRun);
  if (parsed.identity !== row.identity) throw new DomainError("conflict");
  return operationView(
    required(
      (
        await c.tx
          .update(operations)
          .set({
            state: "approved",
            approvedBy: c.actor.userId,
            expiresAt: new Date(Date.now() + 300_000),
            updatedAt: new Date(),
          })
          .where(eq(operations.id, id))
          .returning()
      )[0],
    ),
  );
}
/** Only failed reads can be retried. A protected write with an unknown outcome requires out-of-band reconciliation. */
export async function retryOperation(
  c: Context,
  id: string,
  validateRun: ValidateRun,
) {
  const row = await getOperationRecord(c, id);
  await validateOperation(c, row, validateRun);
  if (row.state !== "failed" || row.isWrite || row.retryCount >= 2)
    throw new DomainError("conflict", "Operation cannot be retried");
  return operationView(
    required(
      (
        await c.tx
          .update(operations)
          .set({
            state: "approved",
            retryCount: row.retryCount + 1,
            outcome: null,
            executionToken: null,
            updatedAt: new Date(),
          })
          .where(eq(operations.id, id))
          .returning()
      )[0],
    ),
  );
}
