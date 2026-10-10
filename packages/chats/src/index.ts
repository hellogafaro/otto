import { createHash } from "node:crypto";
import { getAgent } from "@otto/agents";
import {
  authorizedPage,
  type Database,
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
import { getSessionContext } from "@otto/sessions";
import {
  type NativeSessionStorage,
  readNativeMessages,
  saveNativeMessage,
} from "@otto/sessions/native";
import { DomainError, type PageOptions, required } from "@otto/shared";
import { parseMentions } from "@otto/shared/mentions";

import {
  type Actor,
  advanceCursor,
  type Context,
  getWorkspaceAudience,
  inWorkspace,
  requireHuman,
  requireMember,
  requireWriter,
} from "@otto/workspaces";
import {
  type AnyColumn,
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  lte,
  sql,
} from "drizzle-orm";
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
/**
 * A File attached to a Message is readable by the participants of that Chat for as long as they can read it:
 * access follows the Chat's audience, never the File's own visibility, and ends with membership.
 */
export async function isAttachedToReadableChat(
  c: Context,
  fileId: string,
  source?: { chatId: string; messageId: string },
) {
  const rows = await c.tx
    .select({ chatId: messages.chatId })
    .from(messages)
    .where(
      and(
        eq(messages.workspaceId, c.workspaceId),
        eq(messages.status, "published"),
        source ? eq(messages.chatId, source.chatId) : undefined,
        source ? eq(messages.id, source.messageId) : undefined,
        sql`${messages.fileIds} @> ${JSON.stringify([fileId])}::jsonb`,
      ),
    )
    .groupBy(messages.chatId)
    .limit(20);
  for (const row of rows)
    try {
      await getChat(c, row.chatId);
      return true;
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== "forbidden")
        throw error;
    }
  return false;
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
export interface MessageInput {
  body: string;
  requestId: string;
  replyTo?: string;
  mentionUserIds?: string[];
  fileIds?: string[];
}

type MessageIndex = typeof messages.$inferSelect;

export async function reserveMessage(
  c: Context,
  chatId: string,
  input: MessageInput,
  reference?: {
    nativeMessageId: string;
    nativeThreadId: string;
    nativePartIndexes: number[];
  },
) {
  await getChat(c, chatId, true);
  if (!input.body.length || Buffer.byteLength(input.body) > 100000)
    throw new DomainError("invalid", "Message exceeds byte limit");
  const mentions = input.mentionUserIds ?? [];
  if ((input.fileIds?.length ?? 0) > 30) throw new DomainError("invalid");
  if (mentions.length > 50 || new Set(mentions).size !== mentions.length)
    throw new DomainError("invalid");
  if (mentions.length) {
    const audience = await getChatAudience(c, chatId);
    if (mentions.some((id) => !audience.humans.includes(id)))
      throw new DomainError("forbidden");
  }
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        body: input.body,
        replyTo: input.replyTo ?? null,
        mentions: [...mentions].sort(),
        files: input.fileIds ?? [],
        reference: reference
          ? {
              nativeMessageId: reference.nativeMessageId,
              nativeThreadId: reference.nativeThreadId,
              nativePartIndexes: reference.nativePartIndexes,
            }
          : null,
      }),
    )
    .digest("hex");
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
      existing.requestHash !== requestHash ||
      existing.replyTo !== (input.replyTo ?? null) ||
      JSON.stringify([...existing.mentionUserIds].sort()) !==
        JSON.stringify([...mentions].sort()) ||
      JSON.stringify(existing.fileIds) !== JSON.stringify(input.fileIds ?? [])
    )
      throw new DomainError("conflict");
    return existing;
  }
  const replied = input.replyTo
    ? required(
        (
          await c.tx
            .select({ authorAgentId: messages.authorAgentId })
            .from(messages)
            .where(
              and(
                eq(messages.id, input.replyTo),
                eq(messages.chatId, chatId),
                eq(messages.status, "published"),
              ),
            )
        )[0],
      )
    : null;
  let replyAgentIds: string[] = [];
  if (!c.actor.agentId) {
    const mentioned = [
      ...new Set(
        parseMentions(input.body)
          .filter((mention) => mention.type === "agent")
          .map((mention) => mention.id),
      ),
    ];
    if (mentioned.length) {
      if (mentioned.length > 100) throw new DomainError("invalid");
      const contributors = await c.tx
        .select({ agentId: participants.agentId })
        .from(participants)
        .where(
          and(
            eq(participants.chatId, chatId),
            eq(participants.role, "contributor"),
            inArray(sql`${participants.agentId}::text`, mentioned),
          ),
        )
        .limit(101);
      if (
        mentioned.some(
          (agentId) => !contributors.some((p) => p.agentId === agentId),
        )
      )
        throw new DomainError(
          "invalid",
          "Mentioned Agent must be a contributing Chat participant",
        );
      replyAgentIds = mentioned;
    } else if (replied?.authorAgentId) {
      const contributors = await c.tx
        .select({ agentId: participants.agentId })
        .from(participants)
        .where(
          and(
            eq(participants.chatId, chatId),
            eq(participants.role, "contributor"),
            eq(participants.agentId, replied.authorAgentId),
          ),
        );
      if (contributors.length) replyAgentIds = [replied.authorAgentId];
    } else {
      try {
        const audience = await getChatAudience(c, chatId);
        if (audience.humans.length === 1 && audience.agents.length === 1)
          replyAgentIds = audience.agents;
      } catch (error) {
        if (!(error instanceof DomainError) || error.code !== "unavailable")
          throw error;
      }
    }
  }
  return required(
    (
      await c.tx
        .insert(messages)
        .values({
          requestId: input.requestId,
          replyTo: input.replyTo,
          mentionUserIds: mentions,
          replyAgentIds,
          fileIds: input.fileIds ?? [],
          nativeMessageId: reference?.nativeMessageId ?? crypto.randomUUID(),
          nativeThreadId: reference?.nativeThreadId ?? chatId,
          nativePartIndexes: reference?.nativePartIndexes ?? [0],
          requestHash,
          status: "reserved",
          workspaceId: c.workspaceId,
          chatId,
          authorUserId: c.actor.agentId ? null : c.actor.userId,
          authorAgentId: c.actor.agentId,
          cursor: 0,
        })
        .returning()
    )[0],
  );
}

