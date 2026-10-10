import { getAgent } from "@otto/agents";
import {
  intKey,
  matchesText,
  pageOf,
  sortNames,
  sortPlan,
  textKey,
  timeKey,
} from "@otto/db";
import { getProject, requireProjectMember } from "@otto/projects";
import { DomainError, type PageOptions, required } from "@otto/shared";

import { advanceCursor, type Context, requireHuman } from "@otto/workspaces";
import {
  and,
  eq,
  exists,
  getTableColumns,
  gte,
  inArray,
  lt,
  ne,
  sql,
} from "drizzle-orm";
import { nextOccurrence, parseRecurrence } from "./recurrence";
import { taskAgents, taskLinks, tasks, taskUsers, timesheets } from "./schema";

const MAX_ASSIGNEES = 20;
interface Assignees {
  assigneeUserIds?: string[];
  assigneeAgentIds?: string[];
}

/** Public Task projection: stored row plus sorted assignee selections and the known successor, hydrated in batch. */
async function withAssignees(c: Context, rows: (typeof tasks.$inferSelect)[]) {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const [users, agents, successors] = await Promise.all([
    c.tx
      .select()
      .from(taskUsers)
      .where(
        and(
          eq(taskUsers.workspaceId, c.workspaceId),
          inArray(taskUsers.taskId, ids),
        ),
      )
      .orderBy(taskUsers.userId),
    c.tx
      .select()
      .from(taskAgents)
      .where(
        and(
          eq(taskAgents.workspaceId, c.workspaceId),
          inArray(taskAgents.taskId, ids),
        ),
      )
      .orderBy(taskAgents.agentId),
    c.tx
      .select({ id: tasks.id, predecessorId: tasks.predecessorId })
      .from(tasks)
      .where(
        and(
          eq(tasks.workspaceId, c.workspaceId),
          inArray(tasks.predecessorId, ids),
        ),
      ),
  ]);
  return rows.map((row) => ({
    ...row,
    successorId:
      successors.find((entry) => entry.predecessorId === row.id)?.id ?? null,
    assigneeUserIds: users
      .filter((entry) => entry.taskId === row.id)
      .map((entry) => entry.userId),
    assigneeAgentIds: agents
      .filter((entry) => entry.taskId === row.id)
      .map((entry) => entry.agentId),
  }));
}
async function withAssignee(c: Context, row: typeof tasks.$inferSelect) {
  return required((await withAssignees(c, [row]))[0]);
}

