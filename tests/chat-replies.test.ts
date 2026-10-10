import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../apps/server/src/app";
import { createAuth } from "../apps/server/src/auth";
import { createChatMessage } from "../apps/server/src/chat-replies";
import { startQueue } from "../apps/server/src/queue";
import { createAgent } from "../packages/agents/src";
import { agents } from "../packages/agents/src/schema";
import {
  archiveChat,
  createChat,
  createMessage,
  createParticipant,
  deleteParticipant,
  getChatAudience,
  getMessageReplyAgentIds,
  getMessages,
  publishNativeMessage,
  reserveMessage,
  updateParticipant,
} from "../packages/chats/src";
import { messages, participants } from "../packages/chats/src/schema";
import { createEnvironment } from "../packages/environments/src";
import { createProject, upsertProjectMember } from "../packages/projects/src";
import { runs } from "../packages/runs/src/schema";
import { createSession } from "../packages/sessions/src";
import {
  openNativeStorage,
  saveNativeMessage,
} from "../packages/sessions/src/native";
import { required } from "../packages/shared/src";
import {
  mentionUserIds,
  parseMentions,
  serializeMention,
} from "../packages/shared/src/mentions";
import {
  type Context,
  claimInstallation,
  inWorkspace,
} from "../packages/workspaces/src";
import { members, users } from "../packages/workspaces/src/schema";
import {
  controlledSubscription,
  nativeModelAuthorization,
} from "./fixtures/native-model";
import { startPostgres } from "./postgres";

