import { getAgent } from "@otto/agents";
import { getProject, requireProjectMember } from "@otto/projects";
import {
  DomainError,
  getPage,
  type PageOptions,
  parsePageOptions,
  required,
} from "@otto/shared";

import { advanceCursor, type Context, requireHuman } from "@otto/workspaces";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { taskLinks, tasks } from "./schema";
export async function createTask(
  c: Context,
  input: { projectId: string; title: string; notes?: string; ownerId?: string },
) {
  await getProject(c, input.projectId, true);
  const ownerId =
    input.ownerId ?? (!c.actor.agentId ? c.actor.userId : undefined);
  if (!ownerId) throw new DomainError("invalid", "Human sponsor required");
  await requireProjectMember(c, input.projectId, ownerId, true);
  const task = required(
    (
      await c.tx
        .insert(tasks)
        .values({ ...input, ownerId, workspaceId: c.workspaceId })
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return task;
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
  return task;
}
export async function setTaskStatus(
  c: Context,
  id: string,
  input: { status: "todo" | "doing" | "done"; editToken: number },
) {
  const task = await getTask(c, id, true);
  if (input.status === "done") requireHuman(c);
  else await requireProjectMember(c, task.projectId, task.ownerId, true);
  if (task.editToken !== input.editToken)
    throw new DomainError("conflict", "Task changed");
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
  return updated;
}
export async function assertNoOpenOwnedTasks(c: Context, userId: string) {
  if (
    (
      await c.tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(
            eq(tasks.workspaceId, c.workspaceId),
            eq(tasks.ownerId, userId),
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

export async function assignTask(
  c: Context,
  id: string,
  assignee: { userId?: string; agentId?: string },
) {
  requireHuman(c);
  const task = await getTask(c, id, true);
  if (assignee.userId && assignee.agentId) throw new DomainError("invalid");
  if (assignee.userId)
    await requireProjectMember(c, task.projectId, assignee.userId, true);
  if (assignee.agentId) {
    const agent = await getAgent(c, assignee.agentId);
    if (agent.projectId && agent.projectId !== task.projectId)
      throw new DomainError("forbidden");
  }
  const updated = required(
    (
      await c.tx
        .update(tasks)
        .set({
          assigneeUserId: assignee.userId ?? null,
          assigneeAgentId: assignee.agentId ?? null,
          editToken: task.editToken + 1,
        })
        .where(eq(tasks.id, id))
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return updated;
}

export async function updateTask(
  c: Context,
  id: string,
  input: {
    title?: string;
    notes?: string;
    ownerId?: string;
    editToken: number;
  },
) {
  const task = await getTask(c, id, true);
  if (task.editToken !== input.editToken) throw new DomainError("conflict");
  if (
    input.title === undefined &&
    input.notes === undefined &&
    input.ownerId === undefined
  )
    throw new DomainError("invalid");
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
          ownerId: input.ownerId,
          editToken: task.editToken + 1,
        })
        .where(eq(tasks.id, id))
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return updated;
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
  return updated;
}
export async function getTasks(
  c: Context,
  filter: {
    projectId: string;
    after?: string;
    limit?: number;
    archived?: boolean;
    query?: string;
    status?: "todo" | "doing" | "done";
    ownerId?: string;
    assigneeUserId?: string;
    assigneeAgentId?: string;
  },
) {
  const { limit } = parsePageOptions(filter);
  await getProject(c, filter.projectId);
  const items = await c.tx
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.workspaceId, c.workspaceId),
        eq(tasks.projectId, filter.projectId),
        eq(tasks.archived, filter.archived ?? false),
        filter.after ? gt(tasks.id, filter.after) : undefined,
        filter.status ? eq(tasks.status, filter.status) : undefined,
        filter.ownerId ? eq(tasks.ownerId, filter.ownerId) : undefined,
        filter.assigneeUserId
          ? eq(tasks.assigneeUserId, filter.assigneeUserId)
          : undefined,
        filter.assigneeAgentId
          ? eq(tasks.assigneeAgentId, filter.assigneeAgentId)
          : undefined,
        filter.query
          ? sql`to_tsvector('simple', ${tasks.title} || ' ' || ${tasks.notes}) @@ plainto_tsquery('simple', ${filter.query})`
          : undefined,
      ),
    )
    .orderBy(tasks.id)
    .limit(limit + 1);
  return getPage(items, (row) => row.id, limit);
}

export async function assertNoOpenProjectTasks(
  c: Context,
  projectId: string,
  userId: string,
) {
  const rows = await c.tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.workspaceId, c.workspaceId),
        eq(tasks.projectId, projectId),
        eq(tasks.ownerId, userId),
        ne(tasks.status, "done"),
      ),
    )
    .limit(1);
  if (rows.length)
    throw new DomainError(
      "conflict",
      "Transfer open tasks before changing owner eligibility",
    );
}
/** Links are references only; server composition authorizes each target independently on write and read. */
export async function createTaskLink(
  c: Context,
  id: string,
  target: {
    type: "document" | "conversation" | "artifact" | "url";
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
export async function getTaskLinks(
  c: Context,
  id: string,
  options: PageOptions = {},
) {
  await getTask(c, id);
  const { after, limit } = parsePageOptions(options);
  const rows = await c.tx
    .select()
    .from(taskLinks)
    .where(
      and(
        eq(taskLinks.taskId, id),
        after ? gt(taskLinks.id, after) : undefined,
      ),
    )
    .orderBy(taskLinks.id)
    .limit(limit + 1);
  return getPage(rows, (row) => row.id, limit);
}
export async function deleteTaskLink(c: Context, id: string, linkId: string) {
  await getTask(c, id, true);
  await c.tx
    .delete(taskLinks)
    .where(and(eq(taskLinks.id, linkId), eq(taskLinks.taskId, id)));
  await advanceCursor(c);
}