export async function publishMessage(c: Context, chatId: string, id: string) {
  await getChat(c, chatId, true);
  const row = required(
    (
      await c.tx
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.id, id),
            eq(messages.chatId, chatId),
            eq(messages.workspaceId, c.workspaceId),
          ),
        )
    )[0],
  );
  if (
    row.authorUserId !== (c.actor.agentId ? null : c.actor.userId) ||
    row.authorAgentId !== (c.actor.agentId ?? null)
  )
    throw new DomainError("forbidden");
  if (row.status === "published") return row;
  if (row.mentionUserIds.length) {
    const audience = await getChatAudience(c, chatId);
    if (row.mentionUserIds.some((id) => !audience.humans.includes(id)))
      throw new DomainError("forbidden");
  }
  return required(
    (
      await c.tx
        .update(messages)
        .set({ status: "published", cursor: await advanceCursor(c) })
        .where(eq(messages.id, id))
        .returning()
    )[0],
  );
}

export async function createMessage(
  db: Database,
  native: NativeSessionStorage,
  workspaceId: string,
  actor: Actor,
  chatId: string,
  input: MessageInput,
  authorize?: (c: Context) => Promise<void>,
) {
  const row = await inWorkspace(db, workspaceId, actor, async (c) => {
    await authorize?.(c);
    return reserveMessage(c, chatId, input);
  });
  await saveNativeMessage(native, {
    workspaceId,
    threadId: row.nativeThreadId,
    messageId: row.nativeMessageId,
    role: actor.agentId ? "assistant" : "user",
    body: input.body,
    createdAt: row.createdAt,
  });
  const projected = await projectMessage(native, row);
  return inWorkspace(db, workspaceId, actor, async (c) => {
    await authorize?.(c);
    const published = await publishMessage(c, chatId, row.id);
    return { ...projected, cursor: published.cursor };
  });
}