/** Strict, bounded, duplicate-free selections; undefined keeps a field unchanged and [] clears it. */
function normalizeAssignees(input: Assignees) {
  const users = input.assigneeUserIds;
  const agentIds = input.assigneeAgentIds;
  const bounded = (values: unknown, normalize: (value: string) => string) => {
    if (values === undefined) return undefined;
    if (!Array.isArray(values) || values.length > MAX_ASSIGNEES)
      throw new DomainError("invalid", "Assignee selection limit");
    const selected = values.map((value) => {
      if (typeof value !== "string") throw new DomainError("invalid");
      return normalize(value);
    });
    if (new Set(selected).size !== selected.length)
      throw new DomainError("invalid", "Duplicate assignee");
    return selected.sort();
  };
  return {
    userIds: bounded(users, (value) => {
      if (!value || value.length > 128) throw new DomainError("invalid");
      return value;
    }),
    agentIds: bounded(agentIds, (value) => {
      if (!UUID.test(value)) throw new DomainError("invalid");
      return value.toLowerCase();
    }),
  };
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Assignment is human-authorized and never widens access: members must already be current Project writers, Agents visible to the actor in the Project. */
async function requireAssignees(
  c: Context,
  projectId: string,
  selected: ReturnType<typeof normalizeAssignees>,
) {
  if (selected.userIds === undefined && selected.agentIds === undefined) return;
  requireHuman(c);
  for (const userId of selected.userIds ?? [])
    await requireProjectMember(c, projectId, userId, true);
  for (const agentId of selected.agentIds ?? []) {
    const agent = await getAgent(c, agentId);
    if (agent.projectId && agent.projectId !== projectId)
      throw new DomainError("forbidden");
  }
}
async function writeAssignees(
  c: Context,
  taskId: string,
  selected: ReturnType<typeof normalizeAssignees>,
) {
  if (selected.userIds !== undefined) {
    await c.tx.delete(taskUsers).where(eq(taskUsers.taskId, taskId));
    if (selected.userIds.length)
      await c.tx.insert(taskUsers).values(
        selected.userIds.map((userId) => ({
          workspaceId: c.workspaceId,
          taskId,
          userId,
        })),
      );
  }
  if (selected.agentIds !== undefined) {
    await c.tx.delete(taskAgents).where(eq(taskAgents.taskId, taskId));
    if (selected.agentIds.length)
      await c.tx.insert(taskAgents).values(
        selected.agentIds.map((agentId) => ({
          workspaceId: c.workspaceId,
          taskId,
          agentId,
        })),
      );
  }
}

/** Normal due date and optional recurrence text; undefined keeps a field unchanged, null clears it. */
function normalizeSchedule(input: {
  dueAt?: Date | null;
  recurrence?: string | null;
}) {
  if (
    input.dueAt !== undefined &&
    input.dueAt !== null &&
    (!(input.dueAt instanceof Date) || !Number.isFinite(input.dueAt.getTime()))
  )
    throw new DomainError("invalid", "Invalid due date");
  return {
    dueAt: input.dueAt,
    recurrence:
      input.recurrence === undefined || input.recurrence === null
        ? input.recurrence
        : parseRecurrence(input.recurrence),
  };
}

export async function createTask(
  c: Context,
  input: {
    projectId: string;
    title: string;
    notes?: string;
    ownerId?: string;
    dueAt?: Date | null;
    recurrence?: string | null;
  } & Assignees,
) {
  await getProject(c, input.projectId, true);
  const ownerId =
    input.ownerId ?? (!c.actor.agentId ? c.actor.userId : undefined);
  if (!ownerId) throw new DomainError("invalid", "Human sponsor required");
  await requireProjectMember(c, input.projectId, ownerId, true);
  const assignees = normalizeAssignees(input);
  await requireAssignees(c, input.projectId, assignees);
  const schedule = normalizeSchedule(input);
  const task = required(
    (
      await c.tx
        .insert(tasks)
        .values({
          projectId: input.projectId,
          title: input.title,
          notes: input.notes,
          ...schedule,
          ownerId,
          workspaceId: c.workspaceId,
        })
        .returning()
    )[0],
  );
  await writeAssignees(c, task.id, assignees);
  await advanceCursor(c);
  return withAssignee(c, task);
}
export async function getTask(c: Context, id: string, write = false) {
  const task = required(
    (
      await c.tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, id), eq(tasks.workspaceId, c.workspaceId)))
    )[0],
  );
  await getProject(c, task.projectId, write);
  return withAssignee(c, task);
}
/** Assignees copied to a successor are only those still eligible; ineligible optional ones are dropped, the completed Task keeps its own. */
async function eligibleAssignees(
  c: Context,
  task: { projectId: string } & Assignees,
) {
  const eligible = async (check: () => Promise<unknown>) => {
    try {
      await check();
      return true;
    } catch (error) {
      if (error instanceof DomainError) return false;
      throw error;
    }
  };
  const assigneeUserIds: string[] = [];
  for (const userId of task.assigneeUserIds ?? [])
    if (
      await eligible(() =>
        requireProjectMember(c, task.projectId, userId, true),
      )
    )
      assigneeUserIds.push(userId);
  const assigneeAgentIds: string[] = [];
  for (const agentId of task.assigneeAgentIds ?? [])
    if (
      await eligible(async () => {
        const agent = await getAgent(c, agentId);
        if (agent.projectId && agent.projectId !== task.projectId)
          throw new DomainError("forbidden");
      })
    )
      assigneeAgentIds.push(agentId);
  return { assigneeUserIds, assigneeAgentIds };
}

