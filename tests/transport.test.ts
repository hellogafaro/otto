import type { Server } from "bun";
import { eq } from "drizzle-orm";
import { hc } from "hono/client";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { z } from "zod";
import type { RpcApp } from "../apps/server/src/api";
import { createApp } from "../apps/server/src/app";
import { createAuth } from "../apps/server/src/auth";
import { startQueue } from "../apps/server/src/queue";
import { createRealtime, type RealtimeData } from "../apps/server/src/realtime";
import { createChat, createMessage } from "../packages/chats/src";
import { createDocument, updateDocument } from "../packages/documents/src";
import { claimInstallation, inWorkspace } from "../packages/workspaces/src";
import { members } from "../packages/workspaces/src/schema";
import { pi } from "./fixtures/pi";
import { startPostgres } from "./postgres";

describe("authenticated HTTP RPC and WebSocket replay", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let boss: PgBoss;
  let server: Server<RealtimeData>;
  let realtime: ReturnType<typeof createRealtime>;
  let workspaceId: string;
  let chatId: string;
  let documentId: string;
  let userId: string;
  let cookie: string;
  let origin: string;
  let app: ReturnType<typeof createApp>;
  beforeAll(async () => {
    database = await startPostgres();
    boss = await startQueue(database.db, database.pool, {
      workers: false,
      install: true,
    });
    server = Bun.serve<RealtimeData>({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request, server) {
        if (new URL(request.url).pathname === "/api/realtime") {
          const data = await realtime.prepare(request);
          if (data instanceof Response) return data;
          if (server.upgrade(request, { data })) return;
          return new Response(null, { status: 400 });
        }
        return app.fetch(request);
      },
      websocket: {
        open(ws) {
          realtime.websocket.open(ws);
        },
        message(ws) {
          realtime.websocket.message(ws);
        },
        close(ws) {
          realtime.websocket.close(ws);
        },
      },
    });
    origin = `http://127.0.0.1:${server.port}`;
    const auth = createAuth(
      database.db,
      crypto.randomUUID() + crypto.randomUUID(),
      origin,
    );
    const options = { db: database.db, boss, auth, origin };
    app = createApp({ ...options, pi });
    realtime = createRealtime(options);
    const response = await fetch(`${origin}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        name: "Owner",
        email: "owner@example.test",
        password: crypto.randomUUID() + crypto.randomUUID(),
      }),
    });
    expect(response.status).toBe(200);
    cookie = response.headers.get("set-cookie") ?? "";
    const session = await auth.api.getSession({
      headers: new Headers({ cookie }),
    });
    userId = session?.user.id ?? "";
    workspaceId = (await claimInstallation(database.db, userId, "Live")).id;
    await inWorkspace(database.db, workspaceId, { userId }, async (c) => {
      chatId = (
        await createChat(c, {
          title: "Realtime",
          visibility: "workspace",
        })
      ).id;
      documentId = (
        await createDocument(c, {
          title: "Document",
          body: "before gap",
          visibility: "workspace",
        })
      ).id;
    });
  });
  afterAll(async () => {
    realtime?.close();
    await server?.stop(true);
    await boss?.stop();
    await database?.stop();
  });
  it("requires authentication and rejects invalid requests and foreign origins", async () => {
    expect((await fetch(`${origin}/api/workspaces`)).status).toBe(401);
    expect(
      (
        await fetch(`${origin}/api/workspaces/${workspaceId}/projects`, {
          method: "POST",
          headers: {
            Cookie: cookie,
            Origin: "http://attacker.test",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: "Wrong" }),
        })
      ).status,
    ).toBe(403);
    const client = hc<RpcApp>(`${origin}/api`, {
      headers: { Cookie: cookie, Origin: origin },
    });
    expect(
      (
        await client.workspaces[":workspaceId"].projects.$post({
          param: { workspaceId },
          json: { title: "" },
        })
      ).status,
    ).toBe(400);
    const response = await client.workspaces[":workspaceId"].projects.$post({
      param: { workspaceId },
      json: { title: "Live project" },
    });
    expect(response.status).toBe(200);
    const project = z
      .object({ id: z.uuid(), title: z.string() })
      .parse(await response.json());
    expect(project.title).toBe("Live project");
    const read = await client.workspaces[":workspaceId"].projects.$get({
      param: { workspaceId },
      query: {},
    });
    expect(await read.json()).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ id: project.id }),
      ]),
    });
  });
  const snapshot = z
    .object({
      type: z.literal("snapshot"),
      cursor: z.number(),
      messages: z.array(z.object({ body: z.string() })),
      activity: z.array(z.never()),
      views: z.object({ document: z.object({ body: z.string() }).optional() }),
      refreshCurrentViews: z.literal(true),
      runs: z.array(
        z
          .object({
            id: z.uuid(),
            chatId: z.uuid(),
            agentId: z.uuid(),
            taskId: z.uuid().nullable(),
            type: z.enum(["prompt", "script"]),
            state: z.string(),
            outcome: z.string().nullable(),
            cursor: z.number(),
            createdAt: z.string(),
          })
          .strict(),
      ),
    })
    .strict();
  function connect(after: number) {
    return new WebSocket(
      `${origin.replace("http", "ws")}/api/realtime?workspaceId=${workspaceId}&chatId=${chatId}&documentId=${documentId}&after=${after}`,
      { headers: { Cookie: cookie, Origin: origin } },
    );
  }
  function next(ws: WebSocket) {
    return new Promise<z.infer<typeof snapshot>>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("No WebSocket snapshot")),
        5000,
      );
      ws.addEventListener(
        "message",
        (event) => {
          clearTimeout(timer);
          try {
            resolve(snapshot.parse(JSON.parse(String(event.data))));
          } catch (error) {
            reject(error);
          }
        },
        { once: true },
      );
      ws.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(new Error("WebSocket failed"));
        },
        { once: true },
      );
    });
  }
  it("catches up saved messages and explicitly refreshes a current Document after a gap", async () => {
    const ws = connect(0);
    const first = await next(ws);
    ws.close();
    await inWorkspace(database.db, workspaceId, { userId }, async (c) => {
      await createMessage(c, chatId, {
        body: "during gap",
        requestId: crypto.randomUUID(),
      });
      await updateDocument(c, documentId, {
        title: "Document",
        body: "after gap",
        editToken: 0,
      });
    });
    const reconnected = connect(first.cursor);
    const replay = await next(reconnected);
    expect(replay.messages).toEqual([{ body: "during gap" }]);
    expect(replay.views.document?.body).toBe("after gap");
    expect(replay.refreshCurrentViews).toBe(true);
    reconnected.close();
  });
  it("serializes cursor allocation until commit so reconnect cannot skip an earlier uncommitted message", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const first = inWorkspace(
      database.db,
      workspaceId,
      { userId },
      async (c) => {
        await createMessage(c, chatId, {
          body: "transaction one",
          requestId: crypto.randomUUID(),
        });
        started();
        await held;
      },
    );
    await ready;
    const second = inWorkspace(database.db, workspaceId, { userId }, (c) =>
      createMessage(c, chatId, {
        body: "transaction two",
        requestId: crypto.randomUUID(),
      }),
    );
    release();
    await Promise.all([first, second]);
    const ws = connect(0);
    const replay = await next(ws);
    expect(replay.messages.slice(-2)).toEqual([
      { body: "transaction one" },
      { body: "transaction two" },
    ]);
    ws.close();
  });
  it("splits large saved history into bounded frames without losing the cursor", async () => {
    const prefix = "large-record-";
    await inWorkspace(database.db, workspaceId, { userId }, async (c) => {
      for (let index = 0; index < 15; index++)
        await createMessage(c, chatId, {
          body: `${prefix}${index}:${"x".repeat(90000)}`,
          requestId: crypto.randomUUID(),
        });
    });
    const ws = connect(0);
    let received = 0;
    try {
      for (let frame = 0; frame < 4 && received < 15; frame++) {
        const data = await next(ws);
        received += data.messages.filter((message) =>
          message.body.startsWith(prefix),
        ).length;
      }
      expect(received).toBe(15);
    } finally {
      ws.close();
    }
  });
  it("rejects the retired conversationId subscription field", async () => {
    const response = await realtime.prepare(
      new Request(
        `${origin}/api/realtime?workspaceId=${workspaceId}&conversationId=${chatId}`,
        { headers: { Cookie: cookie, Origin: origin } },
      ),
    );
    expect(response).toBeInstanceOf(Response);
    if (response instanceof Response)
      expect(response.status).toBeGreaterThanOrEqual(400);
  });
  it("revokes an open stream and rejects replay after membership removal", async () => {
    const ws = connect(0);
    await next(ws);
    const closed = new Promise<number>((resolve) =>
      ws.addEventListener("close", (event) => resolve(event.code), {
        once: true,
      }),
    );
    await database.db.delete(members).where(eq(members.userId, userId));
    expect(await closed).toBe(4403);
    const response = await realtime.prepare(
      new Request(
        `${origin}/api/realtime?workspaceId=${workspaceId}&chatId=${chatId}`,
        { headers: { Cookie: cookie, Origin: origin } },
      ),
    );
    expect(response).toBeInstanceOf(Response);
    if (response instanceof Response) expect(response.status).toBe(403);
  });
});
