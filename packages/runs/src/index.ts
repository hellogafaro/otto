import { isDeepStrictEqual } from "node:util";
import { getAgent } from "@otto/agents";
import { getConnection, snapshotGrants } from "@otto/connections";
import {
  createMessage,
  getConversation,
  getConversationAudience,
  getMessage,
} from "@otto/conversations";
import type { Database } from "@otto/db";
import { getDocument, getDocumentAudience } from "@otto/documents";
import { getEnvironment } from "@otto/environments";
import { getProject } from "@otto/projects";
import { createSession, requireSession } from "@otto/sessions";
import {
  DomainError,
  filterPage,
  getPage,
  type PageOptions,
  parsePageOptions,
  required,
} from "@otto/shared";
import { getSkill, snapshotSkills, validateSkillAccess } from "@otto/skills";

import { getSubscription } from "@otto/subscriptions";
import { getTask } from "@otto/tasks";
import {
  type Actor,
  advanceCursor,
  type Context,
  inWorkspace,
  requireHuman,
  requireWriter,
} from "@otto/workspaces";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { fromDrizzle, type PgBoss } from "pg-boss";
import {
  type RunRequest,
  type RunRequestIdentity,
  runActivity,
  runs,
} from "./schema";
export const RUN_QUEUE = "otto-run-dispatch";
export type { ModelConfig, RunRequest } from "./schema";
/** One managed Pi installation, supplied by trusted server composition. */
export interface PiInstallation {
  version: string;
  argv: string[];
  authorizeModel?: (
    subscriptionId: string,
    model: string,
  ) => Promise<{
    accountId: string;
    modelConfig: import("./schema").ModelConfig;
  }>;
}

function normalizeRequest(input: RunRequest): RunRequestIdentity {
  return {
    requestId: input.requestId,
    conversationId: input.conversationId,
    agentId: input.agentId,
    type: input.type,
    body: input.body,
    taskId: input.taskId ?? null,
    sessionId: input.sessionId ?? null,
    documentIds: input.documentIds ?? [],
    messageIds: input.messageIds ?? [],
    automationId: input.automationId ?? null,
    automationEditToken: input.automationEditToken ?? null,
  };
}
/** Resolve external account/model metadata before the atomic workspace admission; the returned lookup performs no I/O. */
export async function prepareRunModel(
  db: Database,
  workspaceId: string,
  actor: Actor,
  input: Pick<RunRequest, "agentId" | "type" | "requestId">,
  pi?: PiInstallation,
): Promise<PiInstallation | undefined> {
  if (input.type === "script" || !pi?.authorizeModel) return pi;
  const selection = await inWorkspace(
    db,
    workspaceId,
    actor,
    async (c) => {
      requireHuman(c);
      requireWriter(c);
      const existing = (
        await c.tx
          .select()
          .from(runs)
          .where(
            and(
              eq(runs.workspaceId, workspaceId),
              eq(runs.sponsorId, actor.userId),
              eq(runs.requestId, input.requestId),
            ),
          )
      )[0];
      if (existing) {
        await getConversation(c, existing.conversationId, true);
        return null;
      }
      const agent = await getAgent(c, input.agentId);
      const subscriptionId = required(
        agent.subscriptionId ?? undefined,
        "unavailable",
      );
      const subscription = await getSubscription(c, subscriptionId);
      if (subscription.status !== "enabled")
        throw new DomainError("forbidden", "Subscription unavailable");
      return { subscriptionId, model: agent.model };
    },
    false,
  );
  if (!selection) return pi;
  const accepted = await pi.authorizeModel(
    selection.subscriptionId,
    selection.model,
  );
  return {
    ...pi,
    authorizeModel: async (subscriptionId, model) => {
      if (
        subscriptionId !== selection.subscriptionId ||
        model !== selection.model
      )
        throw new DomainError("conflict", "Account/model selection changed");
      return accepted;
    },
  };
}

