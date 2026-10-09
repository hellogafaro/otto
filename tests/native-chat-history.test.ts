import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgent } from "../packages/agents/src";
import {
  createChat,
  createMessage,
  createParticipant,
  getChatContext,
  getChatSessionMessageIds,
  getMessages,
  publishNativeMessage,
  reserveMessage,
} from "../packages/chats/src";
import { messages } from "../packages/chats/src/schema";
import { createEnvironment } from "../packages/environments/src";
import { createSession } from "../packages/sessions/src";
import {
  openNativeStorage,
  saveNativeMessage,
} from "../packages/sessions/src/native";
import { sessions } from "../packages/sessions/src/schema";
import { inWorkspace } from "../packages/workspaces/src";
import { members, users, workspaces } from "../packages/workspaces/src/schema";
import { startPostgres } from "./postgres";

describe("native Chat publication on private PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let native: Awaited<ReturnType<typeof openNativeStorage>>;
  const workspaceId = crypto.randomUUID();
  const actor = { userId: crypto.randomUUID() };
  const other = { userId: crypto.randomUUID() };
  let chatId: string;
  beforeAll(async () => {
    database = await startPostgres();
    native = await openNativeStorage({
      connectionString: `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`,
    });
    await database.db
      .insert(workspaces)
      .values({ id: workspaceId, title: "Native history fixture" });
    await database.db.insert(users).values(
      [actor, other].map(({ userId }) => ({
        id: userId,
        name: "Fictional human",
        email: `${userId}@example.test`,
        emailVerified: true,
      })),
    );
    await database.db.insert(members).values(
      [actor, other].map(({ userId }) => ({
        workspaceId,
        userId,
        role: "contributor" as const,
      })),
    );
    chatId = (
      await inWorkspace(database.db, workspaceId, actor, (c) =>
        createChat(c, {
          title: "Private native discussion",
          visibility: "participants",
        }),
      )
    ).id;
  });
  afterAll(async () => {
    await native?.close();
    await database?.stop();
  });

  it("stores one native body with metadata-only stable concurrent publication", async () => {
    const input = {
      requestId: crypto.randomUUID(),
      body: "One authoritative body",
    };
    const [first, second] = await Promise.all([
      createMessage(database.db, native, workspaceId, actor, chatId, input),
      createMessage(database.db, native, workspaceId, actor, chatId, input),
    ]);
    expect(second.id).toBe(first.id);
    expect(second.cursor).toBe(first.cursor);
    expect(first).not.toHaveProperty("nativeThreadId");
    const rows = await database.db
      .select()
      .from(messages)
      .where(eq(messages.requestId, input.requestId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("body");
    expect(rows[0]?.status).toBe("published");
    await expect(
      createMessage(database.db, native, workspaceId, actor, chatId, {
        ...input,
        body: "Changed content",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    const read = await inWorkspace(database.db, workspaceId, actor, (c) =>
      getMessages(c, chatId, 0, native),
    );
    expect(read.find((row) => row.id === first.id)?.body).toBe(input.body);
  });

  it("hides reserved and saved-but-unpublished native content", async () => {
    const input = { requestId: crypto.randomUUID(), body: "Unpublished" };
    const row = await inWorkspace(database.db, workspaceId, actor, (c) =>
      reserveMessage(c, chatId, input),
    );
    await saveNativeMessage(native, {
      workspaceId,
      threadId: row.nativeThreadId,
      messageId: row.nativeMessageId,
      role: "user",
      body: input.body,
      createdAt: row.createdAt,
    });
    const read = await inWorkspace(database.db, workspaceId, actor, (c) =>
      getMessages(c, chatId, 0, native),
    );
    expect(read.some((item) => item.id === row.id)).toBe(false);
    expect(row.cursor).toBe(0);
    const recovered = await createMessage(
      database.db,
      native,
      workspaceId,
      actor,
      chatId,
      input,
    );
    expect(recovered.id).toBe(row.id);
    expect(recovered.cursor).toBeGreaterThan(0);
  });

  it("reauthorizes publication after native persistence and denies viewer writes", async () => {
    let checks = 0;
    const input = {
      requestId: crypto.randomUUID(),
      body: "Withheld after revocation",
    };
    await expect(
      createMessage(
        database.db,
        native,
        workspaceId,
        actor,
        chatId,
        input,
        async () => {
          if (++checks === 2)
            throw Object.assign(new Error("revoked"), { code: "forbidden" });
        },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    const [row] = await database.db
      .select()
      .from(messages)
      .where(eq(messages.requestId, input.requestId));
    expect(row?.status).toBe("reserved");
    await expect(
      inWorkspace(database.db, workspaceId, other, (c) =>
        getMessages(c, chatId, 0, native),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await inWorkspace(database.db, workspaceId, actor, (c) =>
      createParticipant(c, chatId, { userId: other.userId, role: "viewer" }),
    );
    await expect(
      createMessage(database.db, native, workspaceId, other, chatId, {
        requestId: crypto.randomUUID(),
        body: "Viewer cannot write",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    const read = await inWorkspace(database.db, workspaceId, other, (c) =>
      getMessages(c, chatId, 0, native),
    );
    expect(read.some((item) => item.id === row?.id)).toBe(false);
  });

  it("keeps two sponsors' native Sessions private for the same Agent and shared Chat before and after native reads", async () => {
    const fixture = await inWorkspace(
      database.db,
      workspaceId,
      actor,
      async (c) => {
        const agent = await createAgent(c, {
          title: "Shared Agent",
          instructions: "Fixture",
          model: "fixture",
          visibility: "workspace",
        });
        const environment = await createEnvironment(c, agent.id);
        const chat = await createChat(c, {
          title: "Shared output",
          visibility: "workspace",
        });
        await createParticipant(c, chat.id, {
          agentId: agent.id,
          role: "contributor",
        });
        const binding = {
          chatId: chat.id,
          agentId: agent.id,
          environmentId: environment.id,
          environmentGeneration: environment.generation,
          scope: "shared fixture",
          provider: "fixture",
          model: "fixture",
          accountId: "fixture",
          subscriptionId: null,
        };
        return {
          agent,
          chat,
          binding,
          session: await createSession(c, binding),
        };
      },
    );
    const otherSession = await inWorkspace(
      database.db,
      workspaceId,
      other,
      (c) => createSession(c, fixture.binding),
    );
    const privateId = crypto.randomUUID();
    const otherId = crypto.randomUUID();
    for (const [sessionId, messageId, body] of [
      [fixture.session.id, privateId, "First sponsor private context"],
      [otherSession.id, otherId, "Second sponsor response"],
    ] as const) {
      await saveNativeMessage(native, {
        workspaceId,
        threadId: sessionId,
        messageId,
        role: "assistant",
        body,
        createdAt: new Date(),
      });
    }
    const rejected = crypto.randomUUID();
    await expect(
      publishNativeMessage(
        database.db,
        native,
        workspaceId,
        { ...other, agentId: fixture.agent.id },
        fixture.chat.id,
        {
          requestId: rejected,
          sessionId: fixture.session.id,
          nativeMessageId: privateId,
          partIndexes: [0],
        },
        async () => {},
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      await database.db
        .select()
        .from(messages)
        .where(eq(messages.requestId, rejected)),
    ).toHaveLength(0);
    const allowed = await publishNativeMessage(
      database.db,
      native,
      workspaceId,
      { ...other, agentId: fixture.agent.id },
      fixture.chat.id,
      {
        requestId: crypto.randomUUID(),
        sessionId: otherSession.id,
        nativeMessageId: otherId,
        partIndexes: [0],
      },
      async () => {},
    );
    expect(allowed.body).toBe("Second sponsor response");
    const humanReply = await createMessage(
      database.db,
      native,
      workspaceId,
      actor,
      fixture.chat.id,
      {
        requestId: crypto.randomUUID(),
        body: "Public human reply",
      },
    );
    expect(
      await inWorkspace(database.db, workspaceId, other, (c) =>
        getChatSessionMessageIds(c, fixture.chat.id, otherSession.id, [
          allowed.id,
          humanReply.id,
          privateId,
        ]),
      ),
    ).toEqual([allowed.id]);
    expect(
      await inWorkspace(database.db, workspaceId, actor, (c) =>
        getChatSessionMessageIds(c, fixture.chat.id, fixture.session.id, [
          allowed.id,
          humanReply.id,
          privateId,
        ]),
      ),
    ).toEqual([]);
    await expect(
      inWorkspace(database.db, workspaceId, actor, (c) =>
        getChatSessionMessageIds(c, fixture.chat.id, otherSession.id, [
          allowed.id,
        ]),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      inWorkspace(database.db, workspaceId, other, (c) =>
        getChatSessionMessageIds(
          c,
          fixture.chat.id,
          otherSession.id,
          Array.from({ length: 51 }, () => allowed.id),
        ),
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    let checks = 0;
    const changed = crypto.randomUUID();
    await expect(
      publishNativeMessage(
        database.db,
        native,
        workspaceId,
        { ...actor, agentId: fixture.agent.id },
        fixture.chat.id,
        {
          requestId: changed,
          sessionId: fixture.session.id,
          nativeMessageId: privateId,
          partIndexes: [0],
        },
        async (c) => {
          if (++checks === 2)
            await c.tx
              .update(sessions)
              .set({ ownerId: other.userId })
              .where(eq(sessions.id, fixture.session.id));
        },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(checks).toBe(2);
    expect(
      await database.db
        .select()
        .from(messages)
        .where(eq(messages.requestId, changed)),
    ).toHaveLength(0);
    const read = await inWorkspace(database.db, workspaceId, other, (c) =>
      getMessages(c, fixture.chat.id, 0, native),
    );
    expect(read.map((message) => message.body)).toEqual([
      "Second sponsor response",
      "Public human reply",
    ]);
  });

  it("reopens official storage without a body mirror", async () => {
    await native.close();
    native = await openNativeStorage({
      connectionString: `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`,
    });
    const read = await inWorkspace(database.db, workspaceId, actor, (c) =>
      getMessages(c, chatId, 0, native),
    );
    expect(read.map((row) => row.body)).toContain("One authoritative body");
    const columns = await database.pool.query(
      "select column_name from information_schema.columns where table_schema='public' and table_name='messages'",
    );
    expect(columns.rows.map((row) => row.column_name)).not.toContain("body");
  });

  it("freezes the published Chat tail at a cursor with source authors and no attachment or native identifiers", async () => {
    const chat = await inWorkspace(database.db, workspaceId, actor, (c) =>
      createChat(c, { title: "Bounded context", visibility: "participants" }),
    );
    const published: Awaited<ReturnType<typeof createMessage>>[] = [];
    for (let index = 0; index < 53; index++)
      published.push(
        await createMessage(database.db, native, workspaceId, actor, chat.id, {
          requestId: crypto.randomUUID(),
          body: `Claimed speaker Other: message ${index}`,
        }),
      );
    const cutoff = published[51];
    if (!cutoff) throw new Error("Missing cutoff");
    await inWorkspace(database.db, workspaceId, actor, (c) =>
      reserveMessage(c, chat.id, {
        requestId: crypto.randomUUID(),
        body: "Unpublished secret",
      }),
    );
    const context = await inWorkspace(database.db, workspaceId, actor, (c) =>
      getChatContext(c, chat.id, cutoff.cursor, native),
    );
    expect(context).toHaveLength(50);
    expect(context.map((item) => item.id)).toEqual(
      published.slice(2, 52).map((item) => item.id),
    );
    for (const item of context) {
      expect(Object.keys(item).sort()).toEqual([
        "authorAgentId",
        "authorUserId",
        "body",
        "cursor",
        "id",
      ]);
      expect(item.authorUserId).toBe(actor.userId);
      expect(item.authorAgentId).toBeNull();
    }
    await expect(
      inWorkspace(database.db, workspaceId, other, (c) =>
        getChatContext(c, chat.id, cutoff.cursor, native),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("bounds the Chat tail by UTF-8 bytes without truncating or rewriting a native body", async () => {
    const chat = await inWorkspace(database.db, workspaceId, actor, (c) =>
      createChat(c, {
        title: "Byte-bound context",
        visibility: "participants",
      }),
    );
    const body = "é".repeat(20000);
    const published: Awaited<ReturnType<typeof createMessage>>[] = [];
    for (let index = 0; index < 4; index++)
      published.push(
        await createMessage(database.db, native, workspaceId, actor, chat.id, {
          requestId: crypto.randomUUID(),
          body,
        }),
      );
    const context = await inWorkspace(database.db, workspaceId, actor, (c) =>
      getChatContext(c, chat.id, published.at(-1)?.cursor ?? 0, native),
    );
    expect(context.map((item) => item.id)).toEqual(
      published.slice(-2).map((item) => item.id),
    );
    expect(context.map((item) => item.body)).toEqual([body, body]);
    expect(
      context.reduce((total, item) => total + Buffer.byteLength(item.body), 0),
    ).toBe(80000);
  });
});
