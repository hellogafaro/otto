import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import WebSocket from "ws";
import { z } from "zod";
import { updateParticipant } from "../packages/chats/src";
import { participants } from "../packages/chats/src/schema";
import { createDocument, updateDocument } from "../packages/documents/src";
import { environments } from "../packages/environments/src/schema";
import { runs } from "../packages/runs/src/schema";
import { recordSessionSources } from "../packages/sessions/src";
import { sessions } from "../packages/sessions/src/schema";
import { required } from "../packages/shared/src";
import { inWorkspace } from "../packages/workspaces/src";
import { startStreamingApp } from "./fixtures/streaming-app";

const frame = z.object({
  type: z.literal("drafts"),
  drafts: z.array(
    z.object({
      id: z.uuid(),
      runId: z.uuid(),
      agentId: z.uuid(),
      text: z.string(),
    }),
  ),
});

describe("native sponsor-private streaming over authenticated realtime", () => {
  let app: Awaited<ReturnType<typeof startStreamingApp>>;
  let owner: Awaited<ReturnType<typeof app.register>>;
  let peer: typeof owner;
  const sockets = new Set<WebSocket>();
  beforeAll(async () => {
    vi.setConfig({ expect: { poll: { timeout: 5000 } } });
    app = await startStreamingApp("http://127.0.0.1:45284");
    owner = await app.register("Stream sponsor");
    peer = await app.register("Other participant");
  }, 120000);
  afterAll(async () => {
    for (const socket of sockets) socket.close();
    await app?.stop();
    vi.resetConfig();
  });
  afterEach(async () => {
    for (const runId of app.controls.keys())
      await app.request(owner.cookie, `/runs/${runId}/stop`, {});
    for (const socket of sockets) socket.close();
    sockets.clear();
  });

  async function connect(cookie: string, workspaceId: string, chatId: string) {
    const url = new URL("/api/realtime", app.apiOrigin);
    url.protocol = "ws:";
    url.searchParams.set("workspaceId", workspaceId);
    url.searchParams.set("chatId", chatId);
    url.searchParams.set("drafts", "private");
    const socket = new WebSocket(url, {
      headers: { cookie, origin: app.origin },
    });
    sockets.add(socket);
    const received: z.infer<typeof frame>[] = [];
    const payloads: string[] = [];
    socket.on("message", (data) => {
      const payload = data.toString();
      payloads.push(payload);
      const result = frame.safeParse(JSON.parse(payload));
      if (result.success) received.push(result.data);
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    return {
      socket,
      received,
      payloads,
      drafts: () => received.at(-1)?.drafts,
    };
  }
  async function launch(
    chatId: string,
    agentId: string,
    body: string,
    extra = {},
    cookie = owner.cookie,
  ) {
    const response = await app.request(cookie, "/runs", {
      chatId,
      agentId,
      body,
      requestId: crypto.randomUUID(),
      type: "prompt",
      ...extra,
    });
    expect(response.status).toBe(200);
    const run = z.object({ id: z.uuid() }).parse(await response.json());
    await expect
      .poll(() => app.controls.has(run.id), { timeout: 15000 })
      .toBe(true);
    return run.id;
  }
  async function state(runId: string) {
    return required(
      (await app.database.db.select().from(runs).where(eq(runs.id, runId)))[0],
    );
  }

  it("delivers real partial chunks before completion, separates two Agents, excludes reasoning and peers, then reloads only publications", async () => {
    const { workspaceId, chatId, agentIds } = await app.setup(
      owner.id,
      peer.id,
    );
    const sponsor = await connect(owner.cookie, workspaceId, chatId);
    const other = await connect(peer.cookie, workspaceId, chatId);
    const alpha = await launch(chatId, agentIds[0], "Alpha");
    const beta = await launch(chatId, agentIds[1], "Beta");
    await expect
      .poll(() =>
        sponsor
          .drafts()
          ?.map((draft) => draft.text)
          .sort(),
      )
      .toEqual(["Alpha first", "Beta first"]);
    const ids = sponsor
      .drafts()
      ?.map((draft) => draft.id)
      .sort();
    expect((await state(alpha)).state).toBe("running");
    expect((await state(beta)).state).toBe("running");
    app.controls.get(alpha)?.delta(" second");
    app.controls.get(beta)?.delta(" different");
    await expect
      .poll(() =>
        sponsor
          .drafts()
          ?.map((draft) => draft.text)
          .sort(),
      )
      .toEqual(["Alpha first second", "Beta first different"]);
    expect(
      sponsor.drafts()?.find((draft) => draft.runId === alpha)?.agentId,
    ).toBe(agentIds[0]);
    expect(
      sponsor.drafts()?.find((draft) => draft.runId === beta)?.agentId,
    ).toBe(agentIds[1]);
    expect(sponsor.payloads.join("")).not.toContain("NEVER_STREAM_REASONING");
    expect(
      sponsor.received.map((value) => JSON.stringify(value)).join(""),
    ).not.toContain((await state(alpha)).sessionId);
    expect(other.received.length).toBeGreaterThan(0);
    expect(other.received.every((value) => value.drafts.length === 0)).toBe(
      true,
    );
    expect(other.payloads.join("")).not.toContain("Alpha first");
    const sessions = await app.request(
      peer.cookie,
      `/chats/${chatId}/sessions`,
    );
    expect(sessions.status).toBe(200);
    expect(JSON.stringify(await sessions.json())).not.toContain(
      (await state(alpha)).sessionId,
    );
    sponsor.socket.close();
    const resumed = await connect(owner.cookie, workspaceId, chatId);
    await expect
      .poll(() =>
        resumed
          .drafts()
          ?.map((draft) => draft.id)
          .sort(),
      )
      .toEqual(ids);
    app.controls.get(alpha)?.finish();
    app.controls.get(beta)?.finish();
    await expect
      .poll(async () => [(await state(alpha)).state, (await state(beta)).state])
      .toEqual(["finished", "finished"]);
    await expect.poll(() => resumed.drafts()).toEqual([]);
    const output = z
      .array(z.object({ body: z.string(), requestId: z.uuid() }))
      .parse(
        await (
          await app.request(peer.cookie, `/chats/${chatId}/messages`)
        ).json(),
      );
    expect(output.map((message) => message.body).sort()).toEqual([
      "Alpha first second",
      "Beta first different",
    ]);
    expect(output.map((message) => message.requestId).sort()).toEqual(ids);
    const reloaded = await connect(owner.cookie, workspaceId, chatId);
    await expect.poll(() => reloaded.drafts()).toEqual([]);
    expect(
      (
        await (
          await app.request(owner.cookie, `/chats/${chatId}/messages`)
        ).json()
      ).length,
    ).toBe(2);
    for (const connection of [other, resumed, reloaded])
      connection.socket.close();
  });

  it("clears drafts on authenticated Stop with no publication", async () => {
    const { workspaceId, chatId, agentIds } = await app.setup(owner.id);
    const connection = await connect(owner.cookie, workspaceId, chatId);
    const runId = await launch(chatId, agentIds[0], "Cancelled");
    await expect.poll(() => connection.drafts()?.length).toBe(1);
    expect(
      (await app.request(owner.cookie, `/runs/${runId}/stop`, {})).status,
    ).toBe(200);
    await expect.poll(() => connection.drafts()).toEqual([]);
    await expect
      .poll(async () => (await state(runId)).state)
      .toBe("interrupted");
    expect(
      await (
        await app.request(owner.cookie, `/chats/${chatId}/messages`)
      ).json(),
    ).toEqual([]);
    connection.socket.close();
  });

  it("reauthorizes current Chat role before each draft read", async () => {
    const { workspaceId, chatId, agentIds } = await app.setup(
      owner.id,
      peer.id,
    );
    const connection = await connect(peer.cookie, workspaceId, chatId);
    const runId = await launch(
      chatId,
      agentIds[0],
      "Role fenced",
      {},
      peer.cookie,
    );
    await expect.poll(() => connection.drafts()?.length).toBe(1);
    await inWorkspace(
      app.database.db,
      workspaceId,
      { userId: owner.id },
      async (c) => {
        const participant = (
          await c.tx
            .select()
            .from(participants)
            .where(eq(participants.chatId, chatId))
        ).find((item) => item.userId === peer.id);
        if (!participant) throw new Error("Sponsor participant missing");
        await updateParticipant(c, chatId, participant.id, "viewer");
      },
    );
    await expect.poll(() => connection.drafts()).toEqual([]);
    await expect
      .poll(async () => (await state(runId)).state)
      .toBe("interrupted");
    expect(
      await (
        await app.request(owner.cookie, `/chats/${chatId}/messages`)
      ).json(),
    ).toEqual([]);
    connection.socket.close();
  });

  it("reauthorizes retained source audience and withholds oversized drafts", async () => {
    const { workspaceId, chatId, agentIds } = await app.setup(
      owner.id,
      peer.id,
    );
    const connection = await connect(owner.cookie, workspaceId, chatId);
    const runId = await launch(chatId, agentIds[0], "Source fenced");
    await expect.poll(() => connection.drafts()?.length).toBe(1);
    const source = await inWorkspace(
      app.database.db,
      workspaceId,
      { userId: owner.id },
      (c) =>
        createDocument(c, {
          title: "Retained source",
          body: "Fixture context",
          visibility: "workspace",
        }),
    );
    const run = await state(runId);
    if (!run.sessionId) throw new Error("Native Session missing");
    await inWorkspace(
      app.database.db,
      workspaceId,
      { userId: owner.id, agentId: agentIds[0] },
      (c) =>
        recordSessionSources(c, run.sessionId ?? "", [
          { type: "document", id: source.id },
        ]),
    );
    await inWorkspace(app.database.db, workspaceId, { userId: owner.id }, (c) =>
      updateDocument(c, source.id, {
        editToken: source.editToken,
        visibility: "user",
      }),
    );
    await expect.poll(() => connection.drafts()).toEqual([]);
    await expect
      .poll(async () => (await state(runId)).state)
      .toBe("interrupted");
    connection.socket.close();
    const bounded = await app.setup(owner.id);
    const boundedConnection = await connect(
      owner.cookie,
      workspaceId,
      bounded.chatId,
    );
    const oversized = await launch(
      bounded.chatId,
      bounded.agentIds[0],
      "Bounded",
    );
    await expect.poll(() => boundedConnection.drafts()?.length).toBe(1);
    app.controls.get(oversized)?.delta("x".repeat(32768));
    await expect.poll(() => boundedConnection.drafts()).toEqual([]);
    expect((await state(oversized)).state).toBe("running");
    app.controls.get(oversized)?.finish();
    await expect
      .poll(async () => (await state(oversized)).state)
      .toBe("finished");
    boundedConnection.socket.close();
  });

  it.each(["attempt", "launch", "generation", "session-owner"])(
    "rejects stale %s identity before the next private frame",
    async (fence) => {
      const { workspaceId, chatId, agentIds } = await app.setup(
        owner.id,
        peer.id,
      );
      const connection = await connect(owner.cookie, workspaceId, chatId);
      const runId = await launch(chatId, agentIds[0], `Fence ${fence}`);
      await expect.poll(() => connection.drafts()?.length).toBe(1);
      const original = await state(runId);
      await inWorkspace(
        app.database.db,
        workspaceId,
        { userId: owner.id },
        async (c) => {
          if (fence === "generation")
            await c.tx
              .update(environments)
              .set({ generation: original.environmentGeneration + 1 })
              .where(eq(environments.agentId, agentIds[0]));
          else if (fence === "session-owner")
            await c.tx
              .update(sessions)
              .set({ ownerId: peer.id })
              .where(
                eq(sessions.id, required(original.sessionId ?? undefined)),
              );
          else
            await c.tx
              .update(runs)
              .set(
                fence === "attempt"
                  ? { attempt: original.attempt + 1 }
                  : { launchKey: crypto.randomUUID() },
              )
              .where(eq(runs.id, runId));
        },
      );
      await expect.poll(() => connection.drafts()).toEqual([]);
      await expect.poll(() => app.controls.has(runId)).toBe(false);
      expect(
        await (
          await app.request(owner.cookie, `/chats/${chatId}/messages`)
        ).json(),
      ).toEqual([]);
      connection.socket.close();
    },
  );

  it("rejects private selected material before a shared Run can stream", async () => {
    const { workspaceId, chatId, agentIds } = await app.setup(
      owner.id,
      peer.id,
    );
    const document = await inWorkspace(
      app.database.db,
      workspaceId,
      { userId: owner.id },
      (c) =>
        createDocument(c, {
          title: "Sponsor private",
          body: "Never share this source",
          visibility: "user",
        }),
    );
    const response = await app.request(owner.cookie, "/runs", {
      chatId,
      agentId: agentIds[0],
      body: "Private selection",
      type: "prompt",
      requestId: crypto.randomUUID(),
      documentIds: [document.id],
    });
    expect(response.status).toBe(403);
    const connection = await connect(peer.cookie, workspaceId, chatId);
    await expect.poll(() => connection.drafts()).toEqual([]);
    expect(connection.payloads.join("")).not.toContain(
      "Never share this source",
    );
    connection.socket.close();
  });
});
