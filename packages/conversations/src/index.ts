import { getAgent } from "@otto/agents";
import { getProject, getProjectAudience } from "@otto/projects";
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
  getWorkspaceAudience,
  requireHuman,
  requireMember,
  requireWriter,
} from "@otto/workspaces";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import {
  conversationReads,
  conversations,
  messages,
  participants,
} from "./schema";
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
  await advanceCursor(c);
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
  const participant = (
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
  )[0];
  if (conversation.access === "restricted" || c.actor.agentId)
    required(participant, "forbidden");
  if (write && participant?.role === "viewer")
    throw new DomainError("forbidden");
  return conversation;
}
export async function createParticipant(
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
  await advanceCursor(c);
}
export async function deleteParticipant(
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
  await advanceCursor(c);
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
  input: {
    body: string;
    requestId: string;
    replyTo?: string;
    mentionUserIds?: string[];
    artifactIds?: string[];
  },
) {
  await getConversation(c, conversationId, true);
  const mentions = input.mentionUserIds ?? [];
  if ((input.artifactIds?.length ?? 0) > 30) throw new DomainError("invalid");
  if (mentions.length > 50 || new Set(mentions).size !== mentions.length)
    throw new DomainError("invalid");
  if (mentions.length) {
    const audience = await getConversationAudience(c, conversationId);
    if (mentions.some((id) => !audience.humans.includes(id)))
      throw new DomainError("forbidden");
  }
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
      existing.body !== input.body ||
      existing.replyTo !== (input.replyTo ?? null) ||
      JSON.stringify([...existing.mentionUserIds].sort()) !==
        JSON.stringify([...mentions].sort()) ||
      JSON.stringify(existing.artifactIds) !==
        JSON.stringify(input.artifactIds ?? [])
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
  const cursor = await advanceCursor(c);
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
          cursor,
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
        gt(messages.cursor, after),
      ),
    )
    .orderBy(asc(messages.cursor))
    .limit(100);
}

