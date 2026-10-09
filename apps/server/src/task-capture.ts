import { getChatAudience, getMessage } from "@otto/chats";
import { getProjectAudience } from "@otto/projects";
import type { NativeSessionStorage } from "@otto/sessions/native";
import { DomainError } from "@otto/shared";
import { createTask, createTaskLink } from "@otto/tasks";
import type { Context } from "@otto/workspaces";

export async function captureTask(
  c: Context,
  native: NativeSessionStorage,
  input: {
    projectId: string;
    title: string;
    chatId: string;
    messageId: string;
    ownerId?: string;
  },
) {
  const message = await getMessage(c, input.chatId, input.messageId, native);
  const audience = await getChatAudience(c, input.chatId);
  const destination = await getProjectAudience(c, input.projectId);
  if (destination.some((userId) => !audience.humans.includes(userId)))
    throw new DomainError(
      "forbidden",
      "Capture would widen the source audience",
    );
  const task = await createTask(c, {
    projectId: input.projectId,
    title: input.title,
    notes: message.body,
    ownerId: input.ownerId,
  });
  await createTaskLink(c, task.id, { type: "chat", reference: input.chatId });
  return task;
}