/**
 * Completion creates the next occurrence in the same transaction: a todo Task due at the first rule occurrence strictly
 * after the server completion instant, copying the original recurrence text so DTSTART, INTERVAL, COUNT and UNTIL never
 * restart. unique(predecessorId) makes it once per Task: reopening and completing again, or any retry, creates nothing more.
 */
async function createSuccessor(
  c: Context,
  task: Awaited<ReturnType<typeof getTask>>,
  completedAt: Date,
) {
  if (!task.recurrence || task.archived || task.successorId) return;
  // Evaluated before any write; an unevaluable rule rolls back Done explicitly.
  const dueAt = nextOccurrence(task.recurrence, completedAt);
  if (!dueAt) return;
  await requireProjectMember(c, task.projectId, task.ownerId, true);
  const assignees = await eligibleAssignees(c, task);
  const created = (
    await c.tx
      .insert(tasks)
      .values({
        workspaceId: c.workspaceId,
        projectId: task.projectId,
        title: task.title,
        notes: task.notes,
        ownerId: task.ownerId,
        recurrence: task.recurrence,
        dueAt,
        predecessorId: task.id,
      })
      .onConflictDoNothing({ target: tasks.predecessorId })
      .returning()
  )[0];
  if (created)
    await writeAssignees(c, created.id, normalizeAssignees(assignees));
}
export async function setTaskStatus(
  c: Context,
  id: string,
  input: { status: "backlog" | "todo" | "doing" | "done"; editToken: number },
) {
  return changeTaskStatus(c, id, input, false);
}

export async function resolveTaskReviewStatus(
  c: Context,
  id: string,
  input: { status: "doing" | "done"; editToken: number },
) {
  requireHuman(c);
  return changeTaskStatus(c, id, input, true);
}

