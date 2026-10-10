import { createHash } from "node:crypto";
import { requireProjectMember } from "@otto/projects";
import { DomainError, required } from "@otto/shared";
import { advanceCursor, type Context, requireHuman } from "@otto/workspaces";
import { and, desc, eq } from "drizzle-orm";
import {
  createTaskComment,
  getTaskComment,
  validateTaskCommentBody,
  validateTaskCommentId,
} from "./comments";
import { taskReviews } from "./comments-schema";
import { createTaskLink, getTask, resolveTaskReviewStatus } from "./index";
import { tasks } from "./schema";

export async function getTaskReview(c: Context, id: string) {
  await getTask(c, id);
  const review = (
    await c.tx
      .select()
      .from(taskReviews)
      .where(
        and(
          eq(taskReviews.taskId, id),
          eq(taskReviews.workspaceId, c.workspaceId),
        ),
      )
      .orderBy(desc(taskReviews.editToken))
      .limit(1)
  )[0];
  if (!review) return null;
  let decisionRequest = null;
  if (!c.actor.agentId && review.decisionBy === c.actor.userId) {
    try {
      await getTask(c, id, true);
      decisionRequest = review.decisionInput;
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== "forbidden")
        throw error;
    }
  }
  return {
    taskId: review.taskId,
    chatId: review.chatId,
    agentId: review.agentId,
    comment: await getTaskComment(c, review.commentId),
    decisionRequest,
    continuationStatus: review.continuationStatus,
  };
}

export async function submitTaskReview(
  c: Context,
  id: string,
  input: { editToken: number; body: string; chatId?: string },
) {
  const body = validateTaskCommentBody(input.body);
  const chatId =
    input.chatId === undefined ? null : validateTaskCommentId(input.chatId);
  const task = await getTask(c, id, true);
  if (!Number.isInteger(input.editToken) || input.editToken < 0)
    throw new DomainError("invalid");
  if (task.editToken !== input.editToken)
    throw new DomainError("conflict", "Task changed");
  if (task.status === "done" || task.status === "review")
    throw new DomainError("conflict", "Task cannot be submitted for review");
  await requireProjectMember(c, task.projectId, task.ownerId, true);
  const comment = await createTaskComment(c, { taskId: id, body });
  if (chatId) await createTaskLink(c, id, { type: "chat", reference: chatId });
  const agentId = c.actor.agentId?.toLowerCase() ?? null;
  await c.tx.insert(taskReviews).values({
    taskId: id,
    workspaceId: c.workspaceId,
    commentId: comment.id,
    chatId,
    agentId,
    editToken: task.editToken + 1,
  });
  await c.tx
    .update(tasks)
    .set({ status: "review", editToken: task.editToken + 1 })
    .where(eq(tasks.id, id));
  await advanceCursor(c);
  return { task: await getTask(c, id), comment, chatId, agentId };
}

export async function reviewTask(
  c: Context,
  id: string,
  input: {
    requestId: string;
    editToken: number;
    decision: "approve" | "request_changes";
    body?: string;
  },
) {
  requireHuman(c);
  if (
    !Number.isInteger(input.editToken) ||
    input.editToken < 0 ||
    (input.body !== undefined && typeof input.body !== "string")
  )
    throw new DomainError("invalid");
  if (input.decision !== "approve" && input.decision !== "request_changes")
    throw new DomainError("invalid");
  const task = await getTask(c, id, true);
  if (
    c.actor.userId !== task.ownerId &&
    c.role !== "owner" &&
    c.role !== "admin"
  )
    throw new DomainError("forbidden");
  const requestId = validateTaskCommentId(input.requestId);
  const hash = createHash("sha256")
    .update(
      JSON.stringify([input.editToken, input.decision, input.body ?? null]),
    )
    .digest("hex");
  const receipt = (
    await c.tx
      .select()
      .from(taskReviews)
      .where(
        and(
          eq(taskReviews.taskId, id),
          eq(taskReviews.workspaceId, c.workspaceId),
          eq(taskReviews.decisionRequestId, requestId),
        ),
      )
  )[0];
  if (receipt?.decisionRequestId === requestId) {
    if (receipt.decisionBy !== c.actor.userId || receipt.decisionHash !== hash)
      throw new DomainError("conflict", "Review request changed");
    const result = required(receipt.decisionResult ?? undefined);
    return {
      ...result,
      task: {
        ...result.task,
        createdAt: result.task.createdAt
          ? new Date(result.task.createdAt)
          : null,
        updatedAt: result.task.updatedAt
          ? new Date(result.task.updatedAt)
          : null,
        dueAt: result.task.dueAt ? new Date(result.task.dueAt) : null,
      },
      comment: {
        ...result.comment,
        createdAt: new Date(result.comment.createdAt),
        updatedAt: new Date(result.comment.updatedAt),
      },
    };
  }
  if (task.status !== "review")
    throw new DomainError("conflict", "Task is not in review");
  const review = required((await getTaskReview(c, id)) ?? undefined);
  const body =
    input.decision === "request_changes"
      ? `Changes requested\n\n${validateTaskCommentBody(input.body ?? "")}`
      : `Approved${input.body ? `\n\n${input.body}` : ""}`;
  validateTaskCommentBody(body);
  const updated = await resolveTaskReviewStatus(c, id, {
    status: input.decision === "approve" ? "done" : "doing",
    editToken: input.editToken,
  });
  const comment = await createTaskComment(c, { taskId: id, body });
  const result = {
    task: updated,
    comment,
    chatId: review.chatId,
    agentId: review.agentId,
  };
  await c.tx
    .update(taskReviews)
    .set({
      decisionRequestId: requestId,
      decisionCommentId: comment.id,
      decisionBy: c.actor.userId,
      decisionHash: hash,
      decisionInput: {
        requestId,
        editToken: input.editToken,
        decision: input.decision,
        ...(input.body === undefined ? {} : { body: input.body }),
      },
      decisionResult: result,
      continuationStatus:
        input.decision === "request_changes" ? "pending" : null,
    })
    .where(eq(taskReviews.commentId, review.comment.id));
  return result;
}

export async function markTaskReviewContinuation(
  c: Context,
  taskId: string,
  requestId: string,
  status: "pending" | "sent" | "unavailable",
) {
  requireHuman(c);
  if (!["pending", "sent", "unavailable"].includes(status))
    throw new DomainError("invalid");
  await getTask(c, taskId, true);
  const receipt = required(
    (
      await c.tx
        .select()
        .from(taskReviews)
        .where(
          and(
            eq(taskReviews.taskId, taskId),
            eq(taskReviews.workspaceId, c.workspaceId),
            eq(taskReviews.decisionRequestId, validateTaskCommentId(requestId)),
          ),
        )
    )[0],
  );
  if (
    receipt.decisionBy !== c.actor.userId ||
    receipt.decisionInput?.decision !== "request_changes"
  )
    throw new DomainError("forbidden");
  if (
    receipt.continuationStatus === "sent" ||
    receipt.continuationStatus === status
  )
    return;
  await c.tx
    .update(taskReviews)
    .set({ continuationStatus: status })
    .where(eq(taskReviews.commentId, receipt.commentId));
  await advanceCursor(c);
}