export async function getConversations(
  c: Context,
  filter: {
    after?: string;
    limit?: number;
    projectId?: string;
    archived?: boolean;
    query?: string;
  },
) {
  const { limit } = parsePageOptions(filter);
  const rows = await c.tx
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.workspaceId, c.workspaceId),
        eq(conversations.archived, filter.archived ?? false),
        filter.projectId
          ? eq(conversations.projectId, filter.projectId)
          : undefined,
        filter.after ? gt(conversations.id, filter.after) : undefined,
        filter.query
          ? sql`to_tsvector('simple', ${conversations.title}) @@ plainto_tsquery('simple', ${filter.query})`
          : undefined,
      ),
    )
    .orderBy(conversations.id)
    .limit(limit + 1);
  return filterPage(
    getPage(rows, (row) => row.id, limit),
    async (row) => {
      return getConversation(c, row.id);
    },
  );
}
export async function updateConversation(
  c: Context,
  id: string,
  input: { title: string; editToken: number },
) {
  requireHuman(c);
  const conversation = await getConversation(c, id, true);
  if (conversation.editToken !== input.editToken)
    throw new DomainError("conflict");
  const updated = required(
    (
      await c.tx
        .update(conversations)
        .set({ title: input.title, editToken: conversation.editToken + 1 })
        .where(eq(conversations.id, id))
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return updated;
}
export async function archiveConversation(
  c: Context,
  id: string,
  archived: boolean,
  editToken: number,
) {
  requireHuman(c);
  const conversation = await getConversation(c, id, true);
  if (conversation.editToken !== editToken) throw new DomainError("conflict");
  const updated = required(
    (
      await c.tx
        .update(conversations)
        .set({ archived, editToken: conversation.editToken + 1 })
        .where(eq(conversations.id, id))
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return updated;
}
export async function getParticipants(
  c: Context,
  id: string,
  options: PageOptions = {},
) {
  await getConversation(c, id);
  const { after, limit } = parsePageOptions(options);
  const rows = await c.tx
    .select()
    .from(participants)
    .where(
      and(
        eq(participants.conversationId, id),
        after ? gt(participants.id, after) : undefined,
      ),
    )
    .orderBy(participants.id)
    .limit(limit + 1);
  return getPage(rows, (row) => row.id, limit);
}
export async function markConversationRead(
  c: Context,
  id: string,
  cursor: number,
) {
  requireHuman(c);
  await getConversation(c, id);
  if (!Number.isSafeInteger(cursor) || cursor < 0)
    throw new DomainError("invalid");
  if (cursor > 0)
    required(
      (
        await c.tx
          .select({ id: messages.id })
          .from(messages)
          .where(
            and(eq(messages.conversationId, id), eq(messages.cursor, cursor)),
          )
      )[0],
      "invalid",
    );
  await c.tx
    .insert(conversationReads)
    .values({ conversationId: id, userId: c.actor.userId, cursor })
    .onConflictDoUpdate({
      target: [conversationReads.conversationId, conversationReads.userId],
      set: {
        cursor: sql`greatest(${conversationReads.cursor},${cursor})`,
      },
    });
  await advanceCursor(c);
}
/** Attention is a permission-filtered view of saved messages and read cursors, not a notification queue. */
export async function getConversationAttention(
  c: Context,
  filter: { after?: string; limit?: number; mentionsOnly?: boolean },
) {
  requireHuman(c);
  const page = await getConversations(c, filter);
  const items = [];
  for (const conversation of page.items) {
    const read = (
      await c.tx
        .select()
        .from(conversationReads)
        .where(
          and(
            eq(conversationReads.conversationId, conversation.id),
            eq(conversationReads.userId, c.actor.userId),
          ),
        )
    )[0];
    const unread = await c.tx
      .select({
        id: messages.id,
        cursor: messages.cursor,
        body: sql<string>`left(${messages.body},500)`,
      })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversation.id),
          gt(messages.cursor, read?.cursor ?? 0),
          filter.mentionsOnly
            ? sql`${messages.mentionUserIds} @> ${JSON.stringify([c.actor.userId])}::jsonb`
            : undefined,
        ),
      )
      .orderBy(messages.cursor)
      .limit(100 - items.reduce((sum, item) => sum + item.unread.length, 0));
    if (unread.length)
      items.push({
        conversationId: conversation.id,
        title: conversation.title,
        unread,
      });
    if (items.reduce((sum, item) => sum + item.unread.length, 0) === 100)
      return {
        items,
        next:
          conversation.id === page.items.at(-1)?.id
            ? page.next
            : conversation.id,
      };
  }
  return { items, next: page.next };
}
/** Explicit message selection never expands replies, authors, links or Session context. */
export async function previewConversation(
  c: Context,
  id: string,
  messageIds: string[],
) {
  requireHuman(c);
  const conversation = await getConversation(c, id, true);
  if (
    !messageIds.length ||
    messageIds.length > 50 ||
    new Set(messageIds).size !== messageIds.length
  )
    throw new DomainError("invalid");
  const rows = await c.tx
    .select({ id: messages.id, body: messages.body })
    .from(messages)
    .where(
      and(eq(messages.conversationId, id), inArray(messages.id, messageIds)),
    )
    .orderBy(messages.cursor);
  if (rows.length !== messageIds.length) throw new DomainError("not_found");
  if (
    rows.reduce((sum, m) => sum + new TextEncoder().encode(m.body).length, 0) >
    500000
  )
    throw new DomainError("invalid", "Share exceeds byte limit");
  return {
    title: conversation.title,
    messages: rows.map((m) => ({ body: m.body })),
  };
}

export async function getMessage(
  c: Context,
  conversationId: string,
  id: string,
) {
  await getConversation(c, conversationId);
  return required(
    (
      await c.tx
        .select()
        .from(messages)
        .where(
          and(eq(messages.id, id), eq(messages.conversationId, conversationId)),
        )
    )[0],
  );
}
export async function updateParticipant(
  c: Context,
  id: string,
  participantId: string,
  role: "viewer" | "contributor",
) {
  requireHuman(c);
  await getConversation(c, id, true);
  const participant = required(
    (
      await c.tx
        .select()
        .from(participants)
        .where(
          and(
            eq(participants.id, participantId),
            eq(participants.conversationId, id),
          ),
        )
    )[0],
  );
  if (participant.userId === c.actor.userId && role === "viewer")
    throw new DomainError("conflict");
  if (participant.userId)
    await requireMember(c, participant.userId, role === "contributor");
  await c.tx
    .update(participants)
    .set({ role })
    .where(eq(participants.id, participantId));
  await advanceCursor(c);
}
