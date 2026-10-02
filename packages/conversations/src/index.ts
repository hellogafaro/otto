import { getAgent } from "@otto/agents";
import { DomainError, required } from "@otto/db";
import { getProject, getProjectAudience } from "@otto/projects";
import {
  advanceRevision,
  type Context,
  getWorkspaceAudience,
  requireHuman,
  requireMember,
  requireWriter,
} from "@otto/workspaces";
import { and, asc, eq, gt } from "drizzle-orm";
import { conversations, messages, participants } from "./schema";
export async function createConversation(
  c: Context,
  input: {
    title: string;
    projectId?: string;
    access: "inherited" | "restricted";
  },
) {
  requireHuman(c);
  requireWriter(c);
  if (input.projectId) await getProject(c, input.projectId, true);
  const conversation = required(
    (
      await c.tx
        .insert(conversations)
        .values({ ...input, workspaceId: c.workspaceId })
        .returning()
    )[0],
  );
  await c.tx.insert(participants).values({
    conversationId: conversation.id,
    userId: c.actor.userId,
    role: "contributor",
  });
  await advanceRevision(c);
  return conversation;
}
export async function getConversation(c: Context, id: string, write = false) {
  const conversation = required(
    (
      await c.tx
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.id, id),
            eq(conversations.workspaceId, c.workspaceId),
          ),
        )
    )[0],
  );
  if (conversation.projectId)
    await getProject(c, conversation.projectId, write);
  if (write) requireWriter(c);
  if (conversation.access === "restricted" || c.actor.agentId) {
    const participant = required(
      (
        await c.tx
          .select()
          .from(participants)
          .where(
            and(
              eq(participants.conversationId, id),
              c.actor.agentId
                ? eq(participants.agentId, c.actor.agentId)
                : eq(participants.userId, c.actor.userId),
            ),
          )
      )[0],
      "forbidden",
    );
    if (write && participant.role === "viewer")
      throw new DomainError("forbidden");
  }
  return conversation;
}
export async function addParticipant(
  c: Context,
  conversationId: string,
  input: { userId?: string; agentId?: string; role: "contributor" | "viewer" },
) {
  requireHuman(c);
  const conversation = await getConversation(c, conversationId, true);
  if (Boolean(input.userId) === Boolean(input.agentId))
    throw new DomainError("invalid");
  if (input.userId) await requireMember(c, input.userId);
  if (input.agentId) {
    const agent = await getAgent(c, input.agentId);
    if (agent.projectId && agent.projectId !== conversation.projectId)
      throw new DomainError("forbidden");
  }
  if (
    (
      await c.tx
        .select({ id: participants.id })
        .from(participants)
        .where(eq(participants.conversationId, conversationId))
        .limit(100)
    ).length >= 100
  )
    throw new DomainError("conflict", "Participant limit");
  await c.tx
    .insert(participants)
    .values({ ...input, conversationId })
    .onConflictDoNothing();
  await advanceRevision(c);
}
export async function removeParticipant(
  c: Context,
  conversationId: string,
  participantId: string,
) {
  requireHuman(c);
  await getConversation(c, conversationId, true);
  await c.tx
    .delete(participants)
    .where(
      and(
        eq(participants.id, participantId),
        eq(participants.conversationId, conversationId),
      ),
    );
  await advanceRevision(c);
}
export async function getConversationAudience(c: Context, id: string) {
  const conversation = await getConversation(c, id);
  const humans = conversation.projectId
    ? await getProjectAudience(c, conversation.projectId)
    : await getWorkspaceAudience(c);
  const explicit = await c.tx
    .select()
    .from(participants)
    .where(eq(participants.conversationId, id))
    .limit(101);
  if (explicit.length > 100) throw new DomainError("unavailable");
  return {
    humans:
      conversation.access === "inherited"
        ? humans
        : explicit.flatMap((p) =>
            p.userId && humans.includes(p.userId) ? [p.userId] : [],
          ),
    agents: explicit.flatMap((p) => (p.agentId ? [p.agentId] : [])).sort(),
  };
}
export async function createMessage(
  c: Context,
  conversationId: string,
  input: { body: string; requestId: string; replyTo?: string },
) {
  await getConversation(c, conversationId, true);
  const existing = (
    await c.tx
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.requestId, input.requestId),
        ),
      )
  )[0];
  if (existing) {
    if (
      existing.authorUserId !== (c.actor.agentId ? null : c.actor.userId) ||
      existing.authorAgentId !== (c.actor.agentId ?? null) ||
      existing.body !== input.body
    )
      throw new DomainError("conflict");
    return existing;
  }
  if (input.replyTo)
    required(
      (
        await c.tx
          .select({ id: messages.id })
          .from(messages)
          .where(
            and(
              eq(messages.id, input.replyTo),
              eq(messages.conversationId, conversationId),
            ),
          )
      )[0],
    );
  const revision = await advanceRevision(c);
  return required(
    (
      await c.tx
        .insert(messages)
        .values({
          ...input,
          workspaceId: c.workspaceId,
          conversationId,
          authorUserId: c.actor.agentId ? null : c.actor.userId,
          authorAgentId: c.actor.agentId,
          revision,
        })
        .returning()
    )[0],
  );
}
/** Workspace row locking makes this cursor commit ordered, unlike a bare sequence or timestamp. */
export async function getMessages(
  c: Context,
  conversationId: string,
  after = 0,
) {
  await getConversation(c, conversationId);
  return c.tx
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        gt(messages.revision, after),
      ),
    )
    .orderBy(asc(messages.revision))
    .limit(100);
}
