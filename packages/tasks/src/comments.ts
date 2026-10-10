import { getAgent } from "@otto/agents";
import {
  MAX_CURSOR_LENGTH,
  pageOf,
  sortNames,
  sortPlan,
  timeKey,
} from "@otto/db";
import { projectReadable } from "@otto/projects";
import { DomainError, required } from "@otto/shared";
import { advanceCursor, type Context, requireHuman } from "@otto/workspaces";
import { and, eq, getTableColumns, isNotNull, ne, or, sql } from "drizzle-orm";
import { taskComments } from "./comments-schema";
import { getTask } from "./index";
import { tasks } from "./schema";

export const MAX_TASK_COMMENT_BYTES = 10000;
export interface TaskCommentInput {
  taskId: string;
  body: string;
}
export interface TaskCommentQuery {
  taskId: string;
  limit?: number;
  after?: string;
  sort?: "createdAt" | "updatedAt";
  order?: "asc" | "desc";
}

export function validateTaskCommentId(value: string) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new DomainError("invalid");
  return value.toLowerCase();
}

export function validateTaskCommentBody(value: string) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    Buffer.byteLength(value) > MAX_TASK_COMMENT_BYTES
  )
    throw new DomainError("invalid");
  return value;
}

function fields(input: object, allowed: readonly string[]) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !allowed.includes(key))
  )
    throw new DomainError("invalid");
}

export function validateTaskCommentInput(input: TaskCommentInput) {
  fields(input, ["taskId", "body"]);
  return {
    taskId: validateTaskCommentId(input.taskId),
    body: validateTaskCommentBody(input.body),
  };
}

export function validateTaskCommentUpdate(input: { body: string }) {
  fields(input, ["body"]);
  return { body: validateTaskCommentBody(input.body) };
}

export function validateTaskCommentQuery(
  input: TaskCommentQuery,
): TaskCommentQuery & { sort: "createdAt" | "updatedAt" } {
  fields(input, ["taskId", "limit", "after", "sort", "order"]);
  const taskId = validateTaskCommentId(input.taskId);
  if (
    (input.limit !== undefined &&
      (!Number.isInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > 100)) ||
    (input.after !== undefined &&
      (typeof input.after !== "string" ||
        !input.after ||
        input.after.length > MAX_CURSOR_LENGTH)) ||
    (input.sort !== undefined &&
      input.sort !== "createdAt" &&
      input.sort !== "updatedAt") ||
    (input.order !== undefined &&
      (!input.sort || (input.order !== "asc" && input.order !== "desc")))
  )
    throw new DomainError("invalid");
  return { ...input, taskId, sort: input.sort ?? "createdAt" };
}

async function requireCommentTask(c: Context, taskId: string, write = false) {
  const task = await getTask(c, taskId, write);
  if (c.actor.agentId) {
    const agent = await getAgent(c, validateTaskCommentId(c.actor.agentId));
    if (
      (agent.projectId && agent.projectId !== task.projectId) ||
      (write && agent.archived)
    )
      throw new DomainError("forbidden");
  }
}

export async function getTaskComment(c: Context, id: string, write = false) {
  const comment = required(
    (
      await c.tx
        .select()
        .from(taskComments)
        .where(
          and(
            eq(taskComments.id, validateTaskCommentId(id)),
            eq(taskComments.workspaceId, c.workspaceId),
          ),
        )
    )[0],
  );
  await requireCommentTask(c, comment.taskId, write);
  if (
    write &&
    (comment.createdBy !== c.actor.userId ||
      comment.agentId !== (c.actor.agentId?.toLowerCase() ?? null))
  )
    throw new DomainError("forbidden");
  return comment;
}

export async function createTaskComment(c: Context, input: TaskCommentInput) {
  const values = validateTaskCommentInput(input);
  await requireCommentTask(c, values.taskId, true);
  const comment = required(
    (
      await c.tx
        .insert(taskComments)
        .values({
          ...values,
          workspaceId: c.workspaceId,
          createdBy: c.actor.userId,
          agentId: c.actor.agentId?.toLowerCase() ?? null,
        })
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return comment;
}

export async function updateTaskComment(
  c: Context,
  id: string,
  input: { body: string },
) {
  const values = validateTaskCommentUpdate(input);
  const current = await getTaskComment(c, id, true);
  const comment = required(
    (
      await c.tx
        .update(taskComments)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(taskComments.id, current.id))
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return comment;
}

export async function deleteTaskComment(c: Context, id: string) {
  const comment = await getTaskComment(c, id, true);
  await c.tx.delete(taskComments).where(eq(taskComments.id, comment.id));
  await advanceCursor(c);
}

const commentSorts = {
  createdAt: timeKey(taskComments.createdAt),
  updatedAt: timeKey(taskComments.updatedAt),
};
export const TASK_COMMENT_SORTS = sortNames(commentSorts);

export async function getTaskNotifications(
  c: Context,
  filter: { after?: string; limit?: number },
) {
  requireHuman(c);
  fields(filter, ["after", "limit"]);
  const plan = sortPlan({
    operation: "getTaskNotifications",
    scope: c,
    filter: { ...filter, sort: "createdAt", order: "desc" },
    keys: { createdAt: commentSorts.createdAt },
    id: taskComments.id,
  });
  const userId = encodeURIComponent(c.actor.userId)
    .replace(/\)/g, "%29")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mentioned = sql<boolean>`${taskComments.body} ~ ${String.raw`@\[((?:\\.|[^\]\\])*)\]\(user:${userId}\)`}`;
  const rows = await c.tx
    .select({
      id: taskComments.id,
      taskId: tasks.id,
      title: tasks.title,
      createdBy: taskComments.createdBy,
      agentId: taskComments.agentId,
      body: taskComments.body,
      createdAt: taskComments.createdAt,
      mentioned,
      position: plan.position,
    })
    .from(taskComments)
    .innerJoin(tasks, eq(taskComments.taskId, tasks.id))
    .where(
      and(
        eq(taskComments.workspaceId, c.workspaceId),
        eq(tasks.workspaceId, c.workspaceId),
        projectReadable(c, tasks.projectId),
        or(
          ne(taskComments.createdBy, c.actor.userId),
          isNotNull(taskComments.agentId),
        ),
        or(eq(tasks.ownerId, c.actor.userId), mentioned),
        plan.where,
      ),
    )
    .orderBy(...plan.orderBy)
    .limit(plan.limit + 1);
  return pageOf(rows, plan, (comment) => comment.id);
}

export async function getTaskComments(c: Context, input: TaskCommentQuery) {
  const filter = validateTaskCommentQuery(input);
  await requireCommentTask(c, filter.taskId);
  const plan = sortPlan({
    operation: "getTaskComments",
    scope: c,
    filter,
    keys: commentSorts,
    id: taskComments.id,
  });
  const rows = await c.tx
    .select({ ...getTableColumns(taskComments), position: plan.position })
    .from(taskComments)
    .where(
      and(
        eq(taskComments.workspaceId, c.workspaceId),
        eq(taskComments.taskId, filter.taskId),
        plan.where,
      ),
    )
    .orderBy(...plan.orderBy)
    .limit(plan.limit + 1);
  return pageOf(rows, plan, (comment) => comment.id);
}