export async function getMessageReplyAgentIds(
  c: Context,
  chatId: string,
  id: string,
) {
  requireHuman(c);
  await getChat(c, chatId, true);
  const row = required(
    (
      await c.tx
        .select({
          authorUserId: messages.authorUserId,
          replyAgentIds: messages.replyAgentIds,
        })
        .from(messages)
        .where(
          and(
            eq(messages.id, id),
            eq(messages.chatId, chatId),
            eq(messages.workspaceId, c.workspaceId),
            eq(messages.status, "published"),
          ),
        )
    )[0],
  );
  if (row.authorUserId !== c.actor.userId) throw new DomainError("forbidden");
  return row.replyAgentIds;
}

async function projectMessage(native: NativeSessionStorage, row: MessageIndex) {
  const source = required(
    (
      await readNativeMessages(native, {
        workspaceId: row.workspaceId,
        threadId: row.nativeThreadId,
        messageIds: [row.nativeMessageId],
      })
    )[0],
  );
  const text = row.nativePartIndexes
    .map((index) => {
      const part = source.content.parts[index];
      if (part?.type !== "text")
        throw new DomainError(
          "forbidden",
          "Only explicitly published text is readable",
        );
      return part.text;
    })
    .join("");
  if (Buffer.byteLength(text) > 100000) throw new DomainError("unavailable");
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        body: text,
        replyTo: row.replyTo,
        mentions: [...row.mentionUserIds].sort(),
        files: row.fileIds,
        reference:
          row.nativeThreadId === row.chatId
            ? null
            : {
                nativeMessageId: row.nativeMessageId,
                nativeThreadId: row.nativeThreadId,
                nativePartIndexes: row.nativePartIndexes,
              },
      }),
    )
    .digest("hex");
  if (hash !== row.requestHash)
    throw new DomainError("conflict", "Published native message changed");
  const {
    nativeThreadId: _thread,
    nativeMessageId: _message,
    nativePartIndexes: _parts,
    requestHash: _hash,
    status: _status,
    replyAgentIds: _replies,
    ...metadata
  } = row;
  return { ...metadata, body: text };
}

export async function publishNativeMessage(
  db: Database,
  native: NativeSessionStorage,
  workspaceId: string,
  actor: Actor,
  chatId: string,
  input: {
    requestId: string;
    sessionId: string;
    nativeMessageId: string;
    partIndexes: number[];
  },
  authorize: (c: Context) => Promise<void>,
) {
  if (
    !actor.agentId ||
    !input.partIndexes.length ||
    input.partIndexes.length > 100 ||
    input.partIndexes.some(
      (index) => !Number.isSafeInteger(index) || index < 0,
    ) ||
    new Set(input.partIndexes).size !== input.partIndexes.length
  )
    throw new DomainError("invalid");
  const check = async (c: Context) => {
    await authorize(c);
    await getChat(c, chatId, true);
    const session = await getSessionContext(c, input.sessionId);
    if (
      session.ownerId !== actor.userId ||
      session.chatId !== chatId ||
      session.agentId !== actor.agentId
    )
      throw new DomainError("forbidden");
  };
  await inWorkspace(db, workspaceId, actor, check);
  const source = required(
    (
      await readNativeMessages(native, {
        workspaceId,
        threadId: input.sessionId,
        messageIds: [input.nativeMessageId],
      })
    )[0],
  );
  if (source.role !== "assistant") throw new DomainError("forbidden");
  const body = input.partIndexes
    .map((index) => {
      const part = source.content.parts[index];
      if (part?.type !== "text") throw new DomainError("forbidden");
      return part.text;
    })
    .join("");
  return inWorkspace(db, workspaceId, actor, async (c) => {
    await check(c);
    const row = await reserveMessage(
      c,
      chatId,
      { requestId: input.requestId, body },
      {
        nativeThreadId: input.sessionId,
        nativeMessageId: input.nativeMessageId,
        nativePartIndexes: input.partIndexes,
      },
    );
    const published = await publishMessage(c, chatId, row.id);
    const {
      nativeThreadId: _thread,
      nativeMessageId: _message,
      nativePartIndexes: _parts,
      requestHash: _hash,
      status: _status,
      replyAgentIds: _replies,
      ...metadata
    } = published;
    return { ...metadata, body };
  });
}
/** Workspace row locking makes this cursor commit ordered, unlike a bare sequence or timestamp. */
export async function getMessages(
  c: Context,
  chatId: string,
  after = 0,
  native: NativeSessionStorage,
) {
  await getChat(c, chatId);
  const rows = await c.tx
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.chatId, chatId),
        eq(messages.status, "published"),
        gt(messages.cursor, after),
      ),
    )
    .orderBy(asc(messages.cursor))
    .limit(100);
  return Promise.all(rows.map((row) => projectMessage(native, row)));
}

