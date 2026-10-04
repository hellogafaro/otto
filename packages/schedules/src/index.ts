import { getAgent } from "@otto/agents";
import { chatReadable, getChat } from "@otto/chats";
import {
  authorizedPage,
  type Database,
  matchesText,
  pageOf,
  sortNames,
  sortPlan,
  textKey,
  timeKey,
} from "@otto/db";
import { admitRun, type PiInstallation, prepareRunModel } from "@otto/runs";
import { DomainError, type PageOptions, required } from "@otto/shared";

import {
  advanceCursor,
  type Context,
  inWorkspace,
  requireHuman,
  requireMember,
  requireWriter,
} from "@otto/workspaces";
import { CronExpressionParser } from "cron-parser";
import { and, eq, getTableColumns, sql } from "drizzle-orm";
import { fromDrizzle, type PgBoss } from "pg-boss";
import { scheduleHistory, schedules } from "./schema";
// Private durable pg-boss names/payloads stay exact across the product rename.
export const CRON_QUEUE = "otto-automation-tick";
export const SCHEDULE_QUEUE = "otto-automation-schedule";
export type Schedule = typeof schedules.$inferSelect;
export interface ScheduleInput {
  title: string;
  agentId: string;
  chatId: string;
  type: "prompt" | "script";
  body: string;
  taskId?: string;
  cron?: string;
  timezone: string;
  status: "enabled" | "disabled" | "archived";
}
function validateInput(input: ScheduleInput) {
  if (!["enabled", "disabled", "archived"].includes(input.status))
    throw new DomainError("invalid", "Invalid Schedule status");
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
export async function createSchedule(
  c: Context,
  boss: PgBoss,
  input: ScheduleInput,
) {
  requireHuman(c);
  requireWriter(c);
  validateInput(input);
  await getAgent(c, input.agentId);
  await getChat(c, input.chatId, true);
  const row = required(
    (
      await c.tx
        .insert(schedules)
        .values({
          title: input.title,
          agentId: input.agentId,
          chatId: input.chatId,
          type: input.type,
          body: input.body,
          taskId: input.taskId,
          cron: input.cron,
          timezone: input.timezone,
          status: input.status,
          workspaceId: c.workspaceId,
          ownerId: c.actor.userId,
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
export async function getSchedule(c: Context, id: string) {
  const row = required(
    (
      await c.tx
        .select()
        .from(schedules)
        .where(
          and(eq(schedules.id, id), eq(schedules.workspaceId, c.workspaceId)),
        )
    )[0],
  );
  await getChat(c, row.chatId);
  return row;
}
export async function updateSchedule(
  c: Context,
  boss: PgBoss,
  id: string,
  input: Partial<ScheduleInput> & { editToken: number; ownerId?: string },
) {
  requireHuman(c);
  requireWriter(c);
  const old = await getSchedule(c, id);
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
  validateInput(next);
  await getAgent(c, next.agentId);
  await getChat(c, next.chatId, true);
  if (ownerId !== undefined) {
    await requireMember(c, ownerId, true);
    await getChat({ ...c, actor: { userId: ownerId } }, next.chatId, true);
  }
  const row = required(
    (
      await c.tx
        .update(schedules)
        .set({
          title: input.title,
          agentId: input.agentId,
          chatId: input.chatId,
          type: input.type,
          body: input.body,
          taskId: input.taskId,
          cron: input.cron,
          timezone: input.timezone,
          status: input.status,
          ownerId,
          editToken: editToken + 1,
        })
        .where(eq(schedules.id, id))
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
export async function runSchedule(
  c: Context,
  boss: PgBoss,
  id: string,
  requestId: string,
  pi?: PiInstallation,
) {
  const schedule = await getSchedule(c, id);
  if (schedule.status === "archived")
    throw new DomainError("conflict", "Schedule archived");
  if (schedule.ownerId !== c.actor.userId) throw new DomainError("forbidden");
  return admitRun(
    c,
    boss,
    {
      ...schedule,
      taskId: schedule.taskId ?? undefined,
      requestId,
      scheduleId: id,
      scheduleEditToken: schedule.editToken,
    },
    pi,
  );
}
export async function validateSchedule(
  c: Context,
  id: string,
  editToken: number,
) {
  const schedule = await getSchedule(c, id);
  if (schedule.status === "archived")
    throw new DomainError("conflict", "Schedule archived");
  if (schedule.ownerId !== c.actor.userId || schedule.editToken !== editToken)
    throw new DomainError("conflict", "Schedule changed");
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
          workspaceId: schedules.workspaceId,
          ownerId: schedules.ownerId,
        })
        .from(schedules)
        .where(eq(schedules.id, id))
    )[0],
  );
  try {
    await inWorkspace(
      db,
      descriptor.workspaceId,
      { userId: descriptor.ownerId },
      async (c) => {
        const row = await getSchedule(c, id);
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
export async function deliverSchedule(
  db: Database,
  boss: PgBoss,
  input: { scheduleId: string; editToken: number; id: string },
  pi?: PiInstallation,
) {
  const descriptor = required(
    (
      await db
        .select({
          workspaceId: schedules.workspaceId,
          ownerId: schedules.ownerId,
        })
        .from(schedules)
        .where(eq(schedules.id, input.scheduleId))
    )[0],
  );
  try {
    const completed = (
      await db
        .select()
        .from(scheduleHistory)
        .where(eq(scheduleHistory.id, input.id))
    )[0];
    if (completed) return completed;
    const selection = await inWorkspace(
      db,
      descriptor.workspaceId,
      { userId: descriptor.ownerId },
      async (c) => {
        const current = await getSchedule(c, input.scheduleId);
        return current.status === "enabled" &&
          current.editToken === input.editToken
          ? current
          : null;
      },
      false,
    );
    const preparedPi = selection
      ? await prepareRunModel(
          db,
          descriptor.workspaceId,
          { userId: descriptor.ownerId },
          { ...selection, requestId: `cron:${input.id}` },
          pi,
        )
      : pi;
    return await inWorkspace(
      db,
      descriptor.workspaceId,
      { userId: descriptor.ownerId },
      async (c) => {
        const existing = (
          await c.tx
            .select()
            .from(scheduleHistory)
            .where(eq(scheduleHistory.id, input.id))
        )[0];
        if (existing) return existing;
        const schedule = await getSchedule(c, input.scheduleId);
        if (
          schedule.status !== "enabled" ||
          schedule.editToken !== input.editToken
        )
          return required(
            (
              await c.tx
                .insert(scheduleHistory)
                .values({
                  id: input.id,
                  scheduleId: schedule.id,
                  outcome: "stale_configuration",
                })
                .returning()
            )[0],
          );
        const run = await admitRun(
          c,
          boss,
          {
            ...schedule,
            taskId: schedule.taskId ?? undefined,
            scheduleId: schedule.id,
            scheduleEditToken: schedule.editToken,
            requestId: `cron:${input.id}`,
          },
          preparedPi,
        );
        return required(
          (
            await c.tx
              .insert(scheduleHistory)
              .values({
                id: input.id,
                scheduleId: schedule.id,
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
          .insert(scheduleHistory)
          .values({
            id: input.id,
            scheduleId: input.scheduleId,
            outcome: `rejected_${error.code}`,
          })
          .onConflictDoUpdate({
            target: scheduleHistory.id,
            set: { id: input.id },
          })
          .returning()
      )[0],
    );
  }
}
export async function assertNoOwnedSchedules(c: Context, userId: string) {
  if (
    (
      await c.tx
        .select({ id: schedules.id })
        .from(schedules)
        .where(
          and(
            eq(schedules.workspaceId, c.workspaceId),
            eq(schedules.ownerId, userId),
          ),
        )
        .limit(1)
    ).length
  )
    throw new DomainError(
      "conflict",
      "Transfer schedules before removing owner",
    );
}

const scheduleSorts = {
  title: textKey(schedules.title),
  createdAt: timeKey(schedules.createdAt),
  updatedAt: timeKey(schedules.updatedAt),
};
export const SCHEDULE_SORTS = sortNames(scheduleSorts);
export async function getSchedules(
  c: Context,
  filter: PageOptions & {
    sort?: string;
    order?: string;
    status?: ScheduleInput["status"];
    ownerId?: string;
    agentId?: string;
    type?: ScheduleInput["type"];
    query?: string;
  } = {},
) {
  const plan = sortPlan({
    operation: "getSchedules",
    scope: c,
    filter,
    keys: scheduleSorts,
    id: schedules.id,
  });
  const candidates = await c.tx
    .select({ ...getTableColumns(schedules), position: plan.position })
    .from(schedules)
    .where(
      and(
        eq(schedules.workspaceId, c.workspaceId),
        filter.status ? eq(schedules.status, filter.status) : undefined,
        filter.ownerId ? eq(schedules.ownerId, filter.ownerId) : undefined,
        filter.agentId ? eq(schedules.agentId, filter.agentId) : undefined,
        filter.type ? eq(schedules.type, filter.type) : undefined,
        filter.query ? matchesText(schedules.title, filter.query) : undefined,
        chatReadable(c, schedules.chatId),
        plan.where,
      ),
    )
    .orderBy(...plan.orderBy)
    .limit(plan.limit + 1);
  return authorizedPage(
    pageOf(candidates, plan, (row) => row.id),
    async (row) => {
      await getChat(c, row.chatId);
      return row;
    },
    plan,
  );
}
const historySorts = { receivedAt: timeKey(scheduleHistory.receivedAt) };
export const SCHEDULE_HISTORY_SORTS = sortNames(historySorts);
export async function getScheduleHistory(
  c: Context,
  id: string,
  options: PageOptions & {
    sort?: string;
    order?: string;
    outcome?: string;
    runId?: string;
  } = {},
) {
  const plan = sortPlan({
    operation: `getScheduleHistory:${id}`,
    scope: c,
    filter: options,
    keys: historySorts,
    id: scheduleHistory.id,
  });
  await getSchedule(c, id);
  const rows = await c.tx
    .select({ ...getTableColumns(scheduleHistory), position: plan.position })
    .from(scheduleHistory)
    .where(
      and(
        eq(scheduleHistory.scheduleId, id),
        options.outcome
          ? eq(scheduleHistory.outcome, options.outcome)
          : undefined,
        options.runId ? eq(scheduleHistory.runId, options.runId) : undefined,
        plan.where,
      ),
    )
    .orderBy(...plan.orderBy)
    .limit(plan.limit + 1);
  return pageOf(rows, plan, (row) => row.id);
}
