import { createHash } from "node:crypto";
import type { NativeSessionStorage } from "@otto/sessions/native";
import { DomainError, required } from "@otto/shared";
import { type Context, requireHuman, requireWriter } from "@otto/workspaces";
import { and, asc, eq, gt } from "drizzle-orm";
import {
  type NativeActionResult,
  nativeActionInput,
  runActions,
} from "./action-schema";
import { getRun } from "./index";
import { type AuthorizeSources, assertRunAttempt } from "./runtime";
import { runs } from "./schema";

export {
  type NativeActionInput,
  type NativeActionResult,
  nativeActionInput,
} from "./action-schema";

type Action = typeof runActions.$inferSelect;
type Run = typeof runs.$inferSelect;

function digestOf(
  input: Pick<
    Action,
    | "workspaceId"
    | "runId"
    | "toolCallId"
    | "attempt"
    | "launchKey"
    | "sponsorId"
    | "agentId"
    | "input"
  >,
) {
  const encoded = JSON.stringify(input, (_key, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
        )
      : value,
  );
  if (Buffer.byteLength(encoded) > 131072)
    throw new DomainError("invalid", "Action input limit");
  return createHash("sha256").update(encoded).digest("hex");
}

function identity(row: Action) {
  return {
    workspaceId: row.workspaceId,
    runId: row.runId,
    toolCallId: row.toolCallId,
    attempt: row.attempt,
    launchKey: row.launchKey,
    sponsorId: row.sponsorId,
    agentId: row.agentId,
    input: row.input,
  };
}

function receipt(row: Action) {
  return {
    id: row.id,
    runId: row.runId,
    toolCallId: row.toolCallId,
    type: row.input.type,
    digest: row.digest,
    status: row.status,
    proposedByAgentId: row.agentId,
    resolvedBy: row.resolvedBy,
    result: row.result,
    resolvedAt: row.resolvedAt,
  };
}

export async function createRunAction(
  c: Context,
  run: Run,
  request: { toolCallId: string; input: unknown },
  native?: NativeSessionStorage,
  authorizeSources?: AuthorizeSources,
) {
  if (
    c.actor.agentId !== run.agentId ||
    c.actor.userId !== run.sponsorId ||
    !request.toolCallId ||
    request.toolCallId.length > 200
  )
    throw new DomainError("forbidden");
  await assertRunAttempt(
    c,
    {
      runId: run.id,
      agentId: run.agentId,
      attempt: run.attempt,
      launchKey: run.launchKey,
    },
    undefined,
    native,
    authorizeSources,
  );
  const parsed = nativeActionInput.safeParse(request.input);
  if (!parsed.success)
    throw new DomainError("invalid", "Invalid native action");
  const input = {
    workspaceId: c.workspaceId,
    runId: run.id,
    toolCallId: request.toolCallId,
    attempt: run.attempt,
    launchKey: run.launchKey,
    sponsorId: run.sponsorId,
    agentId: run.agentId,
    input: parsed.data,
  };
  const digest = digestOf(input);
  const prior = (
    await c.tx
      .select()
      .from(runActions)
      .where(
        and(
          eq(runActions.runId, run.id),
          eq(runActions.toolCallId, request.toolCallId),
        ),
      )
  )[0];
  if (prior) {
    if (prior.digest !== digest)
      throw new DomainError("conflict", "Action identity changed");
    return receipt(prior);
  }
  return receipt(
    required(
      (
        await c.tx
          .insert(runActions)
          .values({ ...input, digest })
          .returning()
      )[0],
    ),
  );
}

export async function getRunAction(
  c: Context,
  run: Run,
  actionId: string,
  native?: NativeSessionStorage,
  authorizeSources?: AuthorizeSources,
) {
  await assertRunAttempt(
    c,
    {
      runId: run.id,
      agentId: run.agentId,
      attempt: run.attempt,
      launchKey: run.launchKey,
    },
    undefined,
    native,
    authorizeSources,
  );
  const row = required(
    (
      await c.tx
        .select()
        .from(runActions)
        .where(
          and(
            eq(runActions.id, actionId),
            eq(runActions.workspaceId, c.workspaceId),
            eq(runActions.runId, run.id),
          ),
        )
    )[0],
  );
  if (
    row.attempt !== run.attempt ||
    row.launchKey !== run.launchKey ||
    row.sponsorId !== c.actor.userId ||
    (c.actor.agentId && row.agentId !== c.actor.agentId)
  )
    throw new DomainError("forbidden");
  return receipt(row);
}

export async function getRunActions(
  c: Context,
  runId: string,
  filter: { after?: string; status?: Action["status"] } = {},
) {
  requireHuman(c);
  await getRun(c, runId);
  const run = required(
    (
      await c.tx
        .select()
        .from(runs)
        .where(and(eq(runs.id, runId), eq(runs.workspaceId, c.workspaceId)))
    )[0],
  );
  if (run.sponsorId !== c.actor.userId) throw new DomainError("forbidden");
  const rows = await c.tx
    .select()
    .from(runActions)
    .where(
      and(
        eq(runActions.workspaceId, c.workspaceId),
        eq(runActions.runId, runId),
        eq(runActions.sponsorId, c.actor.userId),
        filter.status ? eq(runActions.status, filter.status) : undefined,
        filter.after ? gt(runActions.id, filter.after) : undefined,
      ),
    )
    .orderBy(asc(runActions.id))
    .limit(101);
  const items = rows.slice(0, 100).map((row) => ({
    ...receipt(row),
    input: row.input,
    createdAt: row.createdAt,
  }));
  return { items, next: rows.length > 100 ? required(items.at(-1)).id : null };
}

export async function resolveRunAction(
  c: Context,
  runId: string,
  actionId: string,
  decision: { decision: "approve" | "deny"; digest: string },
  execute: (
    c: Context,
    input: Action["input"],
    actionId: string,
  ) => Promise<NativeActionResult>,
  native?: NativeSessionStorage,
  authorizeSources?: AuthorizeSources,
) {
  requireHuman(c);
  requireWriter(c);
  const row = required(
    (
      await c.tx
        .select()
        .from(runActions)
        .where(
          and(
            eq(runActions.id, actionId),
            eq(runActions.runId, runId),
            eq(runActions.workspaceId, c.workspaceId),
          ),
        )
        .for("update")
    )[0],
  );
  if (row.sponsorId !== c.actor.userId) throw new DomainError("forbidden");
  if (row.digest !== decision.digest || row.digest !== digestOf(identity(row)))
    throw new DomainError("conflict", "Action payload changed");
  await assertRunAttempt(
    c,
    {
      runId,
      agentId: row.agentId,
      attempt: row.attempt,
      launchKey: row.launchKey,
    },
    undefined,
    native,
    authorizeSources,
  );
  const status = decision.decision === "approve" ? "approved" : "denied";
  if (row.status !== "pending") {
    if (row.status !== status || row.resolvedBy !== c.actor.userId)
      throw new DomainError("conflict", "Action already resolved");
    return receipt(row);
  }
  const parsed = nativeActionInput.safeParse(row.input);
  if (!parsed.success) throw new DomainError("invalid");
  const result =
    status === "approved" ? await execute(c, parsed.data, row.id) : null;
  return receipt(
    required(
      (
        await c.tx
          .update(runActions)
          .set({
            status,
            result,
            resolvedBy: c.actor.userId,
            resolvedAt: new Date(),
          })
          .where(eq(runActions.id, row.id))
          .returning()
      )[0],
    ),
  );
}