export async function getChatContext(
  c: Context,
  chatId: string,
  throughCursor: number,
  native: NativeSessionStorage,
) {
  await getChat(c, chatId);
  if (!Number.isSafeInteger(throughCursor) || throughCursor < 0)
    throw new DomainError("invalid");
  const rows = await c.tx
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.chatId, chatId),
        eq(messages.status, "published"),
        lte(messages.cursor, throughCursor),
      ),
    )
    .orderBy(desc(messages.cursor))
    .limit(50);
  const context: Array<
    Pick<MessageIndex, "id" | "authorUserId" | "authorAgentId" | "cursor"> & {
      body: string;
    }
  > = [];
  let bytes = 0;
  for (const row of rows) {
    const message = await projectMessage(native, row);
    bytes += Buffer.byteLength(message.body);
    if (bytes > 100000) break;
    context.push({
      id: message.id,
      body: message.body,
      authorUserId: message.authorUserId,
      authorAgentId: message.authorAgentId,
      cursor: message.cursor,
    });
  }
  return context.reverse();
}

export async function getChatSessionMessageIds(
  c: Context,
  chatId: string,
  sessionId: string,
  messageIds: string[],
) {
  await getChat(c, chatId);
  const session = await getSessionContext(c, sessionId);
  if (
    session.ownerId !== c.actor.userId ||
    session.chatId !== chatId ||
    (c.actor.agentId !== undefined && session.agentId !== c.actor.agentId)
  )
    throw new DomainError("forbidden");
  if (messageIds.length > 50) throw new DomainError("invalid");
  if (!messageIds.length) return [];
  const rows = await c.tx
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.workspaceId, c.workspaceId),
        eq(messages.chatId, chatId),
        eq(messages.status, "published"),
        eq(messages.nativeThreadId, sessionId),
        inArray(messages.id, messageIds),
      ),
    )
    .limit(50);
  return rows.map((row) => row.id);
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
  native: NativeSessionStorage,
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
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.chatId, chat.id),
          eq(messages.status, "published"),
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
        unread: await Promise.all(
          unread.map(async (row) => ({
            id: row.id,
            cursor: row.cursor,
            body: (await projectMessage(native, row)).body.slice(0, 500),
          })),
        ),
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
  native: NativeSessionStorage,
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
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.chatId, id),
        eq(messages.status, "published"),
        inArray(messages.id, messageIds),
      ),
    )
    .orderBy(messages.cursor);
  if (rows.length !== messageIds.length) throw new DomainError("not_found");
  const projected = await Promise.all(
    rows.map((row) => projectMessage(native, row)),
  );
  if (
    projected.reduce(
      (sum, m) => sum + new TextEncoder().encode(m.body).length,
      0,
    ) > 500000
  )
    throw new DomainError("invalid", "Share exceeds byte limit");
  return {
    title: chat.title,
    messages: projected.map((m) => ({ body: m.body })),
  };
}

export async function getMessage(
  c: Context,
  chatId: string,
  id: string,
  native: NativeSessionStorage,
) {
  await getChat(c, chatId);
  const row = required(
    (
      await c.tx
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.id, id),
            eq(messages.chatId, chatId),
            eq(messages.status, "published"),
          ),
        )
    )[0],
  );
  return projectMessage(native, row);
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
