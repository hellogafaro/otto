import { getAgent } from "@otto/agents";
import {
  authorizedPage,
  matchesText,
  pageOf,
  sortNames,
  sortPlan,
  textKey,
  timeKey,
} from "@otto/db";
import {
  getProject,
  getProjectAudience,
  projectReadable,
} from "@otto/projects";
import { DomainError, type PageOptions, required } from "@otto/shared";

import {
  advanceCursor,
  type Context,
  getWorkspaceAudience,
  requireHuman,
  requireMember,
  requireWriter,
} from "@otto/workspaces";
import { type AnyColumn, and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { chatReads, chats, messages, participants } from "./schema";
export async function createChat(
  c: Context,
  input: {
    title: string;
    projectId?: string;
    visibility: "workspace" | "participants";
  },
) {
  requireHuman(c);
  requireWriter(c);
  if (input.projectId) await getProject(c, input.projectId, true);
  const chat = required(
    (
      await c.tx
        .insert(chats)
        .values({
          ...input,
          workspaceId: c.workspaceId,
          createdBy: c.actor.userId,
        })
        .returning()
    )[0],
  );
  await c.tx.insert(participants).values({
    chatId: chat.id,
    userId: c.actor.userId,
    role: "contributor",
  });
  await advanceCursor(c);
  return chat;
}
const readableChat = alias(chats, "readable_chat");
/** `participant` is the actor's human identity (the sponsor, for an Agent) or the acting Agent. */
const chatCondition = (
  c: Context,
  chatId: AnyColumn,
  participant: "human" | "agent",
) => {
  const member = (column: AnyColumn, value: string) =>
    sql`exists (select 1 from ${participants} where ${participants.chatId} = ${readableChat.id} and ${column} = ${value})`;
  return sql`exists (select 1 from ${chats} "readable_chat" where ${readableChat.id} = ${chatId} and ${readableChat.workspaceId} = ${c.workspaceId} and ${projectReadable(c, readableChat.projectId)} and ${
    participant === "agent"
      ? member(participants.agentId, String(c.actor.agentId))
      : sql`(${readableChat.visibility} = 'workspace' or ${member(participants.userId, c.actor.userId)})`
  })`;
};
/**
 * SQL form of `getChat` read access: the Project, and a participant row for participant-only Chats; an Agent actor
 * is always a participant. Narrowing only; `getChat` stays the authority.
 */
export const chatReadable = (c: Context, chatId: AnyColumn) =>
  chatCondition(c, chatId, c.actor.agentId ? "agent" : "human");
/** The actor's human identity (an Agent's sponsor) is in the current human Chat audience. */
export const chatHasSponsor = (c: Context, chatId: AnyColumn) =>
  chatCondition(c, chatId, "human");
export async function getChat(c: Context, id: string, write = false) {
  const chat = required(
    (
      await c.tx
        .select()
        .from(chats)
        .where(and(eq(chats.id, id), eq(chats.workspaceId, c.workspaceId)))
    )[0],
  );
  if (chat.projectId) await getProject(c, chat.projectId, write);
  if (write) requireWriter(c);
  const participant = (
    await c.tx
      .select()
      .from(participants)
      .where(
        and(
          eq(participants.chatId, id),
          c.actor.agentId
            ? eq(participants.agentId, c.actor.agentId)
            : eq(participants.userId, c.actor.userId),
        ),
      )
  )[0];
  if (chat.visibility === "participants" || c.actor.agentId)
    required(participant, "forbidden");
  if (write && participant?.role === "viewer")
    throw new DomainError("forbidden");
  return chat;
}
/** Management belongs to the human creator; discussion/control uses the participant writer gate. */
async function getManagedChat(c: Context, id: string) {
  requireHuman(c);
  const chat = await getChat(c, id, true);
  if (chat.createdBy !== c.actor.userId) throw new DomainError("forbidden");
  return chat;
}
export async function createParticipant(
  c: Context,
  chatId: string,
  input: { userId?: string; agentId?: string; role: "contributor" | "viewer" },
) {
  const chat = await getManagedChat(c, chatId);
  if (Boolean(input.userId) === Boolean(input.agentId))
    throw new DomainError("invalid");
  if (input.userId) await requireMember(c, input.userId);
  if (input.agentId) {
    const agent = await getAgent(c, input.agentId);
    if (agent.projectId && agent.projectId !== chat.projectId)
      throw new DomainError("forbidden");
  }
  if (
    (
      await c.tx
        .select({ id: participants.id })
        .from(participants)
        .where(eq(participants.chatId, chatId))
        .limit(100)
    ).length >= 100
  )
    throw new DomainError("conflict", "Participant limit");
  await c.tx
    .insert(participants)
    .values({ ...input, chatId })
    .onConflictDoNothing();
  await advanceCursor(c);
}
export async function deleteParticipant(
  c: Context,
  chatId: string,
  participantId: string,
) {
  await getManagedChat(c, chatId);
  await c.tx
    .delete(participants)
    .where(
      and(eq(participants.id, participantId), eq(participants.chatId, chatId)),
    );
  await advanceCursor(c);
}
export async function getChatAudience(c: Context, id: string) {
  const chat = await getChat(c, id);
  const humans = chat.projectId
    ? await getProjectAudience(c, chat.projectId)
    : await getWorkspaceAudience(c);
  const explicit = await c.tx
    .select()
    .from(participants)
    .where(eq(participants.chatId, id))
    .limit(101);
  if (explicit.length > 100) throw new DomainError("unavailable");
  return {
    humans:
      chat.visibility === "workspace"
        ? humans
        : explicit.flatMap((p) =>
            p.userId && humans.includes(p.userId) ? [p.userId] : [],
          ),
    agents: explicit.flatMap((p) => (p.agentId ? [p.agentId] : [])).sort(),
  };
}
export async function createMessage(
  c: Context,
  chatId: string,
  input: {
    body: string;
    requestId: string;
    replyTo?: string;
    mentionUserIds?: string[];
    fileIds?: string[];
  },
) {
  await getChat(c, chatId, true);
  const mentions = input.mentionUserIds ?? [];
  if ((input.fileIds?.length ?? 0) > 30) throw new DomainError("invalid");
  if (mentions.length > 50 || new Set(mentions).size !== mentions.length)
    throw new DomainError("invalid");
  if (mentions.length) {
    const audience = await getChatAudience(c, chatId);
    if (mentions.some((id) => !audience.humans.includes(id)))
      throw new DomainError("forbidden");
  }
  const existing = (
    await c.tx
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.chatId, chatId),
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
      JSON.stringify(existing.fileIds) !== JSON.stringify(input.fileIds ?? [])
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
            and(eq(messages.id, input.replyTo), eq(messages.chatId, chatId)),
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
          chatId,
          authorUserId: c.actor.agentId ? null : c.actor.userId,
          authorAgentId: c.actor.agentId,
          cursor,
        })
        .returning()
    )[0],
  );
}
/** Workspace row locking makes this cursor commit ordered, unlike a bare sequence or timestamp. */
export async function getMessages(c: Context, chatId: string, after = 0) {
  await getChat(c, chatId);
  return c.tx
    .select()
    .from(messages)
    .where(and(eq(messages.chatId, chatId), gt(messages.cursor, after)))
    .orderBy(asc(messages.cursor))
    .limit(100);
}