async function changeTaskStatus(
  c: Context,
  id: string,
  input: { status: "backlog" | "todo" | "doing" | "done"; editToken: number },
  reviewing: boolean,
) {
  if (!["backlog", "todo", "doing", "done"].includes(input.status))
    throw new DomainError("invalid", "Submit a completion summary for review");
  const task = await getTask(c, id, true);
  if ((task.status === "review") !== reviewing)
    throw new DomainError(
      "conflict",
      "Use the review controls for tasks in review",
    );
  if (task.status === "review") {
    requireHuman(c);
    if (
      c.actor.userId !== task.ownerId &&
      c.role !== "owner" &&
      c.role !== "admin"
    )
      throw new DomainError("forbidden");
    if (input.status !== "doing" && input.status !== "done")
      throw new DomainError(
        "invalid",
        "Approve or request changes to the review",
      );
  }
  if (input.status === "done") requireHuman(c);
  else await requireProjectMember(c, task.projectId, task.ownerId, true);
  if (task.editToken !== input.editToken)
    throw new DomainError("conflict", "Task changed");
  const completedAt = new Date();
  if (input.status === "done" && task.status !== "done")
    await createSuccessor(c, task, completedAt);
  const updated = required(
    (
      await c.tx
        .update(tasks)
        .set({ status: input.status, editToken: task.editToken + 1 })
        .where(eq(tasks.id, id))
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return withAssignee(c, updated);
}
export async function assertNoOpenOwnedTasks(
  c: Context,
  userId: string,
  projectId?: string,
) {
  if (
    (
      await c.tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(
            eq(tasks.workspaceId, c.workspaceId),
            eq(tasks.ownerId, userId),
            projectId ? eq(tasks.projectId, projectId) : undefined,
            ne(tasks.status, "done"),
          ),
        )
        .limit(1)
    ).length
  )
    throw new DomainError(
      "conflict",
      "Transfer open tasks before removing their owner",
    );
}

export async function updateTask(
  c: Context,
  id: string,
  input: {
    title?: string;
    notes?: string;
    ownerId?: string;
    dueAt?: Date | null;
    recurrence?: string | null;
    editToken: number;
  } & Assignees,
) {
  const task = await getTask(c, id, true);
  if (task.editToken !== input.editToken) throw new DomainError("conflict");
  const assignees = normalizeAssignees(input);
  const schedule = normalizeSchedule(input);
  if (
    input.title === undefined &&
    input.notes === undefined &&
    input.ownerId === undefined &&
    schedule.dueAt === undefined &&
    schedule.recurrence === undefined &&
    assignees.userIds === undefined &&
    assignees.agentIds === undefined
  )
    throw new DomainError("invalid");
  await requireAssignees(c, task.projectId, assignees);
  if (input.ownerId !== undefined) {
    requireHuman(c);
    if (
      c.actor.userId !== task.ownerId &&
      c.role !== "owner" &&
      c.role !== "admin"
    )
      throw new DomainError("forbidden");
    await requireProjectMember(c, task.projectId, input.ownerId, true);
  }
  const updated = required(
    (
      await c.tx
        .update(tasks)
        .set({
          title: input.title,
          notes: input.notes,
          ...schedule,
          ownerId: input.ownerId,
          editToken: task.editToken + 1,
        })
        .where(eq(tasks.id, id))
        .returning()
    )[0],
  );
  await writeAssignees(c, id, assignees);
  await advanceCursor(c);
  return withAssignee(c, updated);
}
export async function archiveTask(
  c: Context,
  id: string,
  archived: boolean,
  editToken: number,
) {
  requireHuman(c);
  const task = await getTask(c, id, true);
  if (task.editToken !== editToken) throw new DomainError("conflict");
  const updated = required(
    (
      await c.tx
        .update(tasks)
        .set({ archived, editToken: task.editToken + 1 })
        .where(eq(tasks.id, id))
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return withAssignee(c, updated);
}
const taskSorts = {
  title: textKey(tasks.title),
  createdAt: timeKey(tasks.createdAt),
  updatedAt: timeKey(tasks.updatedAt),
  dueAt: timeKey(tasks.dueAt),
};
export const TASK_SORTS = sortNames(taskSorts);
/** A Project is always explicit: Tasks are never discovered across Projects the caller did not name. */
export async function getTasks(
  c: Context,
  filter: PageOptions & {
    projectId: string;
    sort?: string;
    order?: string;
    archived?: boolean;
    query?: string;
    status?: "backlog" | "todo" | "doing" | "review" | "done";
    ownerId?: string;
    assigneeUserId?: string;
    assigneeAgentId?: string;
    /** `dueAt` bounds: from inclusive, to exclusive. */
    dueFrom?: Date;
    dueTo?: Date;
  },
) {
  const f = { ...filter, archived: filter.archived ?? false };
  const plan = sortPlan({
    operation: "getTasks",
    scope: c,
    filter: f,
    keys: taskSorts,
    id: tasks.id,
  });
  await getProject(c, f.projectId);
  const items = await c.tx
    .select({ ...getTableColumns(tasks), position: plan.position })
    .from(tasks)
    .where(
      and(
        eq(tasks.workspaceId, c.workspaceId),
        eq(tasks.projectId, f.projectId),
        eq(tasks.archived, f.archived),
        f.status ? eq(tasks.status, f.status) : undefined,
        f.ownerId ? eq(tasks.ownerId, f.ownerId) : undefined,
        f.dueFrom ? gte(tasks.dueAt, f.dueFrom) : undefined,
        f.dueTo ? lt(tasks.dueAt, f.dueTo) : undefined,
        f.assigneeUserId
          ? exists(
              c.tx
                .select({ one: sql`1` })
                .from(taskUsers)
                .where(
                  and(
                    eq(taskUsers.taskId, tasks.id),
                    eq(taskUsers.userId, f.assigneeUserId),
                  ),
                ),
            )
          : undefined,
        f.assigneeAgentId
          ? exists(
              c.tx
                .select({ one: sql`1` })
                .from(taskAgents)
                .where(
                  and(
                    eq(taskAgents.taskId, tasks.id),
                    eq(taskAgents.agentId, f.assigneeAgentId.toLowerCase()),
                  ),
                ),
            )
          : undefined,
        f.query
          ? matchesText(sql`${tasks.title} || ' ' || ${tasks.notes}`, f.query)
          : undefined,
        plan.where,
      ),
    )
    .orderBy(...plan.orderBy)
    .limit(plan.limit + 1);
  const page = pageOf(items, plan, (row) => row.id);
  return { items: await withAssignees(c, page.items), next: page.next };
}

/** Links are references only; server composition authorizes each target independently on write and read. */
export async function createTaskLink(
  c: Context,
  id: string,
  target: {
    type: "document" | "chat" | "file" | "url";
    reference: string;
  },
) {
  await getTask(c, id, true);
  const links = await c.tx
    .select()
    .from(taskLinks)
    .where(eq(taskLinks.taskId, id))
    .limit(100);
  if (
    links.length === 100 &&
    !links.some(
      (link) =>
        link.type === target.type && link.reference === target.reference,
    )
  )
    throw new DomainError("conflict", "Task link limit");
  await c.tx
    .insert(taskLinks)
    .values({ taskId: id, ...target })
    .onConflictDoNothing();
  await advanceCursor(c);
}
const linkSorts = {
  type: textKey(taskLinks.type),
  reference: textKey(taskLinks.reference),
};
export const TASK_LINK_SORTS = sortNames(linkSorts);
export async function getTaskLinks(
  c: Context,
  id: string,
  options: PageOptions & {
    sort?: string;
    order?: string;
    type?: (typeof taskLinks.$inferSelect)["type"];
  } = {},
) {
  await getTask(c, id);
  const plan = sortPlan({
    operation: `getTaskLinks:${id}`,
    scope: c,
    filter: options,
    keys: linkSorts,
    id: taskLinks.id,
  });
  const rows = await c.tx
    .select({
      id: taskLinks.id,
      taskId: taskLinks.taskId,
      type: taskLinks.type,
      reference: taskLinks.reference,
      position: plan.position,
    })
    .from(taskLinks)
    .where(
      and(
        eq(taskLinks.taskId, id),
        options.type ? eq(taskLinks.type, options.type) : undefined,
        plan.where,
      ),
    )
    .orderBy(...plan.orderBy)
    .limit(plan.limit + 1);
  return pageOf(rows, plan, (row) => row.id);
}
export async function deleteTaskLink(c: Context, id: string, linkId: string) {
  await getTask(c, id, true);
  await c.tx
    .delete(taskLinks)
    .where(and(eq(taskLinks.id, linkId), eq(taskLinks.taskId, id)));
  await advanceCursor(c);
}

function timesheetId(id: string) {
  if (
    typeof id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    throw new DomainError("invalid");
  return id;
}
function timesheetFields(
  input: { duration?: number; notes?: string | null },
  allowed: readonly string[],
) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !allowed.includes(key)) ||
    (input.duration === undefined && input.notes === undefined) ||
    (input.duration !== undefined &&
      (!Number.isInteger(input.duration) ||
        input.duration < 1 ||
        input.duration > 2147483647)) ||
    (input.notes !== undefined &&
      input.notes !== null &&
      (typeof input.notes !== "string" ||
        Buffer.byteLength(input.notes) > 4000))
  )
    throw new DomainError("invalid");
  return { duration: input.duration, notes: input.notes };
}

/** Current Task readers can read entries; only their human creator can correct them. */
export async function getTimesheet(c: Context, id: string, write = false) {
  const entry = required(
    (
      await c.tx
        .select()
        .from(timesheets)
        .where(
          and(
            eq(timesheets.id, timesheetId(id)),
            eq(timesheets.workspaceId, c.workspaceId),
          ),
        )
    )[0],
  );
  await getTask(c, entry.taskId, write);
  if (write) {
    requireHuman(c);
    if (entry.createdBy !== c.actor.userId) throw new DomainError("forbidden");
  }
  return entry;
}

export async function createTimesheet(
  c: Context,
  input: { taskId: string; duration: number; notes?: string | null },
) {
  requireHuman(c);
  const fields = timesheetFields(input, ["taskId", "duration", "notes"]);
  if (fields.duration === undefined) throw new DomainError("invalid");
  await getTask(c, timesheetId(input.taskId), true);
  const entry = required(
    (
      await c.tx
        .insert(timesheets)
        .values({
          workspaceId: c.workspaceId,
          taskId: input.taskId,
          createdBy: c.actor.userId,
          duration: fields.duration,
          notes: fields.notes,
        })
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return entry;
}

export async function updateTimesheet(
  c: Context,
  id: string,
  input: { duration?: number; notes?: string | null },
) {
  const fields = timesheetFields(input, ["duration", "notes"]);
  await getTimesheet(c, id, true);
  const entry = required(
    (
      await c.tx
        .update(timesheets)
        .set(fields)
        .where(eq(timesheets.id, id))
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return entry;
}

export async function deleteTimesheet(c: Context, id: string) {
  await getTimesheet(c, id, true);
  await c.tx.delete(timesheets).where(eq(timesheets.id, id));
  await advanceCursor(c);
}

const timesheetSorts = {
  createdAt: timeKey(timesheets.createdAt),
  duration: intKey(timesheets.duration),
};
export const TIMESHEET_SORTS = sortNames(timesheetSorts);
/** Task-scoped lookup; from is inclusive and to exclusive, both logging timestamps. */
export async function getTimesheets(
  c: Context,
  filter: PageOptions & {
    taskId: string;
    sort?: string;
    order?: string;
    createdBy?: string;
    from?: Date;
    to?: Date;
  },
) {
  if (
    !filter ||
    typeof filter !== "object" ||
    Array.isArray(filter) ||
    Object.keys(filter).some(
      (key) =>
        ![
          "taskId",
          "createdBy",
          "from",
          "to",
          "after",
          "limit",
          "sort",
          "order",
        ].includes(key),
    ) ||
    (filter.createdBy !== undefined &&
      (typeof filter.createdBy !== "string" ||
        !filter.createdBy ||
        filter.createdBy.length > 128)) ||
    [filter.from, filter.to].some(
      (date) =>
        date !== undefined &&
        (!(date instanceof Date) || !Number.isFinite(date.getTime())),
    ) ||
    (filter.from && filter.to && filter.from >= filter.to)
  )
    throw new DomainError("invalid");
  const plan = sortPlan({
    operation: "getTimesheets",
    scope: c,
    filter,
    keys: timesheetSorts,
    id: timesheets.id,
  });
  await getTask(c, timesheetId(filter.taskId));
  const entries = await c.tx
    .select({ ...getTableColumns(timesheets), position: plan.position })
    .from(timesheets)
    .where(
      and(
        eq(timesheets.workspaceId, c.workspaceId),
        eq(timesheets.taskId, filter.taskId),
        filter.createdBy
          ? eq(timesheets.createdBy, filter.createdBy)
          : undefined,
        filter.from ? gte(timesheets.createdAt, filter.from) : undefined,
        filter.to ? lt(timesheets.createdAt, filter.to) : undefined,
        plan.where,
      ),
    )
    .orderBy(...plan.orderBy)
    .limit(plan.limit + 1);
  return pageOf(entries, plan, (entry) => entry.id);
}
