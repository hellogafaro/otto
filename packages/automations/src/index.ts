import { getAgent } from "@otto/agents";
import { getConversation } from "@otto/conversations";
import type { Database } from "@otto/db";
import { admitRun, type Harnesses } from "@otto/runs";
import {
  DomainError,
  filterPage,
  getPage,
  type PageOptions,
  parsePageOptions,
  required,
} from "@otto/shared";

import {
  advanceCursor,
  type Context,
  inWorkspace,
  requireHuman,
  requireMember,
  requireWriter,
} from "@otto/workspaces";
import { CronExpressionParser } from "cron-parser";
import { and, eq, gt, sql } from "drizzle-orm";
import { fromDrizzle, type PgBoss } from "pg-boss";
import { automationHistory, automations } from "./schema";
export const CRON_QUEUE = "otto-automation-tick";
export const SCHEDULE_QUEUE = "otto-automation-schedule";
export interface AutomationInput {
  name: string;
  agentId: string;
  conversationId: string;
  type: "prompt" | "script";
  body: string;
  taskId?: string;
  cron?: string;
  timezone: string;
  status: "enabled" | "disabled" | "archived";
}
function validateSchedule(input: AutomationInput) {
  if (!["enabled", "disabled", "archived"].includes(input.status))
    throw new DomainError("invalid", "Invalid Automation status");
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
          name: input.name,
          agentId: input.agentId,
          conversationId: input.conversationId,
          type: input.type,
          body: input.body,
          taskId: input.taskId,
          cron: input.cron,
          timezone: input.timezone,
          status: input.status,
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
  await advanceCursor(c);
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
export async function updateAutomation(
  c: Context,
  boss: PgBoss,
  id: string,
  input: Partial<AutomationInput> & { editToken: number; ownerId?: string },
) {
  requireHuman(c);
  requireWriter(c);
  const old = await getAutomation(c, id);
  if (old.ownerId !== c.actor.userId) throw new DomainError("forbidden");
  if (old.editToken !== input.editToken) throw new DomainError("conflict");
  const { editToken, ownerId, ...changes } = input;
  if (
    !Object.values(changes).some((value) => value !== undefined) &&
    ownerId === undefined
  )
    throw new DomainError("invalid", "No editable fields");
  if (old.status === "archived" && input.status === "enabled")
    throw new DomainError("conflict", "Restore disabled before enabling");
  const next = {
    ...old,
    ...changes,
    taskId: input.taskId ?? old.taskId ?? undefined,
    cron: input.cron ?? old.cron ?? undefined,
  };
  validateSchedule(next);
  await getAgent(c, next.agentId);
  const conversation = await getConversation(c, next.conversationId, true);
  if (ownerId !== undefined) {
    await requireMember(c, ownerId, true);
    await getConversation(
      { ...c, actor: { userId: ownerId } },
      next.conversationId,
      true,
    );
  }
  const row = required(
    (
      await c.tx
        .update(automations)
        .set({
          name: input.name,
          agentId: input.agentId,
          conversationId: input.conversationId,
          type: input.type,
          body: input.body,
          taskId: input.taskId,
          cron: input.cron,
          timezone: input.timezone,
          status: input.status,
          ownerId,
          projectId: conversation.projectId,
          editToken: editToken + 1,
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
  await advanceCursor(c);
  return row;
}
export async function runAutomation(
  c: Context,
  boss: PgBoss,
  id: string,
  requestId: string,
  harnesses: Harnesses = {},
) {
  const automation = await getAutomation(c, id);
  if (automation.status === "archived")
    throw new DomainError("conflict", "Automation archived");
  if (automation.ownerId !== c.actor.userId) throw new DomainError("forbidden");
  return admitRun(
    c,
    boss,
    {
      ...automation,
      taskId: automation.taskId ?? undefined,
      requestId,
      automationId: id,
      automationEditToken: automation.editToken,
    },
    harnesses,
  );
}
export async function validateAutomation(
  c: Context,
  id: string,
  editToken: number,
) {
  const automation = await getAutomation(c, id);
  if (automation.status === "archived")
    throw new DomainError("conflict", "Automation archived");
  if (
    automation.ownerId !== c.actor.userId ||
    automation.editToken !== editToken
  )
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
        if (row.status !== "enabled" || !row.cron) {
          await boss.unschedule(CRON_QUEUE, id);
          return;
        }
        await boss.schedule(
          CRON_QUEUE,
          row.cron,
          { automationId: id, editToken: row.editToken },
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
export async function deliverAutomation(
  db: Database,
  boss: PgBoss,
  input: { automationId: string; editToken: number; id: string },
  harnesses: Harnesses = {},
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
            .from(automationHistory)
            .where(eq(automationHistory.id, input.id))
        )[0];
        if (existing) return existing;
        const automation = await getAutomation(c, input.automationId);
        if (
          automation.status !== "enabled" ||
          automation.editToken !== input.editToken
        )
          return required(
            (
              await c.tx
                .insert(automationHistory)
                .values({
                  id: input.id,
                  automationId: automation.id,
                  outcome: "stale_configuration",
                })
                .returning()
            )[0],
          );
        const run = await admitRun(
          c,
          boss,
          {
            ...automation,
            taskId: automation.taskId ?? undefined,
            automationId: automation.id,
            automationEditToken: automation.editToken,
            requestId: `cron:${input.id}`,
          },
          harnesses,
        );
        return required(
          (
            await c.tx
              .insert(automationHistory)
              .values({
                id: input.id,
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
          .insert(automationHistory)
          .values({
            id: input.id,
            automationId: input.automationId,
            outcome: `rejected_${error.code}`,
          })
          .onConflictDoUpdate({
            target: automationHistory.id,
            set: { id: input.id },
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

export async function getAutomations(
  c: Context,
  filter: PageOptions & { status?: AutomationInput["status"] } = {},
) {
  const { limit } = parsePageOptions(filter);
  const candidates = await c.tx
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.workspaceId, c.workspaceId),
        filter.status ? eq(automations.status, filter.status) : undefined,
        filter.after ? gt(automations.id, filter.after) : undefined,
      ),
    )
    .orderBy(automations.id)
    .limit(limit + 1);
  return filterPage(
    getPage(candidates, (row) => row.id, limit),
    async (row) => {
      await getConversation(c, row.conversationId);
      return row;
    },
  );
}
export async function getAutomationHistory(
  c: Context,
  id: string,
  options: PageOptions = {},
) {
  const { after, limit } = parsePageOptions(options);
  await getAutomation(c, id);
  const rows = await c.tx
    .select()
    .from(automationHistory)
    .where(
      and(
        eq(automationHistory.automationId, id),
        after ? gt(automationHistory.id, after) : undefined,
      ),
    )
    .orderBy(automationHistory.id)
    .limit(limit + 1);
  return getPage(rows, (row) => row.id, limit);
}