const ACTIVE_STATES = ["queued", "launching", "running", "uncertain"] as const;
/** Atomic Run, exact input snapshot, fresh Session when needed and pg-boss job admission. */
export async function admitRun(
  c: Context,
  boss: PgBoss,
  input: RunRequest,
  pi?: PiInstallation,
) {
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
    if (
      !existing.requestIdentity ||
      !isDeepStrictEqual(existing.requestIdentity, requestIdentity)
    )
      throw new DomainError("conflict", "Request identity already used");
    await getConversation(c, existing.conversationId, true);
    return publicRun(existing);
  }
  const conversation = await getConversation(c, input.conversationId, true);
  if (
    conversation.archived ||
    (conversation.projectId &&
      (await getProject(c, conversation.projectId)).archived)
  )
    throw new DomainError("conflict", "Source archived");
  const agent = await getAgent(c, input.agentId);
  await getConversation(
    { ...c, actor: { userId: c.actor.userId, agentId: agent.id } },
    input.conversationId,
    true,
  );
  const subscription =
    input.type === "prompt" && agent.subscriptionId
      ? await getSubscription(c, agent.subscriptionId)
      : null;
  if (agent.archived) throw new DomainError("conflict", "Agent archived");
  if (agent.projectId && agent.projectId !== conversation.projectId)
    throw new DomainError("forbidden");
  const audience = await getConversationAudience(c, input.conversationId);
  if (
    agent.visibility === "user" &&
    (audience.humans.some((id) => id !== agent.createdBy) ||
      audience.agents.some((id) => id !== agent.id))
  )
    throw new DomainError("forbidden", "User-scoped Agent audience");
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
    if (task.archived) throw new DomainError("conflict", "Task archived");
    if (task.projectId !== conversation.projectId)
      throw new DomainError("forbidden");
  }
  const context = await snapshotContext(c, input, audience);
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
  const skills = await snapshotSkills(c, agent.skillIds, audience);
  const grants = await snapshotGrants(c, agent.id);
  const scope = JSON.stringify({
    projectId: conversation.projectId,
    humans: [...audience.humans].sort(),
    agents: [...audience.agents].sort(),
    grants,
    skillIds: skills.map((skill) => skill.documentId).sort(),
    documentIds: context.documents.map((d) => d.id).sort(),
    taskId: context.task?.id ?? null,
  });
  const piVersion = input.type === "prompt" ? pi?.version : null;
  if (input.type === "prompt" && (!piVersion || !subscription))
    throw new DomainError("unavailable", "Managed Pi account not configured");
  if (input.type === "prompt" && subscription?.status !== "enabled")
    throw new DomainError("forbidden", "Subscription unavailable");
  if (input.type === "script" && input.sessionId)
    throw new DomainError("invalid");
  const account =
    input.type === "prompt"
      ? await required(pi?.authorizeModel, "unavailable")(
          required(agent.subscriptionId ?? undefined),
          agent.model,
        )
      : null;
  let session: Awaited<ReturnType<typeof createSession>> | null = null;
  if (input.type === "prompt") {
    const binding = {
      conversationId: conversation.id,
      agentId: agent.id,
      environmentId: environment.id,
      environmentGeneration: environment.generation,
      scope,
      piVersion: required(piVersion ?? undefined, "unavailable"),
      provider: required(subscription?.provider, "unavailable"),
      model: agent.model,
      subscriptionId: agent.subscriptionId,
      accountId: required(account?.accountId, "unavailable"),
    };
    session = input.sessionId
      ? await requireSession(c, input.sessionId, binding)
      : await createSession(c, binding);
  }
  const cursor = await advanceCursor(c);
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
          automationEditToken: input.automationEditToken,
          sessionId: session?.id,
          environmentId: environment.id,
          environmentGeneration: environment.generation,
          requestId: input.requestId,
          requestIdentity,
          type: input.type,
          inputs: {
            body: input.body,
            instructions: agent.instructions,
            piVersion: piVersion ?? null,
            provider: subscription?.provider ?? null,
            model: agent.model,
            subscriptionId:
              input.type === "prompt" ? agent.subscriptionId : null,
            accountId: account?.accountId ?? null,
            modelConfig: account?.modelConfig ?? null,
            agentEditToken: agent.editToken,
            audience,
            skills,
            grants,
            context,
          },
          cursor,
        })
        .returning()
    )[0],
  );
  const jobId = await boss.send(
    RUN_QUEUE,
    { runId: run.id },
    {
      db: fromDrizzle(c.tx, sql),
      retryLimit: 120,
      retryDelay: 5,
      retryBackoff: false,
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
    type: run.type,
    state: run.state,
    outcome: run.outcome,
    cursor: run.cursor,
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
/** Dispatch never starts host processes. A deferred provider produces a durable explicit failure. */
export async function dispatchRun(
  db: Database,
  runId: string,
  validateAutomation?: (
    c: Context,
    id: string,
    editToken: number,
  ) => Promise<void>,
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
          await validateRunSources(c, run, validateAutomation);
        } catch (error) {
          if (!(error instanceof DomainError)) throw error;
          outcome =
            error.code === "forbidden"
              ? "authorization_revoked"
              : "configuration_changed";
        }
        const cursor = await advanceCursor(c);
        const updated = required(
          (
            await c.tx
              .update(runs)
              .set({
                state: "failed",
                outcome,
                updatedAt: new Date(),
                cursor,
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
    return failQueuedRun(db, runId, "authorization_revoked");
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
    const cursor = await advanceCursor(c);
    await c.tx
      .update(runs)
      .set({
        state: "interrupted",
        outcome: "stopped_before_launch",
        cursor,
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
/** Server-only terminal admission outcome; it never changes an execution that may have launched. */
export async function failQueuedRun(db: Database, id: string, outcome: string) {
  const row = required(
    (await db.select().from(runs).where(eq(runs.id, id)))[0],
  );
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from workspaces where id=${row.workspaceId} for update`,
    );
    const current = required(
      (await tx.select().from(runs).where(eq(runs.id, id)))[0],
    );
    if (current.state !== "queued") return publicRun(current);
    const result = await tx.execute<{ cursor: number }>(
      sql`update workspaces set cursor=cursor+1 where id=${row.workspaceId} returning cursor`,
    );
    const [updated] = await tx
      .update(runs)
      .set({
        state: "failed",
        outcome,
        updatedAt: new Date(),
        cursor: required(result.rows[0]).cursor,
      })
      .where(eq(runs.id, id))
      .returning();
    return publicRun(required(updated));
  });
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
        sql`select id from workspaces where id=${row.workspaceId} for update`,
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
            retryLimit: 120,
            retryDelay: 5,
            retryBackoff: false,
          },
        );
        if (!jobId) throw new DomainError("conflict");
      } else if (current.state === "launching" || current.state === "running") {
        const cursor = await tx.execute<{ cursor: number }>(
          sql`update workspaces set cursor=cursor+1 where id=${row.workspaceId} returning cursor`,
        );
        await tx
          .update(runs)
          .set({
            state: "uncertain",
            outcome: "server_restarted_execution_unconfirmed",
            cursor: required(cursor.rows[0]).cursor,
            updatedAt: new Date(),
          })
          .where(eq(runs.id, row.id));
      }
    });
  }
}

/** Private outputs require both accepted and current source recipients; explicit human public selection is separate. */
export async function getRunAudience(c: Context, id: string) {
  const run = required(
    (
      await c.tx
        .select()
        .from(runs)
        .where(and(eq(runs.id, id), eq(runs.workspaceId, c.workspaceId)))
    )[0],
  );
  const current = await getConversationAudience(c, run.conversationId);
  return {
    humans: run.inputs.audience.humans.filter((id) =>
      current.humans.includes(id),
    ),
    agents: run.inputs.audience.agents.filter((id) =>
      current.agents.includes(id),
    ),
  };
}

async function snapshotContext(
  c: Context,
  input: Pick<
    RunRequest,
    "conversationId" | "taskId" | "messageIds" | "documentIds"
  >,
  audience: { humans: string[]; agents: string[] },
  phase: "launch" | "continue" = "launch",
) {
  if (
    (input.documentIds?.length ?? 0) > 20 ||
    (input.messageIds?.length ?? 0) > 100
  )
    throw new DomainError("invalid", "Context limit");
  const documents = [];
  for (const id of input.documentIds ?? []) {
    const doc = await getDocument(c, id);
    if (phase === "launch" && doc.archived)
      throw new DomainError("conflict", "Document archived");
    const available = await getDocumentAudience(c, id);
    if (
      audience.humans.some((id) => !available.includes(id)) ||
      (doc.visibility === "user" && audience.agents.length > 1)
    )
      throw new DomainError("forbidden", "Document context audience mismatch");
    documents.push({
      id: doc.id,
      title: doc.title,
      body: doc.body,
      editToken: doc.editToken,
    });
  }
  const messages = [];
  for (const id of input.messageIds ?? []) {
    const message = await getMessage(c, input.conversationId, id);
    messages.push({ id: message.id, body: message.body });
  }
  const task = input.taskId ? await getTask(c, input.taskId, true) : null;
  if (task && phase === "launch" && task.archived)
    throw new DomainError("conflict", "Task archived");
  return {
    task: task ? { id: task.id, title: task.title, notes: task.notes } : null,
    documents,
    messages,
  };
}

/** Trusted execution composition rechecks all live grants and retained source audiences. */
export async function validateRunSources(
  c: Context,
  run: typeof runs.$inferSelect,
  validateAutomation?: (
    c: Context,
    id: string,
    editToken: number,
  ) => Promise<void>,
  phase: "launch" | "continue" = "launch",
) {
  requireWriter(c);
  const conversation = await getConversation(c, run.conversationId, true);
  await getConversation(
    { ...c, actor: { userId: run.sponsorId, agentId: run.agentId } },
    run.conversationId,
    true,
  );
  if (
    phase === "launch" &&
    (conversation.archived ||
      (conversation.projectId &&
        (await getProject(c, conversation.projectId)).archived))
  )
    throw new DomainError("conflict", "Source archived");
  const agent = await getAgent(c, run.agentId);
  if (
    run.type === "prompt" &&
    agent.subscriptionId !== run.inputs.subscriptionId
  )
    throw new DomainError("conflict", "Accepted account changed");
  if (run.inputs.subscriptionId) {
    const account = await getSubscription(c, run.inputs.subscriptionId);
    if (account.provider !== run.inputs.provider)
      throw new DomainError("conflict", "Accepted provider changed");
    if (account.status !== "enabled")
      throw new DomainError("forbidden", "Account unavailable");
  }
  if (phase === "launch" && agent.model !== run.inputs.model)
    throw new DomainError("conflict", "Accepted model changed");
  if (phase === "launch" && agent.archived)
    throw new DomainError("conflict", "Agent archived");
  const environment = await getEnvironment(c, agent.id);
  if (phase === "launch" && run.automationId) {
    if (run.automationEditToken === null || !validateAutomation)
      throw new DomainError("conflict");
    await validateAutomation(c, run.automationId, run.automationEditToken);
  }
  const audience = await getConversationAudience(c, run.conversationId);
  if (
    agent.visibility === "user" &&
    (audience.humans.some((id) => id !== agent.createdBy) ||
      audience.agents.some((id) => id !== agent.id))
  )
    throw new DomainError("forbidden", "User-scoped Agent audience");
  if (
    (phase === "launch" && agent.editToken !== run.inputs.agentEditToken) ||
    !isDeepStrictEqual(
      [...agent.skillIds].sort(),
      run.inputs.skills.map((s) => s.documentId).sort(),
    ) ||
    environment.generation !== run.environmentGeneration ||
    !isDeepStrictEqual(audience, run.inputs.audience) ||
    !isDeepStrictEqual(await snapshotGrants(c, agent.id), run.inputs.grants)
  )
    throw new DomainError("conflict");
  if (phase === "launch")
    await snapshotSkills(
      c,
      run.inputs.skills.map((s) => s.documentId),
      audience,
    );
  else
    for (const skill of run.inputs.skills)
      await validateSkillAccess(c, skill.documentId, audience);
  if (run.inputs.context)
    await snapshotContext(
      c,
      {
        conversationId: run.conversationId,
        taskId: run.taskId ?? undefined,
        documentIds: run.inputs.context.documents.map((d) => d.id),
        messageIds: run.inputs.context.messages.map((m) => m.id),
      },
      run.inputs.audience,
      phase,
    );
  if (run.taskId) {
    const task = await getTask(c, run.taskId, true);
    if (phase === "launch" && task.archived)
      throw new DomainError("conflict", "Task archived");
  }
}

/** Saved shared activity excludes raw private harness history. */
export async function getRunActivity(c: Context, id: string, after = 0) {
  const audience = await getRunAudience(c, id);
  if (
    !audience.humans.includes(c.actor.userId) ||
    (c.actor.agentId && !audience.agents.includes(c.actor.agentId))
  )
    throw new DomainError("forbidden");
  return c.tx
    .select()
    .from(runActivity)
    .where(and(eq(runActivity.runId, id), gt(runActivity.cursor, after)))
    .orderBy(runActivity.cursor)
    .limit(100);
}

/** One bounded human question per active attempt; trusted runtime composition supplies the agent identity. */
export async function createRunQuestion(
  c: Context,
  runId: string,
  input: { requestId: string; body: string },
) {
  const run = required(
    (
      await c.tx
        .select()
        .from(runs)
        .where(and(eq(runs.id, runId), eq(runs.workspaceId, c.workspaceId)))
    )[0],
  );
  if (
    !c.actor.agentId ||
    c.actor.agentId !== run.agentId ||
    c.actor.userId !== run.sponsorId ||
    run.state !== "running"
  )
    throw new DomainError("forbidden");
  if (!input.body || Buffer.byteLength(input.body) > 16000)
    throw new DomainError("invalid");
  await getConversation(c, run.conversationId, true);
  const prior = (
    await c.tx
      .select()
      .from(runActivity)
      .where(
        and(
          eq(runActivity.runId, runId),
          eq(runActivity.requestId, input.requestId),
        ),
      )
  )[0];
  if (prior) {
    if (prior.type !== "question" || prior.body !== input.body)
      throw new DomainError("conflict");
    return prior;
  }
  const questions = await c.tx
    .select({ answer: runActivity.answer })
    .from(runActivity)
    .where(and(eq(runActivity.runId, runId), eq(runActivity.type, "question")))
    .limit(20);
  if (questions.some((question) => question.answer === null))
    throw new DomainError("conflict", "Run already awaits an answer");
  if (questions.length === 20)
    throw new DomainError("unavailable", "Run question limit");
  const question = required(
    (
      await c.tx
        .insert(runActivity)
        .values({
          workspaceId: c.workspaceId,
          runId,
          requestId: input.requestId,
          type: "question",
          body: input.body,
          cursor: await advanceCursor(c),
        })
        .returning()
    )[0],
  );
  await createMessage(c, run.conversationId, {
    requestId: question.id,
    body: `Question ${question.id}: ${input.body}`,
  });
  return question;
}
export async function getRunQuestion(c: Context, id: string) {
  const question = required(
    (
      await c.tx
        .select()
        .from(runActivity)
        .where(
          and(
            eq(runActivity.id, id),
            eq(runActivity.workspaceId, c.workspaceId),
            eq(runActivity.type, "question"),
          ),
        )
    )[0],
  );
  const audience = await getRunAudience(c, question.runId);
  if (
    !audience.humans.includes(c.actor.userId) ||
    (c.actor.agentId && !audience.agents.includes(c.actor.agentId))
  )
    throw new DomainError("forbidden");
  return question;
}
/** Questions remain saved activity; answers are human-authorized and never complete a Task. */
export async function answerRunQuestion(c: Context, id: string, body: string) {
  requireHuman(c);
  requireWriter(c);
  if (!body || Buffer.byteLength(body) > 16000)
    throw new DomainError("invalid");
  const question = await getRunQuestion(c, id);
  if (question.answer !== null) {
    if (question.answer !== body || question.answeredBy !== c.actor.userId)
      throw new DomainError("conflict");
    return question;
  }
  const run = required(
    (await c.tx.select().from(runs).where(eq(runs.id, question.runId)))[0],
  );
  if (run.state !== "running" || run.stopRequested)
    throw new DomainError("conflict", "Run no longer awaits input");
  await getConversation(c, run.conversationId, true);
  const answered = required(
    (
      await c.tx
        .update(runActivity)
        .set({
          answer: body,
          answeredBy: c.actor.userId,
          answeredAt: new Date(),
          cursor: await advanceCursor(c),
        })
        .where(eq(runActivity.id, id))
        .returning()
    )[0],
  );
  await createMessage(c, run.conversationId, {
    requestId: crypto.randomUUID(),
    body: `Answer ${question.id}: ${body}`,
  });
  return answered;
}
export async function getRunQuestions(c: Context, filter: PageOptions = {}) {
  const { limit } = parsePageOptions(filter);
  requireHuman(c);
  const rows = await c.tx
    .select({ id: runActivity.id })
    .from(runActivity)
    .innerJoin(runs, eq(runs.id, runActivity.runId))
    .where(
      and(
        eq(runActivity.workspaceId, c.workspaceId),
        eq(runActivity.type, "question"),
        isNull(runActivity.answer),
        eq(runs.state, "running"),
        eq(runs.stopRequested, false),
        filter.after ? gt(runActivity.id, filter.after) : undefined,
      ),
    )
    .orderBy(runActivity.id)
    .limit(limit + 1);
  return filterPage(
    getPage(rows, (row) => row.id, limit),
    async (row) => {
      return getRunQuestion(c, row.id);
    },
  );
}

/** Current peer authority before external model preflight, repeated during atomic child admission. */
export async function authorizePeerRun(
  c: Context,
  parentId: string,
  agentId: string,
) {
  if (!c.actor.agentId) throw new DomainError("forbidden");
  const parent = required(
    (
      await c.tx
        .select()
        .from(runs)
        .where(and(eq(runs.id, parentId), eq(runs.workspaceId, c.workspaceId)))
    )[0],
  );
  if (
    parent.agentId !== c.actor.agentId ||
    parent.sponsorId !== c.actor.userId ||
    parent.state !== "running" ||
    agentId === parent.agentId
  )
    throw new DomainError("forbidden");
  const audience = await getConversationAudience(c, parent.conversationId);
  if (!audience.agents.includes(agentId)) throw new DomainError("forbidden");
  const target = await getAgent(c, agentId);
  if (target.visibility === "user")
    throw new DomainError("forbidden", "Peer Agent is user-scoped");
  // A peer request delegates only workspace resources; it cannot borrow the human's private dependencies.
  const sponsor = { ...c, actor: { userId: parent.sponsorId } };
  for (const id of target.skillIds)
    if ((await getSkill(sponsor, id)).visibility === "user")
      throw new DomainError("forbidden", "Peer skill is user-scoped");
  const connections = new Set(
    (await snapshotGrants(sponsor, target.id)).map(
      (grant) => grant.connectionId,
    ),
  );
  if (
    target.subscriptionId &&
    (await getSubscription(sponsor, target.subscriptionId)).visibility ===
      "user"
  )
    throw new DomainError("forbidden", "Peer Subscription is user-scoped");
  for (const id of connections)
    if ((await getConnection(sponsor, id)).visibility === "user")
      throw new DomainError("forbidden", "Peer Connection is user-scoped");
  return parent;
}

/** Trusted tool composition calls this only after asserting the sending attempt in this transaction. */
export async function requestPeerRun(
  c: Context,
  boss: PgBoss,
  parentId: string,
  input: { agentId: string; requestId: string; body: string },
  pi?: PiInstallation,
) {
  const parent = await authorizePeerRun(c, parentId, input.agentId);
  const sponsor = { ...c, actor: { userId: parent.sponsorId } };
  const requestId = `peer:${parent.id}:${input.requestId}`;
  const existing = (
    await c.tx
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.workspaceId, c.workspaceId),
          eq(runs.sponsorId, parent.sponsorId),
          eq(runs.requestId, requestId),
        ),
      )
  )[0];
  if (!existing) {
    const children = await c.tx
      .select({ id: runs.id })
      .from(runs)
      .where(eq(runs.parentRunId, parent.id))
      .limit(8);
    const recent = await c.tx
      .select({ id: runs.id })
      .from(runs)
      .where(
        and(
          eq(runs.workspaceId, c.workspaceId),
          gt(runs.handoffDepth, 0),
          gt(runs.createdAt, new Date(Date.now() - 60000)),
        ),
      )
      .limit(30);
    if (parent.handoffDepth >= 3 || children.length >= 8 || recent.length >= 30)
      throw new DomainError("unavailable", "Peer request limit");
  }
  const child = await admitRun(
    sponsor,
    boss,
    {
      conversationId: parent.conversationId,
      agentId: input.agentId,
      requestId,
      type: "prompt",
      body: input.body,
    },
    pi,
  );
  if (!existing)
    await c.tx
      .update(runs)
      .set({
        parentRunId: parent.id,
        handoffDepth: parent.handoffDepth + 1,
        updatedAt: new Date(),
      })
      .where(eq(runs.id, child.id));
  await createMessage(c, parent.conversationId, {
    requestId: child.id,
    body: `Directed request to agent ${input.agentId}: ${input.body}`,
  });
  return { runId: child.id, acknowledged: true };
}

export async function getRuns(
  c: Context,
  filter: {
    conversationId?: string;
    after?: string;
    limit?: number;
    cursor?: number;
    state?: typeof runs.$inferSelect.state;
  },
) {
  const { limit } = parsePageOptions(filter);
  if (filter.conversationId) await getConversation(c, filter.conversationId);
  if (filter.after && filter.cursor !== undefined)
    throw new DomainError("invalid", "Choose one pagination position");
  const items = await c.tx
    .select({ id: runs.id, cursor: runs.cursor })
    .from(runs)
    .where(
      and(
        eq(runs.workspaceId, c.workspaceId),
        filter.conversationId
          ? eq(runs.conversationId, filter.conversationId)
          : undefined,
        filter.after ? gt(runs.id, filter.after) : undefined,
        filter.cursor !== undefined
          ? gt(runs.cursor, filter.cursor)
          : undefined,
        filter.state ? eq(runs.state, filter.state) : undefined,
      ),
    )
    .orderBy(filter.cursor !== undefined ? runs.cursor : runs.id)
    .limit(limit + 1);
  return filterPage(
    getPage(
      items,
      (row) => (filter.cursor !== undefined ? row.cursor : row.id),
      limit,
    ),
    async (item) => {
      return getRun(c, item.id);
    },
  );
}

export async function getRunSkillFile(
  c: Context,
  runId: string,
  skillId: string,
  path: string,
) {
  const run = required(
    (
      await c.tx
        .select()
        .from(runs)
        .where(and(eq(runs.id, runId), eq(runs.workspaceId, c.workspaceId)))
    )[0],
  );
  await getConversation(c, run.conversationId);
  if (
    !run.inputs.audience.humans.includes(c.actor.userId) ||
    (c.actor.agentId && !run.inputs.audience.agents.includes(c.actor.agentId))
  )
    throw new DomainError("forbidden");
  const skill = required(
    run.inputs.skills.find((s) => s.documentId === skillId),
  );
  // The human sponsor explicitly admitted these skill inputs, including private one-agent material.
  await validateSkillAccess(
    { ...c, actor: { userId: run.sponsorId } },
    skillId,
    run.inputs.audience,
  );
  return required(skill.supportingFiles?.find((file) => file.path === path));
}

/** Whole-Run reported totals only after finished capture; observed receipts are not billed money. */
export async function getRunUsage(c: Context, id: string) {
  const audience = await getRunAudience(c, id);
  if (
    !audience.humans.includes(c.actor.userId) ||
    (c.actor.agentId && !audience.agents.includes(c.actor.agentId))
  )
    throw new DomainError("forbidden");
  const run = required(
    (
      await c.tx
        .select()
        .from(runs)
        .where(and(eq(runs.id, id), eq(runs.workspaceId, c.workspaceId)))
    )[0],
  );
  const complete = run.state === "finished" && run.usage.length > 0;
  const total = (field: keyof import("./schema").UsageTokens) => {
    if (
      !complete ||
      run.usage.some((message) => message.tokens[field] === null)
    )
      return null;
    return run.usage.reduce(
      (sum, message) => sum + (message.tokens[field] ?? 0),
      0,
    );
  };
  return {
    provider: run.inputs.provider,
    model: run.inputs.model,
    complete,
    messageCount: run.usage.length,
    inputTokens: total("inputTokens"),
    outputTokens: total("outputTokens"),
    cacheReadTokens: total("cacheReadTokens"),
    cacheWriteTokens: total("cacheWriteTokens"),
    totalTokens: total("totalTokens"),
  };
}
