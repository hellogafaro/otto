import { getAgent } from "@otto/agents";
import type { Database } from "@otto/db";
import { DomainError, required } from "@otto/shared";

import {
  advanceCursor,
  type Context,
  requireHuman,
  requireWriter,
} from "@otto/workspaces";
import { and, DrizzleQueryError, eq } from "drizzle-orm";
import { environments } from "./schema";
/** Creates a durable unavailable Environment record. It does not provision a computer. */
export async function createEnvironment(c: Context, agentId: string) {
  requireHuman(c);
  const agent = await getAgent(c, agentId);
  const environment = required(
    (
      await c.tx
        .insert(environments)
        .values({
          workspaceId: c.workspaceId,
          agentId,
          scope: agent.projectId ?? c.workspaceId,
        })
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return environment;
}
export async function getEnvironment(c: Context, agentId: string) {
  await getAgent(c, agentId);
  return required(
    (
      await c.tx
        .select()
        .from(environments)
        .where(
          and(
            eq(environments.workspaceId, c.workspaceId),
            eq(environments.agentId, agentId),
          ),
        )
    )[0],
  );
}
export async function claimEnvironment(
  c: Context,
  agentId: string,
  runId: string,
  generation: number,
) {
  const environment = await getEnvironment(c, agentId);
  if (environment.generation !== generation)
    throw new DomainError("conflict", "Environment changed");
  if (environment.activeRunId && environment.activeRunId !== runId)
    throw new DomainError("conflict", "Environment busy");
  if (environment.state !== "ready")
    throw new DomainError("unavailable", "compute_provider_not_selected");
  await c.tx
    .update(environments)
    .set({ activeRunId: runId })
    .where(eq(environments.id, environment.id));
  return environment;
}
/** No lease expiry can prove a remote process stopped. Keep uncertain Environments fenced. */
export async function markEnvironmentUncertain(
  c: Context,
  agentId: string,
  runId: string,
) {
  const environment = await getEnvironment(c, agentId);
  if (environment.activeRunId !== runId) throw new DomainError("conflict");
  await c.tx
    .update(environments)
    .set({ state: "uncertain" })
    .where(eq(environments.id, environment.id));
}

export type {
  ComputerBackend,
  ComputerProcess,
  ProcessInspection,
} from "./computer";
export { requireComputerCapabilities } from "./computer";

/** Called only by trusted server composition after probing its configured backend. */
export async function bindEnvironment(
  c: Context,
  agentId: string,
  provider: string,
  computerRef: string,
) {
  requireHuman(c);
  requireWriter(c);
  const agent = await getAgent(c, agentId);
  if (agent.ownerId !== c.actor.userId) throw new DomainError("forbidden");
  const row = await getEnvironment(c, agentId);
  if (row.activeRunId || row.state === "uncertain")
    throw new DomainError(
      "conflict",
      "Confirm the old execution stopped first",
    );
  // Retained native context cannot become portable by swapping opaque provider references.
  if (
    row.computerRef &&
    (row.computerRef !== computerRef || row.provider !== provider)
  )
    throw new DomainError(
      "conflict",
      "Environment replacement requires explicit reset qualification",
    );
  try {
    await c.tx
      .update(environments)
      .set({ provider, computerRef, state: "ready" })
      .where(eq(environments.id, row.id));
  } catch (error) {
    if (
      error instanceof DrizzleQueryError &&
      error.cause instanceof Error &&
      "code" in error.cause &&
      error.cause.code === "23505" &&
      "constraint" in error.cause &&
      error.cause.constraint === "environments_provider_computer_unique"
    )
      throw new DomainError("conflict", "Computer already bound");
    throw error;
  }
  await advanceCursor(c);
}
/** A terminal provider acknowledgement, never lease expiry, releases the computer. */
export async function releaseEnvironment(
  c: Context,
  agentId: string,
  runId: string,
  generation: number,
) {
  const row = await getEnvironment(c, agentId);
  if (row.generation !== generation || row.activeRunId !== runId)
    throw new DomainError("conflict", "Stale Environment completion");
  await c.tx
    .update(environments)
    .set({ activeRunId: null, state: "ready" })
    .where(eq(environments.id, row.id));
}
export async function bindExecutionScope(
  c: Context,
  agentId: string,
  scope: string,
) {
  const row = await getEnvironment(c, agentId);
  if (row.executionScope && row.executionScope !== scope)
    throw new DomainError(
      "conflict",
      "Fresh isolated working state required for changed scope",
    );
  await c.tx
    .update(environments)
    .set({ executionScope: scope })
    .where(eq(environments.id, row.id));
}

/** Server cleanup after revocation; it cannot grant access or release a different attempt. */
export async function settleEnvironment(
  tx: Context["tx"],
  workspaceId: string,
  agentId: string,
  runId: string,
  generation: number,
  stopped: boolean,
) {
  const changed = await tx
    .update(environments)
    .set(
      stopped ? { activeRunId: null, state: "ready" } : { state: "uncertain" },
    )
    .where(
      and(
        eq(environments.workspaceId, workspaceId),
        eq(environments.agentId, agentId),
        eq(environments.activeRunId, runId),
        eq(environments.generation, generation),
      ),
    )
    .returning({ id: environments.id });
  if (changed.length !== 1)
    throw new DomainError("conflict", "Stale Environment acknowledgement");
}

/** Server-only reconciliation lookup, including when the original sponsor has been revoked. */
export async function getExecutionComputer(
  db: Database,
  workspaceId: string,
  agentId: string,
  runId: string,
  generation: number,
) {
  return required(
    (
      await db
        .select({
          provider: environments.provider,
          computerRef: environments.computerRef,
        })
        .from(environments)
        .where(
          and(
            eq(environments.workspaceId, workspaceId),
            eq(environments.agentId, agentId),
            eq(environments.activeRunId, runId),
            eq(environments.generation, generation),
          ),
        )
    )[0],
  );
}