const chatSorts = {
  title: textKey(chats.title),
  createdAt: timeKey(chats.createdAt),
  updatedAt: timeKey(chats.updatedAt),
};
export const CHAT_SORTS = sortNames(chatSorts);
/** `updatedAt` records Chat metadata edits and archiving, not the latest Message. */
export async function getChats(
  c: Context,
  filter: PageOptions & {
    sort?: string;
    order?: string;
    projectId?: string;
    visibility?: "workspace" | "participants";
    createdBy?: string;
    archived?: boolean;
    query?: string;
  },
) {
  const f = { ...filter, archived: filter.archived ?? false };
  const plan = sortPlan({
    operation: "getChats",
    scope: c,
    filter: f,
    keys: chatSorts,
    id: chats.id,
  });
  const rows = await c.tx
    .select({ id: chats.id, position: plan.position })
    .from(chats)
    .where(
      and(
        eq(chats.workspaceId, c.workspaceId),
        eq(chats.archived, f.archived),
        f.projectId ? eq(chats.projectId, f.projectId) : undefined,
        f.visibility ? eq(chats.visibility, f.visibility) : undefined,
        f.createdBy ? eq(chats.createdBy, f.createdBy) : undefined,
        chatReadable(c, chats.id),
        f.query ? matchesText(chats.title, f.query) : undefined,
        plan.where,
      ),
    )
    .orderBy(...plan.orderBy)
    .limit(plan.limit + 1);
  return authorizedPage(
    pageOf(rows, plan, (row) => row.id),
    async (row) => {
      return getChat(c, row.id);
    },
    plan,
  );
}
export async function updateChat(
  c: Context,
  id: string,
  input: { title: string },
) {
  await getManagedChat(c, id);
  const updated = required(
    (
      await c.tx
        .update(chats)
        .set({ title: input.title })
        .where(eq(chats.id, id))
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return updated;
}
export async function archiveChat(c: Context, id: string, archived: boolean) {
  await getManagedChat(c, id);
  const updated = required(
    (
      await c.tx
        .update(chats)
        .set({ archived })
        .where(eq(chats.id, id))
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return updated;
}
const participantType = sql`case when ${participants.agentId} is null then 'human' else 'agent' end`;
const participantSorts = {
  role: textKey(participants.role),
  type: textKey(participantType),
};
export const PARTICIPANT_SORTS = sortNames(participantSorts);
export async function getParticipants(
  c: Context,
  id: string,
  options: PageOptions & {
    sort?: string;
    order?: string;
    role?: "contributor" | "viewer";
    type?: "human" | "agent";
  } = {},
) {
  await getChat(c, id);
  const plan = sortPlan({
    operation: `getParticipants:${id}`,
    scope: c,
    filter: options,
    keys: participantSorts,
    id: participants.id,
  });
  const rows = await c.tx
    .select({
      id: participants.id,
      chatId: participants.chatId,
      userId: participants.userId,
      agentId: participants.agentId,
      role: participants.role,
      position: plan.position,
    })
    .from(participants)
    .where(
      and(
        eq(participants.chatId, id),
        options.role ? eq(participants.role, options.role) : undefined,
        options.type ? sql`${participantType} = ${options.type}` : undefined,
        plan.where,
      ),
    )
    .orderBy(...plan.orderBy)
    .limit(plan.limit + 1);
  return pageOf(rows, plan, (row) => row.id);
}
export async function markChatRead(c: Context, id: string, cursor: number) {
  requireHuman(c);
  await getChat(c, id);
  if (!Number.isSafeInteger(cursor) || cursor < 0)
    throw new DomainError("invalid");
  if (cursor > 0)
    required(
      (
        await c.tx
          .select({ id: messages.id })
          .from(messages)
          .where(and(eq(messages.chatId, id), eq(messages.cursor, cursor)))
      )[0],
      "invalid",
    );
  await c.tx
    .insert(chatReads)
    .values({ chatId: id, userId: c.actor.userId, cursor })
    .onConflictDoUpdate({
      target: [chatReads.chatId, chatReads.userId],
      set: {
        cursor: sql`greatest(${chatReads.cursor},${cursor})`,
      },
    });
  await advanceCursor(c);
}
/** Attention is a permission-filtered view of saved messages and read cursors, not a notification queue. */
export async function getChatAttention(
  c: Context,
  filter: { after?: string; limit?: number; mentionsOnly?: boolean },
) {
  requireHuman(c);
  const page = await getChats(c, filter);
  const items = [];
  for (const chat of page.items) {
    const read = (
      await c.tx
        .select()
        .from(chatReads)
        .where(
          and(
            eq(chatReads.chatId, chat.id),
            eq(chatReads.userId, c.actor.userId),
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
          eq(messages.chatId, chat.id),
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
        chatId: chat.id,
        title: chat.title,
        unread,
      });
    if (items.reduce((sum, item) => sum + item.unread.length, 0) === 100)
      return {
        items,
        next: chat.id === page.items.at(-1)?.id ? page.next : chat.id,
      };
  }
  return { items, next: page.next };
}
/** Explicit message selection never expands replies, authors, links or Session context. */
export async function previewChat(
  c: Context,
  id: string,
  messageIds: string[],
) {
  requireHuman(c);
  const chat = await getChat(c, id, true);
  if (
    !messageIds.length ||
    messageIds.length > 50 ||
    new Set(messageIds).size !== messageIds.length
  )
    throw new DomainError("invalid");
  const rows = await c.tx
    .select({ id: messages.id, body: messages.body })
    .from(messages)
    .where(and(eq(messages.chatId, id), inArray(messages.id, messageIds)))
    .orderBy(messages.cursor);
  if (rows.length !== messageIds.length) throw new DomainError("not_found");
  if (
    rows.reduce((sum, m) => sum + new TextEncoder().encode(m.body).length, 0) >
    500000
  )
    throw new DomainError("invalid", "Share exceeds byte limit");
  return {
    title: chat.title,
    messages: rows.map((m) => ({ body: m.body })),
  };
}

export async function getMessage(c: Context, chatId: string, id: string) {
  await getChat(c, chatId);
  return required(
    (
      await c.tx
        .select()
        .from(messages)
        .where(and(eq(messages.id, id), eq(messages.chatId, chatId)))
    )[0],
  );
}
export async function updateParticipant(
  c: Context,
  id: string,
  participantId: string,
  role: "viewer" | "contributor",
) {
  await getManagedChat(c, id);
  const participant = required(
    (
      await c.tx
        .select()
        .from(participants)
        .where(
          and(eq(participants.id, participantId), eq(participants.chatId, id)),
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
