import { getAgent } from "@otto/agents";
import { DomainError, required } from "@otto/db";
import { getProject, requireProjectMember } from "@otto/projects";
import { advanceRevision, type Context, requireHuman } from "@otto/workspaces";
import { and, eq, ne } from "drizzle-orm";
import { tasks } from "./schema";
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
  await advanceRevision(c);
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
export async function getTasks(c: Context, projectId: string) {
  await getProject(c, projectId);
  return c.tx
    .select()
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .orderBy(tasks.id)
    .limit(100);
}
export async function setTaskStatus(
  c: Context,
  id: string,
  input: { status: "todo" | "doing" | "done"; editToken: number },
) {
  const task = await getTask(c, id, true);
  if (input.status === "done") requireHuman(c);
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
  await advanceRevision(c);
  return updated;
}
export async function transferTask(c: Context, id: string, ownerId: string) {
  requireHuman(c);
  const task = await getTask(c, id, true);
  if (
    c.actor.userId !== task.ownerId &&
    c.role !== "owner" &&
    c.role !== "admin"
  )
    throw new DomainError("forbidden");
  await requireProjectMember(c, task.projectId, ownerId, true);
  await c.tx
    .update(tasks)
    .set({ ownerId, editToken: task.editToken + 1 })
    .where(eq(tasks.id, id));
  await advanceRevision(c);
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
  await advanceRevision(c);
  return updated;
}
