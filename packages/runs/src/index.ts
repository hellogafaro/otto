import { isDeepStrictEqual } from "node:util";
import { getAgent } from "@otto/agents";
import { snapshotGrants } from "@otto/connections";
import { getConversation, getConversationAudience } from "@otto/conversations";
import { type Database, DomainError, required } from "@otto/db";
import { snapshotSkills } from "@otto/documents";
import { getEnvironment } from "@otto/environments";
import { createSession, requireSession } from "@otto/sessions";
import { getTask } from "@otto/tasks";
import {
  advanceRevision,
  type Context,
  inWorkspace,
  requireHuman,
  requireWriter,
} from "@otto/workspaces";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { fromDrizzle, type PgBoss } from "pg-boss";
import { type RunRequest, type RunRequestIdentity, runs } from "./schema";
export const RUN_QUEUE = "otto-run-dispatch";
export type { RunRequest } from "./schema";

function normalizeRequest(input: RunRequest): RunRequestIdentity {
  return {
    requestId: input.requestId,
    conversationId: input.conversationId,
    agentId: input.agentId,
    kind: input.kind,
    body: input.body,
    taskId: input.taskId ?? null,
    sessionId: input.sessionId ?? null,
    // null means use Agent defaults; [] explicitly selects no skills.
    skillIds: input.skillIds ?? null,
    automationId: input.automationId ?? null,
    automationToken: input.automationToken ?? null,
  };
}
const ACTIVE_STATES = ["queued", "launching", "running", "uncertain"] as const;
/** Atomic Run, exact input snapshot, fresh Session when needed and pg-boss job admission. */
export async function admitRun(c: Context, boss: PgBoss, input: RunRequest) {
  requireHuman(c);
  requireWriter(c);
  const requestIdentity = normalizeRequest(input);
  const existing = (
    await c.tx
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.workspaceId, c.workspaceId),
          eq(runs.sponsorId, c.actor.userId),
          eq(runs.requestId, input.requestId),
        ),
      )
  )[0];
  if (existing) {
    if (!isDeepStrictEqual(existing.requestIdentity, requestIdentity))
      throw new DomainError("conflict", "Request identity already used");
    await getConversation(c, existing.conversationId, true);
    return publicRun(existing);
  }
  const conversation = await getConversation(c, input.conversationId, true);
  const agent = await getAgent(c, input.agentId);
  if (agent.projectId && agent.projectId !== conversation.projectId)
    throw new DomainError("forbidden");
  const audience = await getConversationAudience(c, input.conversationId);
  if (!audience.agents.includes(agent.id))
    throw new DomainError("forbidden", "Agent must participate");
  if (input.automationId) {
    const active = (
      await c.tx
        .select()
        .from(runs)
        .where(
          and(
            eq(runs.automationId, input.automationId),
            inArray(runs.state, [...ACTIVE_STATES]),
          ),
        )
    )[0];
    if (active) return publicRun(active);
  }
  if (input.taskId) {
    const task = await getTask(c, input.taskId, true);
    if (task.projectId !== conversation.projectId)
      throw new DomainError("forbidden");
  }
  const environment = await getEnvironment(c, agent.id);
  const pending = await c.tx
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        eq(runs.environmentId, environment.id),
        inArray(runs.state, [...ACTIVE_STATES]),
      ),
    )
    .limit(20);
  if (pending.length >= 20)
    throw new DomainError("conflict", "Environment queue is full");
  const skills = await snapshotSkills(
    c,
    input.skillIds ?? agent.skillIds,
    audience,
  );
  const grants = await snapshotGrants(c, agent.id);
  const scope = JSON.stringify({
    projectId: conversation.projectId,
    humans: [...audience.humans].sort(),
    agents: [...audience.agents].sort(),
    grants,
    skillIds: skills.map((skill) => skill.documentId).sort(),
  });
  const binding = {
    conversationId: conversation.id,
    agentId: agent.id,
    environmentId: environment.id,
    environmentGeneration: environment.generation,
    scope,
    harness: agent.harness,
    harnessRelease: agent.harnessRelease,
    accountConnectionId: agent.accountConnectionId,
  };
  if (input.kind === "script" && input.sessionId)
    throw new DomainError("invalid");
  const session =
    input.kind === "prompt"
      ? input.sessionId
        ? await requireSession(c, input.sessionId, binding)
        : await createSession(c, binding)
      : null;
  const revision = await advanceRevision(c);
  const run = required(
    (
      await c.tx
        .insert(runs)
        .values({
          workspaceId: c.workspaceId,
          conversationId: conversation.id,
          agentId: agent.id,
          sponsorId: c.actor.userId,
          taskId: input.taskId,
          automationId: input.automationId,
          automationToken: input.automationToken,
          sessionId: session?.id,
          environmentId: environment.id,
          environmentGeneration: environment.generation,
          requestId: input.requestId,
          requestIdentity,
          kind: input.kind,
          inputs: {
            body: input.body,
            instructions: agent.instructions,
            harness: agent.harness,
            harnessRelease: agent.harnessRelease,
            model: agent.model,
            accountConnectionId: agent.accountConnectionId,
            agentConfigToken: agent.configToken,
            audience,
            skills,
            grants,
          },
          revision,
        })
        .returning()
    )[0],
  );
  const jobId = await boss.send(
    RUN_QUEUE,
    { runId: run.id },
    {
      db: fromDrizzle(c.tx, sql),
      retryLimit: 3,
      retryDelay: 5,
      retryBackoff: true,
      expireInSeconds: 60,
      retentionSeconds: 86400,
    },
  );
  if (!jobId) throw new DomainError("conflict", "Dispatch admission failed");
  return publicRun(run);
}
function publicRun(run: typeof runs.$inferSelect) {
  return {
    id: run.id,
    conversationId: run.conversationId,
    agentId: run.agentId,
    taskId: run.taskId,
    kind: run.kind,
    state: run.state,
    outcome: run.outcome,
    revision: run.revision,
    createdAt: run.createdAt,
  };
}
export async function getRun(c: Context, id: string) {
  const run = required(
    (
      await c.tx
        .select()
        .from(runs)
        .where(and(eq(runs.id, id), eq(runs.workspaceId, c.workspaceId)))
    )[0],
  );
  await getConversation(c, run.conversationId);
  return publicRun(run);
}
export async function getRunUpdates(
  c: Context,
  conversationId: string,
  after = 0,
) {
  await getConversation(c, conversationId);
  return (
    await c.tx
      .select()
      .from(runs)
      .where(
        and(eq(runs.conversationId, conversationId), gt(runs.revision, after)),
      )
      .orderBy(runs.revision)
      .limit(100)
  ).map(publicRun);
}
/** Dispatch never starts host processes. A deferred provider produces a durable explicit failure. */
export async function dispatchRun(
  db: Database,
  runId: string,
  validateAutomation?: (c: Context, id: string, token: number) => Promise<void>,
) {
  const descriptor = required(
    (
      await db
        .select({ workspaceId: runs.workspaceId, sponsorId: runs.sponsorId })
        .from(runs)
        .where(eq(runs.id, runId))
    )[0],
  );
  try {
    return await inWorkspace(
      db,
      descriptor.workspaceId,
      { userId: descriptor.sponsorId },
      async (c) => {
        const run = required(
          (await c.tx.select().from(runs).where(eq(runs.id, runId)))[0],
        );
        if (run.state !== "queued") return publicRun(run);
        let outcome = "compute_provider_not_selected";
        try {
          requireWriter(c);
          await getConversation(c, run.conversationId, true);
          const agent = await getAgent(c, run.agentId);
          const environment = await getEnvironment(c, agent.id);
          if (run.automationId) {
            if (run.automationToken === null || !validateAutomation)
              throw new DomainError("conflict");
            await validateAutomation(c, run.automationId, run.automationToken);
          }
          const audience = await getConversationAudience(c, run.conversationId);
          if (
            agent.configToken !== run.inputs.agentConfigToken ||
            environment.generation !== run.environmentGeneration ||
            !isDeepStrictEqual(audience, run.inputs.audience) ||
            !isDeepStrictEqual(
              await snapshotGrants(c, agent.id),
              run.inputs.grants,
            )
          )
            throw new DomainError("conflict");
          await snapshotSkills(
            c,
            run.inputs.skills.map((s) => s.documentId),
            audience,
          );
          if (run.taskId) await getTask(c, run.taskId, true);
        } catch (error) {
          if (!(error instanceof DomainError)) throw error;
          outcome =
            error.code === "forbidden"
              ? "authorization_revoked"
              : "configuration_changed";
        }
        const revision = await advanceRevision(c);
        const updated = required(
          (
            await c.tx
              .update(runs)
              .set({
                state: "failed",
                outcome,
                updatedAt: new Date(),
                revision,
              })
              .where(and(eq(runs.id, runId), eq(runs.state, "queued")))
              .returning()
          )[0],
        );
        return publicRun(updated);
      },
    );
  } catch (error) {
    if (!(error instanceof DomainError) || error.code !== "forbidden")
      throw error;
    // Removed sponsors cannot authorize a workspace transaction. A server-only fenced terminal write preserves the failure.
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from workspace where id=${descriptor.workspaceId} for update`,
      );
      const revision = await tx.execute<{ revision: number }>(
        sql`update workspace set revision=revision+1 where id=${descriptor.workspaceId} returning revision`,
      );
      await tx
        .update(runs)
        .set({
          revision: required(revision.rows[0]).revision,
          state: "failed",
          outcome: "authorization_revoked",
          updatedAt: new Date(),
        })
        .where(and(eq(runs.id, runId), eq(runs.state, "queued")));
    });
    return { id: runId, state: "failed", outcome: "authorization_revoked" };
  }
}
export async function stopRun(c: Context, id: string) {
  requireHuman(c);
  requireWriter(c);
  const run = required(
    (
      await c.tx
        .select()
        .from(runs)
        .where(and(eq(runs.id, id), eq(runs.workspaceId, c.workspaceId)))
    )[0],
  );
  await getConversation(c, run.conversationId, true);
  if (run.state === "queued") {
    const revision = await advanceRevision(c);
    await c.tx
      .update(runs)
      .set({
        state: "interrupted",
        outcome: "stopped_before_launch",
        revision,
        updatedAt: new Date(),
      })
      .where(eq(runs.id, id));
    return { stopped: true };
  }
  if (["finished", "failed", "interrupted"].includes(run.state))
    return { stopped: true };
  throw new DomainError(
    "unavailable",
    "Cannot confirm process termination without the selected provider",
  );
}
/** Fences stale progress. Unknown write outcomes stay uncertain and cannot be redelivered as a fresh attempt. */
export async function recordRunOutcome(
  c: Context,
  input: {
    id: string;
    attempt: number;
    launchKey: string;
    state: "finished" | "failed" | "uncertain";
    outcome: string;
  },
) {
  const revision = await advanceRevision(c);
  const updated = (
    await c.tx
      .update(runs)
      .set({
        state: input.state,
        outcome: input.outcome,
        revision,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(runs.id, input.id),
          eq(runs.workspaceId, c.workspaceId),
          eq(runs.attempt, input.attempt),
          eq(runs.launchKey, input.launchKey),
          inArray(runs.state, ["launching", "running"]),
        ),
      )
      .returning({ id: runs.id })
  )[0];
  if (!updated) throw new DomainError("conflict", "Stale execution");
  return updated;
}

/** Requeues accepted bookkeeping only. A possibly running process becomes uncertain, never a new launch. */
export async function recoverRuns(db: Database, boss: PgBoss) {
  const pending = await db
    .select({ id: runs.id, workspaceId: runs.workspaceId, state: runs.state })
    .from(runs)
    .where(inArray(runs.state, ["queued", "launching", "running"]))
    .limit(1001);
  if (pending.length > 1000)
    throw new DomainError(
      "unavailable",
      "Recovery backlog exceeds initial bound",
    );
  for (const row of pending) {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from workspace where id=${row.workspaceId} for update`,
      );
      const current = required(
        (await tx.select().from(runs).where(eq(runs.id, row.id)))[0],
      );
      if (current.state === "queued") {
        if (
          (
            await boss.findJobs(RUN_QUEUE, {
              data: { runId: row.id },
              queued: true,
              db: fromDrizzle(tx, sql),
            })
          ).length
        )
          return;
        const jobId = await boss.send(
          RUN_QUEUE,
          { runId: row.id },
          {
            db: fromDrizzle(tx, sql),
            retryLimit: 3,
            retryDelay: 5,
            retryBackoff: true,
          },
        );
        if (!jobId) throw new DomainError("conflict");
      } else if (current.state === "launching" || current.state === "running") {
        const revision = await tx.execute<{ revision: number }>(
          sql`update workspace set revision=revision+1 where id=${row.workspaceId} returning revision`,
        );
        await tx
          .update(runs)
          .set({
            state: "uncertain",
            outcome: "server_restarted_execution_unconfirmed",
            revision: required(revision.rows[0]).revision,
            updatedAt: new Date(),
          })
          .where(eq(runs.id, row.id));
      }
    });
  }
}

/** Publication cannot widen an attempt's saved output audience after later Conversation invitations. */
export async function getRunAudience(c: Context, id: string) {
  const run = required(
    (
      await c.tx
        .select()
        .from(runs)
        .where(and(eq(runs.id, id), eq(runs.workspaceId, c.workspaceId)))
    )[0],
  );
  await getConversation(c, run.conversationId);
  return run.inputs.audience;
}