describe("authoritative Chat replies on private PostgreSQL and native storage", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let native: Awaited<ReturnType<typeof openNativeStorage>>;
  let boss: PgBoss;
  let app: ReturnType<typeof createApp>;
  let workspaceId: string;
  let userId: string;
  let cookie: string;
  const origin = "http://localhost:3199";
  const others = [crypto.randomUUID(), crypto.randomUUID()] as const;
  let deniedAccount: string | undefined;
  const authorization = {
    async authorizeModel(c: Context, subscriptionId: string, model: string) {
      if (subscriptionId === deniedAccount)
        throw new Error("PRIVATE_PROVIDER_CREDENTIAL_ERROR");
      return nativeModelAuthorization.authorizeModel(c, subscriptionId, model);
    },
  };
  const context = <T>(work: (c: Context) => Promise<T>) =>
    inWorkspace(database.db, workspaceId, { userId }, work);
  const options = () => ({
    db: database.db,
    nativeStorage: native,
    boss,
    modelAuthorization: authorization,
  });
  const mention = (agentId: string) =>
    serializeMention({ type: "agent", id: agentId, label: "Any [label]\\\n" });
  const send = (
    chatId: string,
    body = "Hello",
    requestId = crypto.randomUUID(),
  ) =>
    createChatMessage(options(), workspaceId, { userId }, chatId, {
      body,
      requestId,
    });
  const savedRuns = (chatId: string) =>
    database.db.select().from(runs).where(eq(runs.chatId, chatId));
  const selected = (chatId: string, messageId: string) =>
    context((c) => getMessageReplyAgentIds(c, chatId, messageId));
  const makeAgent = (configured = true) =>
    context(async (c) => {
      const agent = await createAgent(c, {
        title: "Fixture Agent",
        instructions: "Controlled admission only",
        model: "fixture",
        visibility: "workspace",
        subscriptionId: configured
          ? await controlledSubscription(c)
          : undefined,
      });
      const environment = await createEnvironment(c, agent.id);
      return { ...agent, environment };
    });
  async function fixture(
    humans: number,
    agentCount: number,
    visibility: "participants" | "workspace" = "participants",
    projectId?: string,
  ) {
    const chat = await context((c) =>
      createChat(c, { title: "Routing fixture", visibility, projectId }),
    );
    for (const other of others.slice(0, humans - 1))
      await context((c) =>
        createParticipant(c, chat.id, { userId: other, role: "viewer" }),
      );
    const bots = [];
    for (let index = 0; index < agentCount; index++) {
      const agent = await makeAgent();
      bots.push(agent);
      await context((c) =>
        createParticipant(c, chat.id, {
          agentId: agent.id,
          role: "contributor",
        }),
      );
    }
    return { chat, bots };
  }
  async function post(chatId: string, input: unknown, sessionCookie = cookie) {
    return app.request(
      `${origin}/api/workspaces/${workspaceId}/chats/${chatId}/messages`,
      {
        method: "POST",
        headers: {
          cookie: sessionCookie,
          origin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      },
    );
  }
  beforeAll(async () => {
    database = await startPostgres();
    native = await openNativeStorage({
      connectionString: `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`,
    });
    boss = await startQueue(database.db, database.pool, {
      install: true,
      workers: false,
    });
    const auth = createAuth(
      database.db,
      crypto.randomUUID() + crypto.randomUUID(),
      origin,
    );
    app = createApp({ ...options(), auth, origin });
    const signup = await app.request(`${origin}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Fictional routing owner",
        email: "routing@example.test",
        password: crypto.randomUUID() + crypto.randomUUID(),
      }),
    });
    expect(signup.status).toBe(200);
    cookie = signup.headers.get("set-cookie") ?? "";
    userId = z
      .object({ user: z.object({ id: z.string() }) })
      .parse(await signup.json()).user.id;
    workspaceId = (
      await claimInstallation(database.db, userId, "Routing fixture")
    ).id;
    await database.db.insert(users).values(
      others.map((id) => ({
        id,
        name: "Fictional viewer",
        email: `${id}@example.test`,
        emailVerified: true,
      })),
    );
    await database.db.insert(members).values(
      others.map((id) => ({
        workspaceId,
        userId: id,
        role: "viewer" as const,
      })),
    );
  });
  afterAll(async () => {
    await boss?.stop();
    await native?.close();
    await database?.stop();
  });

  it.each([0, 1, 2])(
    "requires mentions outside exact 1-human/1-Agent chats with %i Agents",
    async (count) => {
      for (const humans of [1, 2, 3]) {
        const { chat, bots } = await fixture(humans, count);
        const response = await send(chat.id);
        expect(response.replyErrors).toEqual([]);
        expect(await selected(chat.id, response.id)).toEqual(
          humans === 1 && count === 1 ? [bots[0]?.id] : [],
        );
        expect(await savedRuns(chat.id)).toHaveLength(
          humans === 1 && count === 1 ? 1 : 0,
        );
        expect(response).not.toHaveProperty("replyAgentIds");
        expect(response).not.toHaveProperty("nativeMessageId");
      }
    },
  );

  it("uses typed identity, escaped labels and encoded IDs, deduplicating only Agent mentions", async () => {
    const { chat, bots } = await fixture(2, 2);
    const first = required(bots[0]);
    const second = required(bots[1]);
    const userMention = serializeMention({
      type: "user",
      id: others[0],
      label: first.title,
    });
    const ordinary = await send(chat.id, `${userMention} @${first.title}`);
    expect(await selected(chat.id, ordinary.id)).toEqual([]);
    const body = `${mention(first.id)} ${mention(first.id)} @[different](agent:${second.id.replace(/-/g, "%2D")})`;
    const response = await send(chat.id, body);
    expect(response.replyErrors).toEqual([]);
    expect(await selected(chat.id, response.id)).toEqual([first.id, second.id]);
    expect((await savedRuns(chat.id)).map((run) => run.agentId).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect(parseMentions(mention(first.id))[0]?.label).toBe("Any [label]\\\n");
    expect(mentionUserIds(`${userMention} ${userMention} ${body}`)).toEqual([
      others[0],
    ]);
    const one = await send(chat.id, mention(first.id));
    expect(await selected(chat.id, one.id)).toEqual([first.id]);
  });

  it("counts the actual workspace/project audience, including viewers without explicit Chat rows", async () => {
    const workspace = await fixture(1, 1, "workspace");
    const first = await send(workspace.chat.id);
    expect(await selected(workspace.chat.id, first.id)).toEqual([]);
    const project = await context((c) =>
      createProject(c, { title: "Restricted project" }),
    );
    const scoped = await fixture(1, 1, "workspace", project.id);
    const alone = await send(scoped.chat.id);
    expect(await selected(scoped.chat.id, alone.id)).toEqual([
      scoped.bots[0]?.id,
    ]);
    await context((c) =>
      upsertProjectMember(c, project.id, others[0], "viewer"),
    );
    const shared = await send(scoped.chat.id);
    expect(await selected(scoped.chat.id, shared.id)).toEqual([]);
    await expect(
      inWorkspace(database.db, workspaceId, { userId: others[0] }, (c) =>
        reserveMessage(c, scoped.chat.id, {
          body: "Viewer",
          requestId: crypto.randomUUID(),
        }),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("refuses a human send when there is no eligible human audience", async () => {
    const { chat } = await fixture(1, 0);
    const [owner] = await database.db
      .select()
      .from(participants)
      .where(
        and(eq(participants.chatId, chat.id), eq(participants.userId, userId)),
      );
    await context((c) => deleteParticipant(c, chat.id, required(owner).id));
    await expect(send(chat.id)).rejects.toMatchObject({ code: "forbidden" });
    expect(await savedRuns(chat.id)).toEqual([]);
  });

  it("rejects nonparticipant and viewer-Agent mentions without membership or message writes", async () => {
    const { chat, bots } = await fixture(1, 2);
    const outsider = await makeAgent();
    const viewer = required(bots[1]);
    const [row] = await database.db
      .select()
      .from(participants)
      .where(
        and(
          eq(participants.chatId, chat.id),
          eq(participants.agentId, viewer.id),
        ),
      );
    await context((c) =>
      updateParticipant(c, chat.id, required(row).id, "viewer"),
    );
    for (const agentId of [outsider.id, viewer.id, "not-a-uuid"])
      await expect(
        send(chat.id, `${mention(required(bots[0]).id)} ${mention(agentId)}`),
      ).rejects.toMatchObject({ code: "invalid" });
    expect(await savedRuns(chat.id)).toEqual([]);
    expect(
      await database.db
        .select()
        .from(messages)
        .where(eq(messages.chatId, chat.id)),
    ).toEqual([]);
    expect(
      await database.db
        .select()
        .from(participants)
        .where(eq(participants.chatId, chat.id)),
    ).toHaveLength(3);
    const ordinary = await send(chat.id);
    expect(await selected(chat.id, ordinary.id)).toEqual([]);
  });

  it("persists acknowledged HTTP messages on partial admission, retries every recipient and hides raw errors", async () => {
    const { chat, bots } = await fixture(2, 2);
    const first = required(bots[0]);
    const second = required(bots[1]);
    deniedAccount = required(first.subscriptionId ?? undefined);
    const input = {
      body: `${mention(first.id)} ${mention(second.id)}`,
      requestId: crypto.randomUUID(),
    };
    const response = await post(chat.id, input);
    expect(response.status).toBe(200);
    const shape = z.object({
      id: z.uuid(),
      body: z.string(),
      cursor: z.number(),
      replyErrors: z.array(
        z.object({ agentId: z.uuid(), code: z.string(), message: z.string() }),
      ),
    });
    const result = shape.parse(await response.json());
    expect(result.replyErrors).toEqual([
      {
        agentId: first.id,
        code: "unavailable",
        message:
          "Agent reply is unavailable. Check its model account and retry.",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_PROVIDER");
    const admitted = await savedRuns(chat.id);
    expect(admitted).toHaveLength(1);
    expect(admitted[0]?.agentId).toBe(second.id);
    deniedAccount = undefined;
    const retries = await Promise.all([
      post(chat.id, input),
      post(chat.id, input),
    ]);
    for (const retry of retries)
      expect(shape.parse(await retry.json())).toMatchObject({
        id: result.id,
        cursor: result.cursor,
        replyErrors: [],
      });
    const completed = await savedRuns(chat.id);
    expect(completed).toHaveLength(2);
    expect(completed.find((run) => run.agentId === second.id)?.id).toBe(
      admitted[0]?.id,
    );
    expect(new Set(completed.map((run) => run.requestId)).size).toBe(2);
    expect(
      completed.every(
        (run) => run.requestIdentity?.messageIds?.[0] === result.id,
      ),
    ).toBe(true);
    const reload = await app.request(
      `${origin}/api/workspaces/${workspaceId}/chats/${chat.id}/messages`,
      { headers: { cookie } },
    );
    expect(reload.status).toBe(200);
    const history = z
      .array(z.object({ id: z.uuid(), body: z.string() }).passthrough())
      .parse(await reload.json());
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ id: result.id, body: input.body });
    expect(history[0]).not.toHaveProperty("replyAgentIds");
    expect(history[0]).not.toHaveProperty("requestHash");
    expect((await post(chat.id, { ...input, body: "changed" })).status).toBe(
      409,
    );
    expect((await post(chat.id, input, "")).status).toBe(401);
  });

  it("freezes an empty selection and an automatic recipient across later membership changes", async () => {
    const empty = await fixture(1, 0);
    const requestId = crypto.randomUUID();
    const initial = await send(empty.chat.id, "No recipient", requestId);
    const newAgent = await makeAgent();
    await context((c) =>
      createParticipant(c, empty.chat.id, {
        agentId: newAgent.id,
        role: "contributor",
      }),
    );
    const retry = await send(empty.chat.id, "No recipient", requestId);
    expect(retry.id).toBe(initial.id);
    expect(await selected(empty.chat.id, retry.id)).toEqual([]);
    expect(await savedRuns(empty.chat.id)).toHaveLength(0);
    const automatic = await fixture(1, 1);
    const id = crypto.randomUUID();
    deniedAccount = required(
      required(automatic.bots[0]).subscriptionId ?? undefined,
    );
    const original = await send(automatic.chat.id, "Frozen recipient", id);
    expect(original.replyErrors).toHaveLength(1);
    await context((c) =>
      createParticipant(c, automatic.chat.id, {
        agentId: newAgent.id,
        role: "contributor",
      }),
    );
    deniedAccount = undefined;
    const resumed = await send(automatic.chat.id, "Frozen recipient", id);
    expect(resumed.replyErrors).toEqual([]);
    expect(await selected(automatic.chat.id, resumed.id)).toEqual([
      automatic.bots[0]?.id,
    ]);
    expect(
      (await savedRuns(automatic.chat.id)).map((run) => run.agentId),
    ).toEqual([automatic.bots[0]?.id]);
  });

  it("reauthorizes frozen recipients even on an accepted exact retry", async () => {
    const { chat, bots } = await fixture(1, 1);
    const requestId = crypto.randomUUID();
    const initial = await send(chat.id, "Accepted", requestId);
    const [participant] = await database.db
      .select()
      .from(participants)
      .where(
        and(
          eq(participants.chatId, chat.id),
          eq(participants.agentId, required(bots[0]).id),
        ),
      );
    await context((c) =>
      updateParticipant(c, chat.id, required(participant).id, "viewer"),
    );
    const viewer = await send(chat.id, "Accepted", requestId);
    expect(viewer.id).toBe(initial.id);
    expect(viewer.replyErrors).toMatchObject([
      { agentId: required(bots[0]).id, code: "forbidden" },
    ]);
    await context((c) =>
      deleteParticipant(c, chat.id, required(participant).id),
    );
    const removed = await send(chat.id, "Accepted", requestId);
    expect(removed.replyErrors).toMatchObject([{ code: "forbidden" }]);
    expect(await savedRuns(chat.id)).toHaveLength(1);
    await expect(
      inWorkspace(database.db, workspaceId, { userId: others[0] }, (c) =>
        getMessageReplyAgentIds(c, chat.id, initial.id),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("serializes fresh concurrent admission without duplicating messages, Runs or queue jobs", async () => {
    const { chat, bots } = await fixture(1, 2);
    const requestId = crypto.randomUUID();
    const body = bots.map((bot) => mention(bot.id)).join(" ");
    const results = await Promise.all([
      send(chat.id, body, requestId),
      send(chat.id, body, requestId),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]?.replyErrors).toEqual([]);
    const rows = await savedRuns(chat.id);
    expect(rows).toHaveLength(2);
    const jobs = await database.pool.query(
      "select data from queue.job where data->>'runId' = any($1::text[])",
      [rows.map((row) => row.id)],
    );
    expect(jobs.rows).toHaveLength(2);
    expect(
      await database.db
        .select()
        .from(messages)
        .where(eq(messages.chatId, chat.id)),
    ).toHaveLength(1);
  });

  it("reauthorizes a recipient removed between reservation and publication without replacing it", async () => {
    const { chat, bots } = await fixture(1, 1);
    let checks = 0;
    const reply = await createChatMessage(
      options(),
      workspaceId,
      { userId },
      chat.id,
      {
        body: "Membership changes during publication",
        requestId: crypto.randomUUID(),
      },
      async (c) => {
        if (++checks === 2) {
          const [row] = await c.tx
            .select()
            .from(participants)
            .where(
              and(
                eq(participants.chatId, chat.id),
                eq(participants.agentId, required(bots[0]).id),
              ),
            );
          await deleteParticipant(c, chat.id, required(row).id);
        }
      },
    );
    expect(reply.replyErrors).toMatchObject([
      { agentId: required(bots[0]).id, code: "forbidden" },
    ]);
    expect(await selected(chat.id, reply.id)).toEqual([required(bots[0]).id]);
    expect(await savedRuns(chat.id)).toEqual([]);
  });

  it("uses the entire bounded participant set without guessing automatic replies from oversized snapshots", async () => {
    const { chat } = await fixture(1, 0);
    const ids = Array.from({ length: 100 }, () => crypto.randomUUID());
    await database.db.insert(agents).values(
      ids.map((id) => ({
        id,
        workspaceId,
        createdBy: userId,
        title: "Bounded fixture",
        instructions: "No inference",
        model: "fixture",
        visibility: "workspace" as const,
      })),
    );
    await database.db.insert(participants).values(
      ids.slice(0, 99).map((agentId) => ({
        chatId: chat.id,
        agentId,
        role: "contributor" as const,
      })),
    );
    const ordinary = await send(chat.id);
    expect(await selected(chat.id, ordinary.id)).toEqual([]);
    const last = required(ids[98]);
    const mentioned = await send(chat.id, mention(last));
    expect(await selected(chat.id, mentioned.id)).toEqual([last]);
    expect(mentioned.replyErrors).toMatchObject([
      { agentId: last, code: "unavailable" },
    ]);
    await database.db.insert(participants).values({
      chatId: chat.id,
      agentId: required(ids[99]),
      role: "contributor",
    });
    const oversized = await send(chat.id);
    expect(oversized.replyErrors).toEqual([]);
    expect(await selected(chat.id, oversized.id)).toEqual([]);
    await expect(
      context((c) => getChatAudience(c, chat.id)),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(await savedRuns(chat.id)).toEqual([]);
  });

  it("preserves oversized legacy human discussion, rejects oversized reply admission and freezes empty retries", async () => {
    const { chat } = await fixture(1, 0);
    const legacyIds = Array.from({ length: 102 }, () => crypto.randomUUID());
    await database.db.insert(users).values(
      legacyIds.map((id) => ({
        id,
        name: "Retained legacy viewer",
        email: `${id}@example.test`,
        emailVerified: true,
      })),
    );
    await database.db.insert(members).values(
      legacyIds.map((id) => ({
        workspaceId,
        userId: id,
        role: "viewer" as const,
      })),
    );
    await database.db.insert(participants).values(
      legacyIds.map((id) => ({
        chatId: chat.id,
        userId: id,
        role: "viewer" as const,
      })),
    );
    const discussion = await post(chat.id, {
      body: "Legacy discussion",
      requestId: crypto.randomUUID(),
    });
    expect(discussion.status).toBe(200);
    const published = z
      .object({ id: z.uuid(), replyErrors: z.array(z.unknown()) })
      .parse(await discussion.json());
    expect(published.replyErrors).toEqual([]);
    expect(await selected(chat.id, published.id)).toEqual([]);
    const agent = await makeAgent();
    await database.db
      .insert(participants)
      .values({ chatId: chat.id, agentId: agent.id, role: "contributor" });
    const requestId = crypto.randomUUID();
    const before = await send(
      chat.id,
      "Oversized automatic selection",
      requestId,
    );
    expect(before.replyErrors).toEqual([]);
    expect(await selected(chat.id, before.id)).toEqual([]);
    const explicit = await send(chat.id, mention(agent.id));
    expect(explicit.replyErrors).toMatchObject([
      { agentId: agent.id, code: "unavailable" },
    ]);
    expect(await selected(chat.id, explicit.id)).toEqual([agent.id]);
    expect(
      (await context((c) => getMessages(c, chat.id, 0, native))).map(
        (row) => row.id,
      ),
    ).toEqual([published.id, before.id, explicit.id]);
    await expect(
      send(chat.id, mention(crypto.randomUUID())),
    ).rejects.toMatchObject({ code: "invalid" });
    await database.db
      .update(participants)
      .set({ role: "viewer" })
      .where(
        and(
          eq(participants.chatId, chat.id),
          eq(participants.agentId, agent.id),
        ),
      );
    await expect(send(chat.id, mention(agent.id))).rejects.toMatchObject({
      code: "invalid",
    });
    await database.db
      .update(participants)
      .set({ role: "contributor" })
      .where(
        and(
          eq(participants.chatId, chat.id),
          eq(participants.agentId, agent.id),
        ),
      );
    await expect(
      context((c) => getChatAudience(c, chat.id)),
    ).rejects.toMatchObject({ code: "unavailable" });
    await database.db
      .delete(participants)
      .where(
        and(
          eq(participants.chatId, chat.id),
          inArray(participants.userId, legacyIds),
        ),
      );
    const retry = await send(
      chat.id,
      "Oversized automatic selection",
      requestId,
    );
    expect(retry.id).toBe(before.id);
    expect(await selected(chat.id, retry.id)).toEqual([]);
    expect(await savedRuns(chat.id)).toEqual([]);
    expect((await send(chat.id)).replyErrors).toEqual([]);
    expect(await savedRuns(chat.id)).toHaveLength(1);
  });

  it("preserves discussion but explicitly refuses automatic and mentioned replies for archived or unconfigured sources", async () => {
    for (const mode of ["chat", "agent", "unconfigured", "viewer"] as const) {
      const { chat, bots } = await fixture(1, 1);
      const agent = required(bots[0]);
      if (mode === "chat") await context((c) => archiveChat(c, chat.id, true));
      if (mode === "agent")
        await database.db
          .update(agents)
          .set({ archived: true })
          .where(eq(agents.id, agent.id));
      if (mode === "unconfigured")
        await database.db
          .update(agents)
          .set({ subscriptionId: null })
          .where(eq(agents.id, agent.id));
      if (mode === "viewer") {
        const [row] = await database.db
          .select()
          .from(participants)
          .where(
            and(
              eq(participants.chatId, chat.id),
              eq(participants.agentId, agent.id),
            ),
          );
        await context((c) =>
          updateParticipant(c, chat.id, required(row).id, "viewer"),
        );
      }
      const response = await send(chat.id);
      expect(response.replyErrors).toMatchObject([
        {
          agentId: agent.id,
          code:
            mode === "unconfigured"
              ? "unavailable"
              : mode === "viewer"
                ? "forbidden"
                : "conflict",
        },
      ]);
      expect(response.cursor).toBeGreaterThan(0);
      if (mode !== "viewer")
        expect(
          (await send(chat.id, mention(agent.id))).replyErrors,
        ).toHaveLength(1);
      expect(await savedRuns(chat.id)).toHaveLength(0);
      expect(
        (await context((c) => getMessages(c, chat.id, 0, native))).length,
      ).toBeGreaterThan(0);
    }
    const empty = await fixture(1, 0);
    await context((c) => archiveChat(c, empty.chat.id, true));
    expect((await send(empty.chat.id)).replyErrors).toEqual([]);
  });

  it("keeps human-only discussion independent of model accounts and rejects viewer/author/request conflicts", async () => {
    const { chat } = await fixture(2, 0);
    const input = { body: "Discussion", requestId: crypto.randomUUID() };
    expect((await post(chat.id, input)).status).toBe(200);
    await expect(
      createChatMessage(
        options(),
        workspaceId,
        { userId: others[0] },
        chat.id,
        input,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await database.db
      .update(members)
      .set({ role: "contributor" })
      .where(
        and(
          eq(members.workspaceId, workspaceId),
          eq(members.userId, others[0]),
        ),
      );
    const [row] = await database.db
      .select()
      .from(participants)
      .where(
        and(
          eq(participants.chatId, chat.id),
          eq(participants.userId, others[0]),
        ),
      );
    await context((c) =>
      updateParticipant(c, chat.id, required(row).id, "contributor"),
    );
    await expect(
      createChatMessage(
        options(),
        workspaceId,
        { userId: others[0] },
        chat.id,
        input,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await savedRuns(chat.id)).toEqual([]);
  });

  it("never routes Agent messages or native Agent publications, including explicit mentions", async () => {
    const { chat, bots } = await fixture(1, 2);
    const author = required(bots[0]);
    const body = mention(required(bots[1]).id);
    const actor = { userId, agentId: author.id };
    const direct = await createChatMessage(
      options(),
      workspaceId,
      actor,
      chat.id,
      { body, requestId: crypto.randomUUID() },
    );
    expect(direct.replyErrors).toEqual([]);
    const session = await context((c) =>
      createSession(c, {
        chatId: chat.id,
        agentId: author.id,
        environmentId: author.environment.id,
        environmentGeneration: author.environment.generation,
        scope: "fixture",
        provider: "fixture",
        model: "fixture",
        accountId: "fixture",
        subscriptionId: null,
      }),
    );
    const nativeId = crypto.randomUUID();
    await saveNativeMessage(native, {
      workspaceId,
      threadId: session.id,
      messageId: nativeId,
      role: "assistant",
      body,
      createdAt: new Date(),
    });
    const published = await publishNativeMessage(
      database.db,
      native,
      workspaceId,
      actor,
      chat.id,
      {
        sessionId: session.id,
        nativeMessageId: nativeId,
        partIndexes: [0],
        requestId: crypto.randomUUID(),
      },
      async () => {},
    );
    expect(published).not.toHaveProperty("replyAgentIds");
    const rows = await database.db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chat.id));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.replyAgentIds.length === 0)).toBe(true);
    expect(await savedRuns(chat.id)).toEqual([]);
  });

  it("preserves request hashes and native bytes while recovering a reserved message after membership changes", async () => {
    const { chat } = await fixture(1, 0);
    const input = {
      body: "Immutable legacy-compatible text",
      requestId: crypto.randomUUID(),
    };
    const reservation = await context((c) => reserveMessage(c, chat.id, input));
    const expectedHash = createHash("sha256")
      .update(
        JSON.stringify({
          body: input.body,
          replyTo: null,
          mentions: [],
          files: [],
          reference: null,
        }),
      )
      .digest("hex");
    expect(reservation.requestHash).toBe(expectedHash);
    const agent = await makeAgent();
    await context((c) =>
      createParticipant(c, chat.id, { agentId: agent.id, role: "contributor" }),
    );
    const recovered = await send(chat.id, input.body, input.requestId);
    expect(recovered.id).toBe(reservation.id);
    expect(await selected(chat.id, recovered.id)).toEqual([]);
    expect(await savedRuns(chat.id)).toEqual([]);
    const [row] = await database.db
      .select()
      .from(messages)
      .where(eq(messages.id, recovered.id));
    expect(row?.requestHash).toBe(expectedHash);
    expect(row?.nativeMessageId).toBe(reservation.nativeMessageId);
  });

  it("adds only a default-empty routing column to populated legacy metadata without changing saved identities", async () => {
    const { chat } = await fixture(1, 1);
    const input = { body: "Legacy body", requestId: crypto.randomUUID() };
    const legacy = await createMessage(
      database.db,
      native,
      workspaceId,
      { userId },
      chat.id,
      input,
    );
    const before = await database.pool.query(
      `select id, to_jsonb(messages) - 'replyAgentIds' as value from messages order by id`,
    );
    const nativeBefore = await database.pool.query(
      `select md5(string_agg(to_jsonb(m)::text, '' order by id)) as hash from mastra.mastra_messages m`,
    );
    const runsBefore = await database.pool.query(
      `select md5(string_agg(to_jsonb(r)::text, '' order by id)) as hash from runs r`,
    );
    await database.db.execute(
      sql`alter table messages drop column "replyAgentIds"`,
    );
    const client = await database.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `alter table messages add column "replyAgentIds" jsonb not null default '[]'::jsonb`,
      );
      await client.query("rollback");
      expect(
        (
          await client.query(
            `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'messages' and column_name = 'replyAgentIds'`,
          )
        ).rows,
      ).toEqual([]);
      expect(
        (
          await client.query(
            `select id, to_jsonb(messages) as value from messages order by id`,
          )
        ).rows,
      ).toEqual(before.rows);
    } finally {
      client.release();
    }
    await database.db.execute(
      sql`alter table messages add column "replyAgentIds" jsonb not null default '[]'::jsonb`,
    );
    const after = await database.pool.query(
      `select id, to_jsonb(messages) - 'replyAgentIds' as value from messages order by id`,
    );
    expect(after.rows).toEqual(before.rows);
    expect(
      (await database.db.select().from(messages)).every(
        (row) => row.replyAgentIds.length === 0,
      ),
    ).toBe(true);
    const nativeAfter = await database.pool.query(
      `select md5(string_agg(to_jsonb(m)::text, '' order by id)) as hash from mastra.mastra_messages m`,
    );
    expect(nativeAfter.rows).toEqual(nativeBefore.rows);
    expect(
      (
        await database.pool.query(
          `select md5(string_agg(to_jsonb(r)::text, '' order by id)) as hash from runs r`,
        )
      ).rows,
    ).toEqual(runsBefore.rows);
    const retry = await send(chat.id, input.body, input.requestId);
    expect(retry.id).toBe(legacy.id);
    expect(retry.replyErrors).toEqual([]);
    expect(await selected(chat.id, retry.id)).toEqual([]);
    expect(await savedRuns(chat.id)).toEqual([]);
  });
});
