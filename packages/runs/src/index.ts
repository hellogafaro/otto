import { isDeepStrictEqual } from "node:util";
import { getAgent } from "@otto/agents";
import {
  chatHasSponsor,
  chatReadable,
  createMessage,
  getChat,
  getChatAudience,
  getMessage,
} from "@otto/chats";
import { getConnection, snapshotGrants } from "@otto/connections";
import {
  authorizedPage,
  type Database,
  pageOf,
  sortNames,
  sortPlan,
  timeKey,
} from "@otto/db";
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
import { type AnyColumn, and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { fromDrizzle, type PgBoss } from "pg-boss";
import {
  type ModelConfig,
  type ModelCostRates,
  type RunRequest,
  type RunRequestIdentity,
  runActivity,
  runs,
  type UsageReceipt,
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
    conversationId: input.chatId,
    agentId: input.agentId,
    type: input.type,
    body: input.body,
    taskId: input.taskId ?? null,
    sessionId: input.sessionId ?? null,
    documentIds: input.documentIds ?? [],
    messageIds: input.messageIds ?? [],
    automationId: input.scheduleId ?? null,
    automationEditToken: input.scheduleEditToken ?? null,
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
        await getChat(c, existing.chatId, true);
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
    await getChat(c, existing.chatId, true);
    return publicRun(existing);
  }
  const chat = await getChat(c, input.chatId, true);
  if (
    chat.archived ||
    (chat.projectId && (await getProject(c, chat.projectId)).archived)
  )
    throw new DomainError("conflict", "Source archived");
  const agent = await getAgent(c, input.agentId);
  await getChat(
    { ...c, actor: { userId: c.actor.userId, agentId: agent.id } },
    input.chatId,
    true,
  );
  const subscription =
    input.type === "prompt" && agent.subscriptionId
      ? await getSubscription(c, agent.subscriptionId)
      : null;
  if (agent.archived) throw new DomainError("conflict", "Agent archived");
  if (agent.projectId && agent.projectId !== chat.projectId)
    throw new DomainError("forbidden");
  const audience = await getChatAudience(c, input.chatId);
  if (
    agent.visibility === "user" &&
    (audience.humans.some((id) => id !== agent.createdBy) ||
      audience.agents.some((id) => id !== agent.id))
  )
    throw new DomainError("forbidden", "User-scoped Agent audience");
  if (!audience.agents.includes(agent.id))
    throw new DomainError("forbidden", "Agent must participate");
  if (input.scheduleId) {
    const active = (
      await c.tx
        .select()
        .from(runs)
        .where(
          and(
            eq(runs.scheduleId, input.scheduleId),
            inArray(runs.state, [...ACTIVE_STATES]),
          ),
        )
    )[0];
    if (active) return publicRun(active);
  }
  if (input.taskId) {
    const task = await getTask(c, input.taskId, true);
    if (task.archived) throw new DomainError("conflict", "Task archived");
    if (task.projectId !== chat.projectId) throw new DomainError("forbidden");
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
    projectId: chat.projectId,
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
      chatId: chat.id,
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
          chatId: chat.id,
          agentId: agent.id,
          sponsorId: c.actor.userId,
          taskId: input.taskId,
          scheduleId: input.scheduleId,
          scheduleEditToken: input.scheduleEditToken,
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
    chatId: run.chatId,
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
  await getChat(c, run.chatId);
  return publicRun(run);
}
/** Dispatch never starts host processes. A deferred provider produces a durable explicit failure. */
export async function dispatchRun(
  db: Database,
  runId: string,
  validateSchedule?: (
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
          await validateRunSources(c, run, validateSchedule);
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
  await getChat(c, run.chatId, true);
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
const audienceRun = alias(runs, "audience_run");
/**
 * SQL form of the `getFile` source-Run check (`getRunAudience`): the sponsor's human identity is in the saved
 * audience and in the current human Chat audience and can read the Chat, and an Agent actor is also a saved
 * Agent participant. Exact strings, this workspace only. Narrowing only; `getRunAudience` stays the authority.
 */
export const runAudienceHas = (c: Context, runId: AnyColumn) =>
  sql`exists (select 1 from ${runs} "audience_run" where ${audienceRun.id} = ${runId} and ${audienceRun.workspaceId} = ${c.workspaceId} and ${audienceRun.inputs}->'audience'->'humans' @> to_jsonb(${c.actor.userId}::text) and ${chatReadable(c, audienceRun.chatId)}${
    c.actor.agentId
      ? sql` and ${audienceRun.inputs}->'audience'->'agents' @> to_jsonb(${c.actor.agentId}::text) and ${chatHasSponsor(c, audienceRun.chatId)}`
      : sql``
  })`;
export async function getRunAudience(c: Context, id: string) {
  const run = required(
    (
      await c.tx
        .select()
        .from(runs)
        .where(and(eq(runs.id, id), eq(runs.workspaceId, c.workspaceId)))
    )[0],
  );
  const current = await getChatAudience(c, run.chatId);
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
  input: Pick<RunRequest, "chatId" | "taskId" | "messageIds" | "documentIds">,
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
    const message = await getMessage(c, input.chatId, id);
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
  validateSchedule?: (
    c: Context,
    id: string,
    editToken: number,
  ) => Promise<void>,
  phase: "launch" | "continue" = "launch",
) {
  requireWriter(c);
  const chat = await getChat(c, run.chatId, true);
  await getChat(
    { ...c, actor: { userId: run.sponsorId, agentId: run.agentId } },
    run.chatId,
    true,
  );
  if (
    phase === "launch" &&
    (chat.archived ||
      (chat.projectId && (await getProject(c, chat.projectId)).archived))
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
  if (phase === "launch" && run.scheduleId) {
    if (run.scheduleEditToken === null || !validateSchedule)
      throw new DomainError("conflict");
    await validateSchedule(c, run.scheduleId, run.scheduleEditToken);
  }
  const audience = await getChatAudience(c, run.chatId);
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
        chatId: run.chatId,
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
  await getChat(c, run.chatId, true);
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
  await createMessage(c, run.chatId, {
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
  await getChat(c, run.chatId, true);
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
  await createMessage(c, run.chatId, {
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
  const audience = await getChatAudience(c, parent.chatId);
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
      chatId: parent.chatId,
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
  await createMessage(c, parent.chatId, {
    requestId: child.id,
    body: `Directed request to agent ${input.agentId}: ${input.body}`,
  });
  return { runId: child.id, acknowledged: true };
}

const runSorts = {
  createdAt: timeKey(runs.createdAt),
  updatedAt: timeKey(runs.updatedAt),
};
export const RUN_SORTS = sortNames(runSorts);
/**
 * Entity discovery (`after`, optional sort and filters) or ordered replay (`cursor`, always by the commit
 * cursor). Replay takes no sort, `after` or filters beyond Chat and state, so its completeness never changes.
 */
export async function getRuns(
  c: Context,
  filter: PageOptions & {
    sort?: string;
    order?: string;
    chatId?: string;
    cursor?: number;
    state?: typeof runs.$inferSelect.state;
    agentId?: string;
    sponsorId?: string;
    type?: typeof runs.$inferSelect.type;
  },
) {
  const replay = filter.cursor !== undefined;
  if (
    replay &&
    (filter.after !== undefined ||
      filter.sort !== undefined ||
      filter.order !== undefined ||
      filter.agentId !== undefined ||
      filter.sponsorId !== undefined ||
      filter.type !== undefined)
  )
    throw new DomainError("invalid", "Choose one pagination position");
  const plan = sortPlan({
    operation: "getRuns",
    scope: c,
    filter,
    keys: runSorts,
    id: runs.id,
  });
  if (filter.chatId) await getChat(c, filter.chatId);
  const items = await c.tx
    .select({ id: runs.id, cursor: runs.cursor, position: plan.position })
    .from(runs)
    .where(
      and(
        eq(runs.workspaceId, c.workspaceId),
        filter.chatId ? eq(runs.chatId, filter.chatId) : undefined,
        replay
          ? gt(runs.cursor, filter.cursor as number)
          : and(plan.where, chatReadable(c, runs.chatId)),
        filter.state ? eq(runs.state, filter.state) : undefined,
        filter.agentId ? eq(runs.agentId, filter.agentId) : undefined,
        filter.sponsorId ? eq(runs.sponsorId, filter.sponsorId) : undefined,
        filter.type ? eq(runs.type, filter.type) : undefined,
      ),
    )
    .orderBy(...(replay ? [runs.cursor] : plan.orderBy))
    .limit(plan.limit + 1);
  const page: { items: { id: string }[]; next: string | number | null } = replay
    ? getPage(items, (row) => row.cursor, plan.limit)
    : pageOf(items, plan, (row) => row.id);
  return authorizedPage(
    page,
    async (item) => {
      return getRun(c, item.id);
    },
    plan,
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
  await getChat(c, run.chatId);
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
  const file = required(
    skill.supportingFiles?.find((file) => file.path === path),
  );
  return {
    path: file.path,
    fileId: file.artifactId,
    sha256: file.sha256,
    byteLength: file.byteLength,
  };
}

/**
 * USD estimate at the accepted catalog list price, per request like Pi's `calculateCost`: the highest tier whose
 * input threshold the request's input + cacheRead + cacheWrite exceeds prices that request in full. Null when no
 * price was accepted, any of the four priced counts (input, output, cacheRead, cacheWrite) is unreported or the
 * result is not finite.
 */
export function estimateCost(
  price: ModelConfig["cost"],
  receipts: readonly UsageReceipt[],
): number | null {
  if (!price || receipts.length === 0) return null;
  let amount = 0;
  for (const { tokens } of receipts) {
    const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } =
      tokens;
    if (
      inputTokens === null ||
      outputTokens === null ||
      cacheReadTokens === null ||
      cacheWriteTokens === null
    )
      return null;
    const requestInput = inputTokens + cacheReadTokens + cacheWriteTokens;
    let rates: ModelCostRates = price;
    let threshold = -1;
    for (const tier of price.tiers ?? [])
      if (
        requestInput > tier.inputTokensAbove &&
        tier.inputTokensAbove > threshold
      ) {
        rates = tier;
        threshold = tier.inputTokensAbove;
      }
    amount +=
      (rates.input * inputTokens +
        rates.output * outputTokens +
        rates.cacheRead * cacheReadTokens +
        rates.cacheWrite * cacheWriteTokens) /
      1_000_000;
  }
  return Number.isFinite(amount) ? Math.round(amount * 1e9) / 1e9 : null;
}
/**
 * Whole-Run totals of the model requests Pi reported, only after finished capture. They exclude retries inside the
 * gateway and are not billed money.
 * `estimatedCost` prices each message's reported tokens at the catalog API list price accepted with the Run
 * (the highest tier whose input threshold the message exceeds). It is an estimate, not a subscription charge,
 * and stays null when the Run is incomplete, any of the four priced counts is unreported or no price was accepted.
 */
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
  const amount = complete
    ? estimateCost(run.inputs.modelConfig?.cost, run.usage)
    : null;
  return {
    provider: run.inputs.provider,
    model: run.inputs.model,
    // Pi-observed model requests only: assistant messages and compaction summaries. Retries inside the
    // gateway are not observed, so this is never provider-billed or whole-account consumption.
    scope: "pi_observed" as const,
    complete,
    messageCount: run.usage.length,
    unreportedCount: run.usage.filter((message) =>
      Object.values(message.tokens).some((count) => count === null),
    ).length,
    inputTokens: total("inputTokens"),
    outputTokens: total("outputTokens"),
    cacheReadTokens: total("cacheReadTokens"),
    cacheWriteTokens: total("cacheWriteTokens"),
    totalTokens: total("totalTokens"),
    estimatedCost:
      amount === null
        ? null
        : {
            amount,
            currency: "USD" as const,
            basis: "api_list_price" as const,
          },
  };
}
