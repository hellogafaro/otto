import { getChat, getChatAudience } from "@otto/chats";
import { getProjectAudience } from "@otto/projects";
import { DomainError } from "@otto/shared";
import { serializeMention } from "@otto/shared/mentions";
import { getTask } from "@otto/tasks";
import { getTaskComment } from "@otto/tasks/comments";
import { getTaskReview, markTaskReviewContinuation } from "@otto/tasks/review";
import { type Context, inWorkspace } from "@otto/workspaces";
import { createChatMessage } from "./chat-replies";
import type { ApiOptions } from "./http";

export async function readableTaskReview<T extends { chatId: string | null }>(
  c: Context,
  review: T | null,
) {
  if (!review?.chatId) return review;
  try {
    await getChat(c, review.chatId);
    return review;
  } catch (error) {
    if (
      !(error instanceof DomainError) ||
      !["forbidden", "not_found"].includes(error.code)
    )
      throw error;
    return { ...review, chatId: null };
  }
}

export async function continueTaskReview(
  options: Pick<
    ApiOptions,
    "db" | "nativeStorage" | "boss" | "modelAuthorization"
  >,
  workspaceId: string,
  userId: string,
  result: {
    taskId: string;
    commentId: string;
    editToken: number;
    requestId: string;
  },
) {
  const finish = async <T extends { status: "sent" | "unavailable" }>(
    delivery: T,
  ) => {
    await inWorkspace(options.db, workspaceId, { userId }, (c) =>
      markTaskReviewContinuation(
        c,
        result.taskId,
        result.requestId,
        delivery.status,
      ),
    );
    return delivery;
  };
  try {
    const prepare = async (c: Context) => {
      const task = await getTask(c, result.taskId);
      const review = await getTaskReview(c, task.id);
      const comment = await getTaskComment(c, result.commentId);
      const chatId = review?.chatId;
      const agentId = review?.agentId;
      if (
        !chatId ||
        !agentId ||
        task.archived ||
        task.status !== "doing" ||
        task.editToken !== result.editToken ||
        review.decisionRequest?.requestId !== result.requestId ||
        review.decisionRequest.decision !== "request_changes" ||
        comment.taskId !== task.id ||
        comment.createdBy !== userId ||
        comment.agentId
      )
        throw new DomainError("conflict", "Review changed");
      const chat = await getChat(c, chatId, true);
      const audience = await getChatAudience(c, chatId);
      const readers = await getProjectAudience(c, task.projectId);
      if (
        chat.projectId !== task.projectId ||
        !audience.agents.includes(agentId) ||
        audience.humans.some((id) => !readers.includes(id))
      )
        throw new DomainError("forbidden");
      return {
        chatId,
        input: {
          requestId: comment.id,
          body: `${serializeMention({ type: "agent", id: agentId, label: "Task worker" })} Changes requested for Task ${task.id}: ${task.title}\n\n${comment.body}`,
        },
      };
    };
    const delivery = await inWorkspace(
      options.db,
      workspaceId,
      { userId },
      prepare,
      false,
    );
    const sent = await createChatMessage(
      options,
      workspaceId,
      { userId },
      delivery.chatId,
      delivery.input,
      async (c) => {
        await prepare(c);
      },
      result,
    );
    return finish(
      sent.replyErrors.length
        ? {
            status: "unavailable" as const,
            message:
              "Changes saved in the worker Chat, but the Agent could not start. Check its access and model account, then retry.",
          }
        : { status: "sent" as const, messageId: sent.id },
    );
  } catch {
    return finish({
      status: "unavailable" as const,
      message:
        "Changes saved, but the worker could not be notified. Check the linked Chat and retry.",
    });
  }
}
