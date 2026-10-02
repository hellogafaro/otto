import { getAgent } from "@otto/agents";
import { getConversation } from "@otto/conversations";
import { type Database, DomainError, required } from "@otto/db";
import { admitRun } from "@otto/runs";
import {
  advanceRevision,
  type Context,
  inWorkspace,
  requireHuman,
  requireWriter,
} from "@otto/workspaces";
import { CronExpressionParser } from "cron-parser";
import { and, eq, sql } from "drizzle-orm";
import { fromDrizzle, type PgBoss } from "pg-boss";
import { automations, occurrences } from "./schema";
export const CRON_QUEUE = "otto-automation-tick";
export const SCHEDULE_QUEUE = "otto-automation-schedule";
export interface AutomationInput {
  name: string;
  agentId: string;
  conversationId: string;
  kind: "prompt" | "script";
  body: string;
  skillIds: string[];
  cron?: string;
  timezone: string;
  enabled: boolean;
}
function validateSchedule(input: AutomationInput) {
  if (input.cron) {
    if (input.cron.trim().split(/\s+/).length !== 5)
      throw new DomainError("invalid", "Use minute-level cron");
    try {
      CronExpressionParser.parse(input.cron, { tz: input.timezone });
      new Intl.DateTimeFormat("en", { timeZone: input.timezone });
    } catch {
      throw new DomainError("invalid", "Invalid schedule");
    }
  }
}
export async function createAutomation(
  c: Context,
  boss: PgBoss,
  input: AutomationInput,
) {
  requireHuman(c);
  requireWriter(c);
  validateSchedule(input);
  await getAgent(c, input.agentId);
  const conversation = await getConversation(c, input.conversationId, true);
  const row = required(
    (
      await c.tx
        .insert(automations)
        .values({
          ...input,
          workspaceId: c.workspaceId,
          ownerId: c.actor.userId,
          projectId: conversation.projectId,
        })
        .returning()
    )[0],
  );
  await boss.send(
    SCHEDULE_QUEUE,
    { automationId: row.id },
    {
      db: fromDrizzle(c.tx, sql),
      retryLimit: 5,
      retryDelay: 5,
      retryBackoff: true,
    },
  );
  await advanceRevision(c);
  return row;
}
export async function getAutomation(c: Context, id: string) {
  const row = required(
    (
      await c.tx
        .select()
        .from(automations)
        .where(
          and(
            eq(automations.id, id),
            eq(automations.workspaceId, c.workspaceId),
          ),
        )
    )[0],
  );
  await getConversation(c, row.conversationId);
  return row;
}
export async function saveAutomation(
  c: Context,
  boss: PgBoss,
  id: string,
  input: AutomationInput & { editToken: number },
) {
  requireHuman(c);
  requireWriter(c);
  validateSchedule(input);
  const old = await getAutomation(c, id);
  if (old.ownerId !== c.actor.userId) throw new DomainError("forbidden");
  if (old.configToken !== input.editToken) throw new DomainError("conflict");
  await getAgent(c, input.agentId);
  const conversation = await getConversation(c, input.conversationId, true);
  const { editToken, ...fields } = input;
  const row = required(
    (
      await c.tx
        .update(automations)
        .set({
          ...fields,
          projectId: conversation.projectId,
          configToken: editToken + 1,
        })
        .where(eq(automations.id, id))
        .returning()
    )[0],
  );
  await boss.send(
    SCHEDULE_QUEUE,
    { automationId: id },
    {
      db: fromDrizzle(c.tx, sql),
      retryLimit: 5,
      retryDelay: 5,
      retryBackoff: true,
    },
  );
  await advanceRevision(c);
  return row;
}
export async function runAutomation(
  c: Context,
  boss: PgBoss,
  id: string,
  requestId: string,
) {
  const automation = await getAutomation(c, id);
  if (automation.ownerId !== c.actor.userId) throw new DomainError("forbidden");
  return admitRun(c, boss, {
    ...automation,
    requestId,
    automationId: id,
    automationToken: automation.configToken,
  });
}
export async function validateAutomation(
  c: Context,
  id: string,
  token: number,
) {
  const automation = await getAutomation(c, id);
  if (automation.ownerId !== c.actor.userId || automation.configToken !== token)
    throw new DomainError("conflict", "Automation changed");
}
/** pg-boss schedule() ignores SendOptions.db in this pinned release. Durable reconciliation plus a configuration fence covers that non-atomic boundary. */
export async function reconcileSchedule(
  db: Database,
  boss: PgBoss,
  id: string,
) {
  const descriptor = required(
    (
      await db
        .select({
          workspaceId: automations.workspaceId,
          ownerId: automations.ownerId,
        })
        .from(automations)
        .where(eq(automations.id, id))
    )[0],
  );
  try {
    await inWorkspace(
      db,
      descriptor.workspaceId,
      { userId: descriptor.ownerId },
      async (c) => {
        const row = await getAutomation(c, id);
        if (!row.enabled || !row.cron) {
          await boss.unschedule(CRON_QUEUE, id);
          return;
        }
        await boss.schedule(
          CRON_QUEUE,
          row.cron,
          { automationId: id, token: row.configToken },
          {
            key: id,
            tz: row.timezone,
            missed: "skip",
            retryLimit: 3,
            retryDelay: 5,
            retryBackoff: true,
          },
        );
      },
    );
  } catch (error) {
    if (!(error instanceof DomainError) || error.code !== "forbidden")
      throw error;
    await boss.unschedule(CRON_QUEUE, id);
  }
}
/** Uses pg-boss delivery identity, never a freshly generated ID, to deduplicate ticks. */
export async function deliverOccurrence(
  db: Database,
  boss: PgBoss,
  input: { automationId: string; token: number; jobId: string },
) {
  const descriptor = required(
    (
      await db
        .select({
          workspaceId: automations.workspaceId,
          ownerId: automations.ownerId,
        })
        .from(automations)
        .where(eq(automations.id, input.automationId))
    )[0],
  );
  try {
    return await inWorkspace(
      db,
      descriptor.workspaceId,
      { userId: descriptor.ownerId },
      async (c) => {
        const existing = (
          await c.tx
            .select()
            .from(occurrences)
            .where(eq(occurrences.jobId, input.jobId))
        )[0];
        if (existing) return existing;
        const automation = await getAutomation(c, input.automationId);
        if (!automation.enabled || automation.configToken !== input.token)
          return required(
            (
              await c.tx
                .insert(occurrences)
                .values({
                  jobId: input.jobId,
                  automationId: automation.id,
                  outcome: "stale_configuration",
                })
                .returning()
            )[0],
          );
        const run = await admitRun(c, boss, {
          ...automation,
          automationId: automation.id,
          automationToken: automation.configToken,
          requestId: `cron:${input.jobId}`,
        });
        return required(
          (
            await c.tx
              .insert(occurrences)
              .values({
                jobId: input.jobId,
                automationId: automation.id,
                runId: run.id,
                outcome: "admitted_or_existing",
              })
              .returning()
          )[0],
        );
      },
    );
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    return required(
      (
        await db
          .insert(occurrences)
          .values({
            jobId: input.jobId,
            automationId: input.automationId,
            outcome: `rejected_${error.code}`,
          })
          .onConflictDoUpdate({
            target: occurrences.jobId,
            set: { jobId: input.jobId },
          })
          .returning()
      )[0],
    );
  }
}
export async function assertNoOwnedAutomations(c: Context, userId: string) {
  if (
    (
      await c.tx
        .select({ id: automations.id })
        .from(automations)
        .where(
          and(
            eq(automations.workspaceId, c.workspaceId),
            eq(automations.ownerId, userId),
          ),
        )
        .limit(1)
    ).length
  )
    throw new DomainError(
      "conflict",
      "Transfer automations before removing owner",
    );
}
