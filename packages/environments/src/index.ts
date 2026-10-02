import { getAgent } from "@otto/agents";
import { DomainError, required } from "@otto/db";
import { advanceRevision, type Context, requireHuman } from "@otto/workspaces";
import { and, eq } from "drizzle-orm";
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
  await advanceRevision(c);
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
