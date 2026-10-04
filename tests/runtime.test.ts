import { DomainError } from "@otto/shared";
import type { Server } from "bun";
import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { z } from "zod";
import { createApp } from "../apps/server/src/app";
import { createAuth } from "../apps/server/src/auth";
import { createResendMail } from "../apps/server/src/mail";
import { startQueue } from "../apps/server/src/queue";
import { createRealtime, type RealtimeData } from "../apps/server/src/realtime";
import { readRunSkillFile } from "../apps/server/src/skill-files";
import { createRunTools } from "../apps/server/src/tools";
import { deleteParticipant } from "../packages/chats/src";
import { participants } from "../packages/chats/src/schema";
import { environments } from "../packages/environments/src/schema";
import { files } from "../packages/files/src/schema";
import { RUN_QUEUE } from "../packages/runs/src";
import {
  createRunRuntime,
  type RunRuntime,
  withRunAttempt,
} from "../packages/runs/src/runtime";
import { runs } from "../packages/runs/src/schema";
import { validateSchedule } from "../packages/schedules/src";
import { createSubscription } from "../packages/subscriptions/src";
import { subscriptions } from "../packages/subscriptions/src/schema";
import { claimInstallation, inWorkspace } from "../packages/workspaces/src";
import { members } from "../packages/workspaces/src/schema";
import { ControlledComputer } from "./fixtures/computer";
import { pi, piRuntime } from "./fixtures/pi";
import { fixtureStorage, testSpool } from "./fixtures/storage";
import { startPostgres } from "./postgres";

const transfers = await testSpool();

describe("HTTP to PostgreSQL queue to controlled Pi/computer runtime", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let boss: PgBoss;
  let worker: PgBoss;
  let runtime: RunRuntime;
  let computer: ControlledComputer;
  let server: Server<RealtimeData>;
  let realtime: ReturnType<typeof createRealtime>;
  let origin: string;
  let cookie: string;
  let mailSink: ReturnType<typeof Bun.serve>;
  let mail: ReturnType<typeof createResendMail>;
  const received: { to: string[]; text: string; subject: string }[] = [];
  async function createHuman(email: string) {
    const password = crypto.randomUUID() + crypto.randomUUID();
    const send = (path: string, body: unknown) =>
      fetch(`${origin}/api/auth/${path}`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    expect(
      (await send("sign-up/email", { name: email, email, password })).status,
    ).toBe(200);
    const url = received
      .find((m) => m.to[0] === email && m.subject === "Verify your Otto email")
      ?.text.split("Verify your email: ")[1];
    if (!url) throw new Error("Verification missing");
    expect((await fetch(url, { redirect: "manual" })).status).toBe(302);
    const login = await send("sign-in/email", { email, password });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie") ?? "";
    const session = await auth.api.getSession({
      headers: new Headers({ cookie }),
    });
    if (!session) throw new Error("Missing verified session");
    return { cookie, id: session.user.id, email };
  }
  const authSecret = crypto.randomUUID() + crypto.randomUUID();
  let workspaceId: string;
  let userId: string;
  let accountId: string;
  let app: ReturnType<typeof createApp>;
  let auth: ReturnType<typeof createAuth>;
  const objects = new Map<string, Uint8Array>();
  let afterPut: (() => Promise<void>) | undefined;
  const storage = fixtureStorage({
    async put(key, bytes) {
      objects.set(key, bytes.slice());
      await afterPut?.();
    },
    async get(key) {
      const bytes = objects.get(key);
      if (!bytes) throw new Error("Missing fixture bytes");
      return bytes.slice();
    },
  });
  const toolOptions: Parameters<typeof createRunTools>[2] = {
    storage,
    pi,
  };
  const record = z.object({ id: z.string() });
  async function post(path: string, value = {}, method = "POST") {
    const response = await fetch(
      `${origin}/api/workspaces/${workspaceId}${path}`,
      {
        method,
        headers: { cookie, origin, "Content-Type": "application/json" },
        body: JSON.stringify(value),
      },
    );
    if (!response.ok)
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    return response.json();
  }
  async function get(path: string) {
    return fetch(`${origin}/api/workspaces/${workspaceId}${path}`, {
      headers: { cookie },
    });
  }
  async function setup(
    body = "finish",
    type = "prompt",
    context: {
      skillIds?: string[];
      documentIds?: string[];
      projectId?: string;
      taskId?: string;
    } = {},
  ) {
    const { projectId, skillIds, ...selection } = context;
    const agent = z.object({ agent: record }).parse(
      await post("/agents", {
        visibility: "workspace",
        projectId,
        skillIds,
        title: "Fixture",
        instructions: "Work",
        model: "fixture",
        subscriptionId: accountId,
      }),
    ).agent;
    await post(`/agents/${agent.id}/computer`, { computerRef: agent.id });
    const chat = record.parse(
      await post("/chats", {
        title: "Runtime",
        visibility: "workspace",
        projectId,
      }),
    );
    await post(`/chats/${chat.id}/participants`, {
      agentId: agent.id,
      role: "contributor",
    });
    const input = {
      ...selection,
      agentId: agent.id,
      chatId: chat.id,
      requestId: crypto.randomUUID(),
      type,
      body,
    };
    const run = record.parse(await post("/runs", input));
    return { agent, chat, input, run };
  }
  const saved = async (id: string) =>
    (await database.db.select().from(runs).where(eq(runs.id, id)))[0];
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
    mailSink = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        received.push(
          z
            .object({
              to: z.array(z.string()),
              text: z.string(),
              subject: z.string(),
            })
            .parse(await request.json()),
        );
        return Response.json({ id: crypto.randomUUID() });
      },
    });
    const request: typeof fetch = Object.assign(
      (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
        fetch(mailSink.url, init),
      { preconnect: fetch.preconnect },
    );
    mail = createResendMail(
      { from: "otto@example.test", apiKey: crypto.randomUUID() },
      request,
    );
    auth = createAuth(database.db, authSecret, origin, mail);
    app = createApp({ pi, db: database.db, boss, auth, origin, mail });
    const owner = await createHuman("runtime@example.test");
    cookie = owner.cookie;
    userId = owner.id;
    workspaceId = (await claimInstallation(database.db, userId, "Runtime")).id;
    accountId = (
      await inWorkspace(database.db, workspaceId, { userId }, (c) =>
        createSubscription(c, {
          provider: "codex",
          title: "Fixture native account",
          visibility: "workspace",
        }),
      )
    ).id;
    // Controlled authenticated account datum; no live gateway/login qualification.
    await database.db
      .update(subscriptions)
      .set({ status: "enabled" })
      .where(eq(subscriptions.id, accountId));
    computer = new ControlledComputer(accountId);
    runtime = createRunRuntime(database.db, {
      ...piRuntime,
      backend: computer,
      pi,
      deadlineMs: 30000,
      validateSchedule,
      handleTool: createRunTools(database.db, boss, toolOptions),
      readSkillFile: (input) => readRunSkillFile(database.db, storage, input),
    });
    app = createApp({
      pi,
      db: database.db,
      boss,
      auth,
      origin,
      runtime,
      storage,
      spool: transfers.spool,
      mail,
    });
    realtime = createRealtime({
      db: database.db,
      boss,
      auth,
      origin,
      runtime,
      storage,
    });
    worker = await startQueue(database.db, database.pool, {
      runtime,
      pi,
    });
  });
  afterAll(async () => {
    await worker?.stop({ graceful: false });
    await computer?.close();
    await runtime?.close();
    await boss?.stop();
    realtime?.close();
    await server?.stop(true);
    await mailSink?.stop(true);
    await database?.stop();
  });
  it("executes admitted prompt and script through real workers and saves bounded authorized output", async () => {
    for (const type of ["prompt", "script"]) {
      const { input, run } = await setup("finish", type);
      await expect
        .poll(async () => (await saved(run.id))?.state, { timeout: 10000 })
        .toBe("finished");
      expect(record.parse(await post("/runs", input)).id).toBe(run.id);
      const activity = z
        .array(z.object({ body: z.string() }))
        .parse(await (await get(`/runs/${run.id}/activity`)).json());
      expect(activity.map((a) => a.body).join("")).toContain("fixture");
      const view = await (await get(`/runs/${run.id}`)).text();
      expect(view).not.toContain("contextRef");
      expect(view).not.toContain("inputs");
    }
    expect(computer.launches).toBe(2);
  });
  it("runs two Agents independently and targets steer/Stop without stopping the other", async () => {
    const a = await setup("hold");
    const b = await setup("hold");
    await expect
      .poll(
        async () => [
          (await saved(a.run.id))?.state,
          (await saved(b.run.id))?.state,
        ],
        { timeout: 10000 },
      )
      .toEqual(["running", "running"]);
    await expect
      .poll(
        async () =>
          z
            .array(z.object({ body: z.string() }))
            .parse(await (await get(`/runs/${a.run.id}/activity`)).json())
            .length,
      )
      .toBe(1);
    await post(`/runs/${a.run.id}/steer`, {
      requestId: crypto.randomUUID(),
      body: "adjust",
    });
    const startedAt = performance.now();
    const reads = Promise.all(
      Array.from({ length: 32 }, async () => {
        const start = performance.now();
        expect((await get(`/runs/${b.run.id}/activity`)).status).toBe(200);
        return performance.now() - start;
      }),
    );
    expect(await post(`/runs/${a.run.id}/stop`)).toEqual({ stopped: true });
    const stopMs = performance.now() - startedAt;
    const latencies = (await reads).sort((a, b) => a - b);
    expect(stopMs).toBeLessThan(10000);
    console.log(
      JSON.stringify({
        profile: "controlled-two-agent-32-reader",
        readCount: latencies.length,
        readP95Ms: latencies[30],
        stopMs,
        rssBytes: process.memoryUsage().rss,
      }),
    );
    expect((await saved(b.run.id))?.state).toBe("running");
    const row = await saved(b.run.id);
    if (!row) throw new Error("Missing Run");
    await expect(
      withRunAttempt(
        database.db,
        {
          runId: row.id,
          agentId: a.agent.id,
          attempt: row.attempt,
          launchKey: row.launchKey,
        },
        async () => true,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await post(`/runs/${b.run.id}/stop`);
  });
  it("fences a lost launch acknowledgement and reconciles without launching a duplicate", async () => {
    computer.loseNextAcknowledgement = true;
    const { run } = await setup("hold");
    await expect
      .poll(async () => (await saved(run.id))?.state, { timeout: 10000 })
      .toBe("uncertain");
    const launches = computer.launches;
    await runtime.dispatch(run.id);
    await runtime.reconcile(run.id);
    expect((await saved(run.id))?.state).toBe("interrupted");
    expect(computer.launches).toBe(launches);
  });
  it("invokes a scoped Otto message tool through Pi without accepting a browser Agent identity", async () => {
    const { run, chat, agent } = await setup(
      `_tool=${JSON.stringify({ name: "message.create", requestId: crypto.randomUUID(), body: "Scoped fixture message", agentId: crypto.randomUUID() })}`,
    );
    await expect
      .poll(async () => (await saved(run.id))?.state, { timeout: 10000 })
      .toBe("finished");
    const response = await get(`/chats/${chat.id}/messages`);
    const messages = z
      .array(
        z.object({
          body: z.string(),
          authorAgentId: z.string().nullable(),
          authorUserId: z.string().nullable(),
        }),
      )
      .parse(await response.json());
    expect(messages).toContainEqual(
      expect.objectContaining({
        body: "Scoped fixture message",
        authorAgentId: agent.id,
        authorUserId: null,
      }),
    );
  });
  it("exposes the scoped Chat read tool and rejects the retired Conversation tool name", async () => {
    const { run } = await setup("hold");
    await expect
      .poll(async () => (await saved(run.id))?.state, { timeout: 10000 })
      .toBe("running");
    const row = await saved(run.id);
    if (!row) throw new Error("Missing Run");
    const attempt = {
      runId: row.id,
      agentId: row.agentId,
      attempt: row.attempt,
      launchKey: row.launchKey,
    };
    const tools = createRunTools(database.db, boss);
    expect(Array.isArray(await tools(attempt, { name: "chat.read" }))).toBe(
      true,
    );
    await expect(
      tools(attempt, { name: "conversation.read" }),
    ).rejects.toMatchObject({ name: "ZodError" });
    await post(`/runs/${run.id}/stop`);
  });
  it("stops on permission revocation and rejects retained tool identities", async () => {
    const { run, agent, chat } = await setup("hold");
    await expect
      .poll(async () => (await saved(run.id))?.state, { timeout: 10000 })
      .toBe("running");
    const row = await saved(run.id);
    if (!row) throw new Error("Missing Run");
    await inWorkspace(database.db, workspaceId, { userId }, async (c) => {
      const participant = (
        await c.tx
          .select()
          .from(participants)
          .where(eq(participants.agentId, agent.id))
      )[0];
      if (!participant) throw new Error("Missing participant");
      await deleteParticipant(c, chat.id, participant.id);
    });
    await expect
      .poll(async () => (await saved(run.id))?.state)
      .toBe("interrupted");
    await expect(
      createRunTools(database.db, boss)(
        {
          runId: row.id,
          agentId: row.agentId,
          attempt: row.attempt,
          launchKey: row.launchKey,
        },
        {
          name: "message.create",
          requestId: crypto.randomUUID(),
          body: "denied",
        },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("bounds malformed/oversized Pi and rejects a missing managed bridge without success", async () => {
    await worker.stop({ graceful: false });
    const isolated = createRunRuntime(database.db, {
      ...piRuntime,
      backend: computer,
      pi,
      deadlineMs: 30000,
    });
    try {
      computer.bridgeReady = false;
      const unsupported = await setup("finish");
      await isolated.dispatch(unsupported.run.id);
      await expect
        .poll(async () => (await saved(unsupported.run.id))?.state, {
          timeout: 10000,
        })
        .toBe("interrupted");
      computer.bridgeReady = true;
      const oversized = await setup("oversized");
      await isolated.dispatch(oversized.run.id);
      await expect
        .poll(async () => (await saved(oversized.run.id))?.state, {
          timeout: 10000,
        })
        .toBe("uncertain");
      expect((await saved(oversized.run.id))?.outputBytes).toBeLessThanOrEqual(
        1048576,
      );
    } finally {
      computer.bridgeReady = true;
      await expect(isolated.close()).rejects.toThrow(
        "Runtime persistence/cleanup failed",
      );
      worker = await startQueue(database.db, database.pool, { runtime, pi });
    }
  });
  it("routes a Pi peer request to a second Agent through atomic admission and the real worker", async () => {
    const makeAgent = async () => {
      const agent = z.object({ agent: record }).parse(
        await post("/agents", {
          visibility: "workspace",
          title: "Peer",
          instructions: "Work",
          model: "fixture",
          subscriptionId: accountId,
        }),
      ).agent;
      await post(`/agents/${agent.id}/computer`, { computerRef: agent.id });
      return agent;
    };
    const sender = await makeAgent();
    const receiver = await makeAgent();
    const chat = record.parse(
      await post("/chats", { title: "Peers", visibility: "workspace" }),
    );
    for (const agent of [sender, receiver])
      await post(`/chats/${chat.id}/participants`, {
        agentId: agent.id,
        role: "contributor",
      });
    const parent = record.parse(
      await post("/runs", {
        chatId: chat.id,
        agentId: sender.id,
        requestId: crypto.randomUUID(),
        type: "prompt",
        body: `_tool=${JSON.stringify({ name: "agent.request", requestId: crypto.randomUUID(), agentId: receiver.id, body: "finish" })}`,
      }),
    );
    await expect
      .poll(async () => (await saved(parent.id))?.state, { timeout: 10000 })
      .toBe("finished");
    const children = await database.db
      .select()
      .from(runs)
      .where(eq(runs.parentRunId, parent.id));
    expect(children).toHaveLength(1);
    const child = children[0];
    if (!child) throw new Error("Missing child");
    expect(child.agentId).toBe(receiver.id);
    expect(child.handoffDepth).toBe(1);
    await expect
      .poll(async () => (await saved(child.id))?.state, { timeout: 10000 })
      .toBe("finished");
    const launches = computer.launches;
    await runtime.dispatch(child.id);
    expect(computer.launches).toBe(launches);
  });
  it("streams persisted output and catches up after a WebSocket gap through current authorization", async () => {
    const { run, chat } = await setup("hold");
    await expect
      .poll(async () => (await saved(run.id))?.state, { timeout: 10000 })
      .toBe("running");
    await expect
      .poll(async () =>
        z
          .array(z.object({ body: z.string() }))
          .parse(await (await get(`/runs/${run.id}/activity`)).json())
          .some((item) => item.body === "fixture output"),
      )
      .toBe(true);
    const frameSchema = z.object({
      cursor: z.number(),
      activity: z.array(z.object({ body: z.string(), cursor: z.number() })),
      refreshCurrentViews: z.literal(true),
    });
    const readFrame = async (after: number) => {
      const ws = new WebSocket(
        `${origin.replace("http:", "ws:")}/api/realtime?workspaceId=${workspaceId}&chatId=${chat.id}&runId=${run.id}&after=${after}`,
        { headers: { cookie, origin } },
      );
      try {
        return await new Promise<z.infer<typeof frameSchema>>(
          (resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error("WebSocket deadline")),
              5000,
            );
            ws.once("message", (data) => {
              clearTimeout(timer);
              try {
                resolve(frameSchema.parse(JSON.parse(data.toString())));
              } catch (e) {
                reject(e);
              }
            });
            ws.once("error", (error) => {
              clearTimeout(timer);
              reject(error);
            });
          },
        );
      } finally {
        ws.close();
      }
    };
    const first = await readFrame(0);
    expect(first.activity.some((a) => a.body === "fixture output")).toBe(true);
    await post(`/runs/${run.id}/steer`, {
      requestId: crypto.randomUUID(),
      body: "Gap control",
    });
    const catchup = await readFrame(first.cursor);
    expect(catchup.activity.some((a) => a.body === "Gap control")).toBe(true);
    expect(catchup.activity.every((a) => a.cursor > first.cursor)).toBe(true);
    await post(`/runs/${run.id}/stop`);
  });
  it("executes a scoped MCP write only after exact human approval through HTTP and Pi", async () => {
    let writes = 0;
    const mcp = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        if (request.method === "DELETE")
          return new Response(null, { status: 200 });
        const rpc = z
          .object({
            id: z.number().optional(),
            method: z.string(),
            params: z.unknown().optional(),
          })
          .parse(await request.json());
        if (!rpc.id) return new Response(null, { status: 202 });
        const result =
          rpc.method === "initialize"
            ? {
                protocolVersion: "2025-11-25",
                capabilities: { tools: {}, resources: {} },
                serverInfo: { name: "controlled-mcp", version: "1" },
              }
            : rpc.method === "tools/list"
              ? {
                  tools: [
                    {
                      name: "write",
                      inputSchema: {
                        type: "object",
                        properties: { target: { type: "string" } },
                      },
                    },
                  ],
                }
              : rpc.method === "resources/list"
                ? { resources: [{ uri: "repo:one", name: "Repository" }] }
                : {
                    content: [{ type: "text", text: "controlled MCP result" }],
                  };
        if (rpc.method === "tools/call") writes++;
        return Response.json(
          { jsonrpc: "2.0", id: rpc.id, result },
          { headers: { "mcp-session-id": "controlled-session" } },
        );
      },
    });
    toolOptions.connections = {
      secrets: { resolve: async () => "controlled-fixture-only" },
      http: { allowedOrigins: [mcp.url.origin], allowLoopbackHttp: true },
    };
    app = createApp({
      pi,
      db: database.db,
      boss,
      auth,
      origin,
      runtime,
      connections: toolOptions.connections,
    });
    const maintainer = await createHuman("mcp-maintainer@example.test");
    await database.db
      .insert(members)
      .values({ workspaceId, userId: maintainer.id, role: "contributor" });
    async function manage(path: string, body: unknown = {}, method = "POST") {
      const response = await fetch(
        `${origin}/api/workspaces/${workspaceId}${path}`,
        {
          method,
          headers: {
            cookie: maintainer.cookie,
            origin,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
      expect(response.status, await response.clone().text()).toBe(200);
      return response.json();
    }
    try {
      const agent = z.object({ agent: record }).parse(
        await post("/agents", {
          visibility: "workspace",
          title: "Connected",
          instructions: "Work",
          model: "fixture",
          subscriptionId: accountId,
        }),
      ).agent;
      await post(`/agents/${agent.id}/computer`, { computerRef: agent.id });
      const chat = record.parse(
        await post("/chats", {
          title: "External result",
          visibility: "workspace",
        }),
      );
      await post(`/chats/${chat.id}/participants`, {
        agentId: agent.id,
        role: "contributor",
      });
      const connection = record.parse(
        await manage("/connections", {
          visibility: "workspace",
          title: "MCP fixture",
          type: "mcp",
          accountRef: "controlled-account",
        }),
      );
      const patch = await fetch(
        `${origin}/api/workspaces/${workspaceId}/connections/${connection.id}`,
        {
          method: "PATCH",
          headers: {
            cookie: maintainer.cookie,
            origin,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            title: "MCP fixture",
            editToken: 0,
            credentialRef: "controlled-reference",
            config: {
              type: "mcp",
              endpoint: mcp.url.href,
              tools: [
                { name: "write", targetArgument: "target", readOnly: false },
              ],
              resources: ["repo:one"],
            },
          }),
        },
      );
      expect(patch.status).toBe(200);
      await manage(`/connections/${connection.id}/connect`);
      const grant = {
        agentId: agent.id,
        audience: { humans: [userId, maintainer.id], agents: [agent.id] },
        resources: ["repo:one"],
        operations: { "tool.write": "confirmation" },
      };
      await manage(`/connections/${connection.id}/grants`, grant);
      const start = () =>
        post("/runs", {
          chatId: chat.id,
          agentId: agent.id,
          requestId: crypto.randomUUID(),
          type: "prompt",
          body: `_tool=${JSON.stringify({ name: "connection.request", connectionId: connection.id, requestId: crypto.randomUUID(), action: "tool.write", target: "repo:one", arguments: { target: "repo:one" } })}`,
        });
      const run = record.parse(await start());
      const operations = z.object({
        items: z.array(
          z.object({
            id: z.uuid(),
            runId: z.uuid(),
            identity: z.string(),
            state: z.string(),
          }),
        ),
        next: z.string().nullable(),
      });
      let pending: { id: string; identity: string } | undefined;
      await expect
        .poll(
          async () => {
            pending = operations
              .parse(
                await (
                  await get(
                    `/connections/${connection.id}/operations?state=awaiting_approval`,
                  )
                ).json(),
              )
              .items.find((o) => o.runId === run.id);
            return Boolean(pending);
          },
          { timeout: 10000 },
        )
        .toBe(true);
      if (!pending) throw new Error("Missing pending approval");
      expect(writes).toBe(0);
      const steerStarted = performance.now();
      await post(`/runs/${run.id}/steer`, {
        body: "Keep waiting for this exact approval",
        requestId: crypto.randomUUID(),
      });
      expect(performance.now() - steerStarted).toBeLessThan(5000);
      expect(writes).toBe(0);
      const wrong = await fetch(
        `${origin}/api/workspaces/${workspaceId}/operations/${pending.id}/approve`,
        {
          method: "POST",
          headers: { cookie, origin, "content-type": "application/json" },
          body: JSON.stringify({ identity: "0".repeat(64) }),
        },
      );
      expect(wrong.status).toBe(409);
      await post(`/operations/${pending.id}/approve`, {
        identity: pending.identity,
      });
      await expect
        .poll(async () => (await saved(run.id))?.state, { timeout: 10000 })
        .toBe("finished");
      expect(writes).toBe(1);
      expect(await (await get(`/chats/${chat.id}/messages`)).text()).toContain(
        "controlled MCP result",
      );
      expect(
        await (await get(`/connections/${connection.id}`)).text(),
      ).not.toContain("credentialRef");
      const second = record.parse(await start());
      await expect
        .poll(
          async () => {
            pending = operations
              .parse(
                await (
                  await get(
                    `/connections/${connection.id}/operations?state=awaiting_approval`,
                  )
                ).json(),
              )
              .items.find((o) => o.runId === second.id);
            return Boolean(pending);
          },
          { timeout: 10000 },
        )
        .toBe(true);
      if (!pending) throw new Error("Missing second approval");
      // A current policy downgrade cannot widen the already accepted Run's full grant snapshot.
      await manage(`/connections/${connection.id}/grants`, {
        ...grant,
        operations: { "tool.write": "allowed" },
      });
      const stale = await fetch(
        `${origin}/api/workspaces/${workspaceId}/operations/${pending.id}/approve`,
        {
          method: "POST",
          headers: { cookie, origin, "content-type": "application/json" },
          body: JSON.stringify({ identity: pending.identity }),
        },
      );
      expect([403, 409]).toContain(stale.status);
      await expect
        .poll(async () => (await saved(second.id))?.state)
        .toBe("interrupted");
      expect(writes).toBe(1);
    } finally {
      await mcp.stop(true);
      await database.db
        .delete(members)
        .where(eq(members.userId, maintainer.id));
      delete toolOptions.connections;
      app = createApp({
        pi,
        db: database.db,
        boss,
        auth,
        origin,
        runtime,
        storage,
        spool: transfers.spool,
      });
    }
  });
  it("serializes busy Environment delivery and completes the accepted second Run", async () => {
    const first = await setup("hold");
    await expect
      .poll(async () => (await saved(first.run.id))?.state, { timeout: 10000 })
      .toBe("running");
    const second = record.parse(
      await post("/runs", {
        ...first.input,
        requestId: crypto.randomUUID(),
        body: "finish",
      }),
    );
    await expect(runtime.dispatch(second.id)).rejects.toMatchObject({
      code: "unavailable",
    });
    expect((await saved(second.id))?.state).toBe("queued");
    const activeLaunches = computer.launches;
    await post(`/runs/${first.run.id}/stop`);
    await expect
      .poll(async () => (await saved(second.id))?.state, { timeout: 15000 })
      .toBe("finished");
    expect(computer.launches).toBe(activeLaunches + 1);
  });
  it("loads private Session history without republishing it as new shared output", async () => {
    const first = await setup("finish");
    await expect
      .poll(async () => (await saved(first.run.id))?.state, { timeout: 10000 })
      .toBe("finished");
    const sessionId = (await saved(first.run.id))?.sessionId;
    computer.replayOnLoad = true;
    try {
      const second = record.parse(
        await post("/runs", {
          ...first.input,
          requestId: crypto.randomUUID(),
          sessionId,
        }),
      );
      await expect
        .poll(async () => (await saved(second.id))?.state, { timeout: 10000 })
        .toBe("finished");
      const activity = await (await get(`/runs/${second.id}/activity`)).text();
      expect(activity).toContain("fixture output");
      expect(activity).not.toContain("PRIVATE NATIVE HISTORY");
    } finally {
      computer.replayOnLoad = false;
    }
  });
  it("reconciles a server restart through the worker without relaunching its execution", async () => {
    const first = await setup("hold");
    await expect
      .poll(async () => (await saved(first.run.id))?.state, { timeout: 10000 })
      .toBe("running");
    await worker.stop({ graceful: false });
    await runtime.close();
    const launches = computer.launches;
    runtime = createRunRuntime(database.db, {
      ...piRuntime,
      backend: computer,
      pi,
      deadlineMs: 30000,
      validateSchedule,
      handleTool: createRunTools(database.db, boss, toolOptions),
      readSkillFile: (input) => readRunSkillFile(database.db, storage, input),
    });
    // Existing app closures are replaced exactly as a restarted process constructs them.
    auth = createAuth(database.db, authSecret, origin, mail);
    app = createApp({
      pi,
      db: database.db,
      boss,
      auth,
      origin,
      runtime,
      storage,
      spool: transfers.spool,
      mail,
    });
    realtime = createRealtime({
      db: database.db,
      boss,
      auth,
      origin,
      runtime,
      storage,
    });
    worker = await startQueue(database.db, database.pool, {
      runtime,
      pi,
    });
    expect((await saved(first.run.id))?.state).toBe("interrupted");
    expect(computer.launches).toBe(launches);
    const next = await setup("finish");
    await expect
      .poll(async () => (await saved(next.run.id))?.state, { timeout: 10000 })
      .toBe("finished");
  });
  it("materializes accepted immutable skill files and publishes an agent File through the trusted runtime", async () => {
    const reader = await createHuman("runtime-reader@example.test");
    const invitation = record.parse(
      await post("/invitations", { email: reader.email, role: "viewer" }),
    );
    expect(
      (
        await fetch(`${origin}/api/invitations/${invitation.id}/accept`, {
          method: "POST",
          headers: { cookie: reader.cookie, origin },
        })
      ).status,
    ).toBe(200);
    const project = record.parse(
      await post("/projects", { title: "Combined backend proof" }),
    );
    await post(`/projects/${project.id}/members`, {
      userId: reader.id,
      role: "viewer",
    });
    const task = record.parse(
      await post("/tasks", {
        projectId: project.id,
        title: "Produce reviewed output",
      }),
    );
    const file = record.parse(
      await post("/files", {
        requestId: crypto.randomUUID(),
        projectId: project.id,
        title: "Reference",
        type: "text",
        visibility: "workspace",
        mediaType: "text/plain",
        bytes: Buffer.from("saved supporting bytes").toString("base64"),
      }),
    );
    const skill = record.parse(
      await post("/skills", {
        projectId: project.id,
        title: "Accepted skill files",
        instructions: "saved skill instructions",
        visibility: "workspace",
      }),
    );
    const selected = record.parse(
      await post("/documents", {
        projectId: project.id,
        title: "Selected context",
        body: "saved selected context",
        visibility: "workspace",
      }),
    );
    const filesResponse = await fetch(
      `${origin}/api/workspaces/${workspaceId}/skills/${skill.id}/files`,
      {
        method: "PUT",
        headers: { cookie, origin, "content-type": "application/json" },
        body: JSON.stringify({
          editToken: 0,
          files: [{ path: "references/example.txt", fileId: file.id }],
        }),
      },
    );
    expect(filesResponse.status).toBe(200);
    await worker.stop({ graceful: false });
    const request = {
      name: "file.create",
      requestId: crypto.randomUUID(),
      title: "Agent result",
      type: "text",
      visibility: "workspace",
      mediaType: "text/plain",
      text: "saved agent output",
    };
    const { run } = await setup(`_tool=${JSON.stringify(request)}`, "prompt", {
      projectId: project.id,
      taskId: task.id,
      skillIds: [skill.id],
      documentIds: [selected.id],
    });
    await post(
      `/skills/${skill.id}`,
      {
        title: "Changed",
        instructions: "later skill content",
        editToken: 1,
      },
      "PATCH",
    );
    await post(
      `/documents/${selected.id}`,
      {
        title: "Changed",
        body: "later context",
        editToken: 0,
      },
      "PATCH",
    );
    worker = await startQueue(database.db, database.pool, {
      runtime,
      pi,
    });
    await expect
      .poll(async () => (await saved(run.id))?.state, { timeout: 10000 })
      .toBe("finished");
    const accepted = await saved(run.id);
    expect(accepted?.taskId).toBe(task.id);
    expect(accepted?.inputs.skills[0]?.instructions).toBe(
      "saved skill instructions",
    );
    expect(accepted?.inputs.context?.documents[0]?.body).toBe(
      "saved selected context",
    );
    const launch = computer.inputs.find(
      (input) => input.launchKey === accepted?.launchKey,
    );
    expect(
      launch?.files.map((f) => ({
        path: f.path,
        text: new TextDecoder().decode(f.bytes),
      })),
    ).toContainEqual({
      path: `skills/${skill.id}/references/example.txt`,
      text: "saved supporting bytes",
    });
    expect(
      launch?.files.find((f) => f.path.endsWith("SKILL.md"))?.bytes,
    ).toBeDefined();
    const receipt = record.parse(computer.toolResults.at(-1));
    expect(await (await get(`/files/${receipt.id}/file`)).text()).toBe(
      "saved agent output",
    );
    expect(await (await get(`/files/${receipt.id}`)).json()).toMatchObject({
      sourceRunId: run.id,
      creatorAgentId: accepted?.agentId,
    });
    const share = record.parse(
      await post("/shares/preview", {
        selection: {
          type: "file",
          targetId: receipt.id,
          includeFile: true,
        },
      }),
    );
    await post(`/shares/${share.id}/publish`, { editToken: 0 });
    expect(
      await (await fetch(`${origin}/api/shares/${share.id}/file`)).text(),
    ).toBe("saved agent output");
    await post(`/shares/${share.id}/revoke`);
    expect((await fetch(`${origin}/api/shares/${share.id}/file`)).status).toBe(
      404,
    );
    const download = () =>
      fetch(
        `${origin}/api/workspaces/${workspaceId}/files/${receipt.id}/file`,
        { headers: { cookie: reader.cookie } },
      );
    expect(await (await download()).text()).toBe("saved agent output");
    expect(
      (
        await fetch(
          `${origin}/api/workspaces/${workspaceId}/members/${reader.id}`,
          { method: "DELETE", headers: { cookie, origin } },
        )
      ).status,
    ).toBe(200);
    expect((await download()).status).toBe(403);
  });
  it("withholds agent File publication when Stop commits during storage I/O", async () => {
    const request = {
      name: "file.create",
      requestId: crypto.randomUUID(),
      title: "Stopped output",
      type: "text",
      visibility: "workspace",
      mediaType: "text/plain",
      text: "must not publish",
    };
    await worker.stop({ graceful: false });
    const { run } = await setup(`_tool=${JSON.stringify(request)}`);
    let stopResponse: Promise<unknown> | undefined;
    afterPut = async () => {
      stopResponse = post(`/runs/${run.id}/stop`);
      // Observe immediately; the response is asserted below after storage returns.
      void stopResponse.catch(() => {});
      await expect
        .poll(async () => (await saved(run.id))?.stopRequested)
        .toBe(true);
    };
    try {
      worker = await startQueue(database.db, database.pool, {
        runtime,
        pi,
      });
      await expect
        .poll(async () => (await saved(run.id))?.state, { timeout: 10000 })
        .toBe("interrupted");
      const library = z
        .object({
          items: z.array(z.object({ title: z.string() })),
        })
        .parse(await (await get("/files")).json());
      expect(
        library.items.some((item) => item.title === "Stopped output"),
      ).toBe(false);
      const [intent] = await database.db
        .select()
        .from(files)
        .where(eq(files.requestId, request.requestId));
      expect(intent?.state).toBe("pending");
      expect((await get(`/files/${intent?.id}`)).status).toBe(404);
      expect(await stopResponse).toEqual({ stopped: true });
    } finally {
      afterPut = undefined;
      await stopResponse;
    }
  });
  it("persists final usage once on exact replay and denies unauthorized aggregate reads", async () => {
    computer.usageReplay = "same";
    try {
      const { run } = await setup("finish");
      await expect
        .poll(async () => (await saved(run.id))?.state, { timeout: 10000 })
        .toBe("finished");
      expect((await saved(run.id))?.usage).toHaveLength(1);
      expect(await (await get(`/runs/${run.id}/usage`)).json()).toMatchObject({
        provider: "codex",
        model: "fixture",
        complete: true,
        messageCount: 1,
        inputTokens: 10,
        outputTokens: 2,
        totalTokens: 12,
      });
      const outsider = await createHuman("usage-outsider@example.test");
      const response = await fetch(
        `${origin}/api/workspaces/${workspaceId}/runs/${run.id}/usage`,
        {
          headers: { cookie: outsider.cookie },
        },
      );
      expect(response.status).toBe(403);
      expect((await saved(run.id))?.usage).toHaveLength(1);
    } finally {
      computer.usageReplay = "none";
    }
  });
  it("rejects conflicting native replay without publishing altered usage", async () => {
    await worker.stop({ graceful: false });
    computer.usageReplay = "changed";
    const isolated = createRunRuntime(database.db, {
      ...piRuntime,
      backend: computer,
      pi,
    });
    try {
      const { run } = await setup("finish");
      await isolated.dispatch(run.id);
      await expect.poll(() => isolated.health().active).toBe(0);
      const receipts = (await saved(run.id))?.usage ?? [];
      // Protocol failure may precede the first DB commit. It must never commit
      // the conflicting counters or count the same message twice.
      expect(receipts.length).toBeLessThanOrEqual(1);
      expect(
        receipts.every((receipt) => receipt.tokens.totalTokens === 12),
      ).toBe(true);
      expect((await saved(run.id))?.state).toBe("uncertain");
      const jobs = await boss.findJobs(RUN_QUEUE, { data: { runId: run.id } });
      if (jobs.length)
        await boss.cancel(
          RUN_QUEUE,
          jobs.map((job) => job.id),
        );
    } finally {
      computer.usageReplay = "none";
      await expect(isolated.close()).rejects.toThrow(
        "Runtime persistence/cleanup failed",
      );
      worker = await startQueue(database.db, database.pool, { runtime, pi });
    }
  });
  it("Stops during Pi startup without poisoning sibling execution", async () => {
    await worker.stop({ graceful: false });
    const isolated = createRunRuntime(database.db, {
      ...piRuntime,
      backend: computer,
      pi,
    });
    try {
      const first = await setup("hold");
      await isolated.dispatch(first.run.id);
      expect(
        await isolated.stop(workspaceId, { userId }, first.run.id),
      ).toEqual({ stopped: true });
      await expect.poll(() => isolated.health().active).toBe(0);
      expect(isolated.health().persistenceErrors).toBe(0);
      const sibling = await setup("finish");
      await isolated.dispatch(sibling.run.id);
      await expect
        .poll(async () => (await saved(sibling.run.id))?.state)
        .toBe("finished");
      for (const { run } of [first, sibling]) {
        const jobs = await boss.findJobs(RUN_QUEUE, {
          data: { runId: run.id },
        });
        if (jobs.length)
          await boss.cancel(
            RUN_QUEUE,
            jobs.map((job) => job.id),
          );
      }
    } finally {
      await isolated.close();
      worker = await startQueue(database.db, database.pool, { runtime, pi });
    }
  });
  it("bounds simultaneous pending computer launches before external I/O", async () => {
    await worker.stop({ graceful: false });
    const admitted = [];
    for (let index = 0; index < 17; index++) admitted.push(await setup("hold"));
    let release: () => void = () => {};
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = 0;
    computer.beforeInspect = async () => {
      entered++;
      await barrier;
    };
    const dispatches = admitted.map(({ run }) => runtime.dispatch(run.id));
    const results = Promise.allSettled(dispatches);
    try {
      await expect
        .poll(() => entered, { timeout: 10000 })
        .toBeGreaterThanOrEqual(16);
      // Let all submitted dispatches reach their claimed launch boundary.
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(entered).toBe(16);
    } finally {
      release();
      computer.beforeInspect = undefined;
      const dispatched = await results;
      // Launch admission returns before the protocol handshake. Wait for the
      // controlled pending prompts before exercising their normal Stop cleanup.
      for (const [index, { run }] of admitted.entries())
        if (dispatched[index]?.status === "fulfilled")
          await expect
            .poll(async () => (await saved(run.id))?.outputBytes ?? 0, {
              timeout: 10000,
            })
            .toBeGreaterThan(0);
      for (const { run } of admitted) await post(`/runs/${run.id}/stop`);
      // These Runs were dispatched directly while their queue worker was stopped.
      // Cancel only their now-terminal fixture jobs before restarting that worker.
      for (const { run } of admitted) {
        const record = await saved(run.id);
        expect(["interrupted", "failed"]).toContain(record?.state);
        const jobs = await boss.findJobs(RUN_QUEUE, {
          data: { runId: run.id },
        });
        if (jobs.length)
          await boss.cancel(
            RUN_QUEUE,
            jobs.map((job) => job.id),
          );
      }
      worker = await startQueue(database.db, database.pool, {
        runtime,
        pi,
      });
    }
  });
  it("waits for an authorized human answer through saved activity and resumes the same Pi Run", async () => {
    const request = {
      name: "human.ask",
      requestId: crypto.randomUUID(),
      body: "Which destination?",
    };
    const { run } = await setup(`_tool=${JSON.stringify(request)}`);
    let questionId = "";
    await expect
      .poll(
        async () => {
          const activity = z
            .array(
              z.object({ id: z.string(), type: z.string(), body: z.string() }),
            )
            .parse(await (await get(`/runs/${run.id}/activity`)).json());
          questionId =
            activity.find((item) => item.type === "question")?.id ?? "";
          return questionId;
        },
        { timeout: 10000 },
      )
      .not.toBe("");
    const attention = z
      .object({
        questions: z.object({ items: z.array(z.object({ id: z.string() })) }),
      })
      .parse(await (await get("/attention")).json());
    expect(
      attention.questions.items.some((item) => item.id === questionId),
    ).toBe(true);
    const anonymous = await fetch(
      `${origin}/api/workspaces/${workspaceId}/questions/${questionId}/answer`,
      {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ body: "wrong" }),
      },
    );
    expect(anonymous.status).toBe(401);
    const steerStarted = performance.now();
    await post(`/runs/${run.id}/steer`, {
      body: "Keep waiting for the authorized answer",
      requestId: crypto.randomUUID(),
    });
    expect(performance.now() - steerStarted).toBeLessThan(5000);
    await post(`/questions/${questionId}/answer`, {
      body: "Use the approved destination",
    });
    await expect
      .poll(async () => (await saved(run.id))?.state, { timeout: 10000 })
      .toBe("finished");
    expect(computer.toolResults.at(-1)).toEqual({
      answer: "Use the approved destination",
    });
    const answered = z
      .object({
        questions: z.object({ items: z.array(z.object({ id: z.string() })) }),
      })
      .parse(await (await get("/attention")).json());
    expect(
      answered.questions.items.some((item) => item.id === questionId),
    ).toBe(false);
    await post(`/questions/${questionId}/answer`, {
      body: "Use the approved destination",
    });
    const messages = z
      .array(z.object({ body: z.string() }))
      .parse(
        await (
          await get(`/chats/${(await saved(run.id))?.chatId}/messages`)
        ).json(),
      );
    expect(
      messages.filter((message) =>
        message.body.startsWith(`Answer ${questionId}:`),
      ),
    ).toHaveLength(1);
    const waiting = await setup(
      `_tool=${JSON.stringify({ ...request, requestId: crypto.randomUUID() })}`,
    );
    await expect
      .poll(
        async () =>
          z
            .array(z.object({ type: z.string() }))
            .parse(await (await get(`/runs/${waiting.run.id}/activity`)).json())
            .some((item) => item.type === "question"),
        { timeout: 10000 },
      )
      .toBe(true);
    const stopStarted = performance.now();
    expect(await post(`/runs/${waiting.run.id}/stop`)).toEqual({
      stopped: true,
    });
    expect(performance.now() - stopStarted).toBeLessThan(5000);
    expect((await saved(waiting.run.id))?.state).toBe("interrupted");
  });
  it("fires prompt and script Schedule occurrences through the real pg-boss clock", async () => {
    const records = [];
    for (const type of ["prompt", "script"]) {
      const { agent, chat, run } = await setup("finish", type);
      await expect
        .poll(async () => (await saved(run.id))?.state, { timeout: 10000 })
        .toBe("finished");
      const config = {
        title: `Clock ${type}`,
        agentId: agent.id,
        chatId: chat.id,
        type,
        body: "finish",
        cron: "* * * * *",
        timezone: type === "prompt" ? "Europe/Berlin" : "UTC",
        status: "enabled",
      };
      const schedule = record.parse(await post("/schedules", config));
      records.push({ schedule, config });
    }
    try {
      for (const { schedule } of records) {
        await expect
          .poll(
            async () => {
              const history = z
                .object({
                  items: z.array(z.object({ runId: z.string().nullable() })),
                  next: z.string().nullable(),
                })
                .parse(
                  await (await get(`/schedules/${schedule.id}/history`)).json(),
                );
              for (const occurrence of history.items) {
                if (!occurrence.runId) continue;
                const run = z
                  .object({ state: z.string() })
                  .parse(await (await get(`/runs/${occurrence.runId}`)).json());
                if (run.state === "finished") return true;
              }
              return false;
            },
            { timeout: 100000, interval: 500 },
          )
          .toBe(true);
      }
    } finally {
      for (const { schedule, config } of records)
        await post(
          `/schedules/${schedule.id}`,
          {
            ...config,
            status: "disabled",
            editToken: 0,
          },
          "PATCH",
        );
    }
  }, 120000);
  it("archives launch sources and pauses Schedule without implicitly stopping active work", async () => {
    const project = record.parse(
      await post("/projects", { title: "Archive control" }),
    );
    const task = record.parse(
      await post("/tasks", { projectId: project.id, title: "Running work" }),
    );
    const agent = z.object({ agent: record }).parse(
      await post("/agents", {
        visibility: "workspace",
        title: "Archive worker",
        instructions: "Work",
        model: "fixture",
        projectId: project.id,
        subscriptionId: accountId,
      }),
    ).agent;
    await post(`/agents/${agent.id}/computer`, { computerRef: agent.id });
    const chat = record.parse(
      await post("/chats", {
        title: "Archive control",
        visibility: "workspace",
        projectId: project.id,
      }),
    );
    await post(`/chats/${chat.id}/participants`, {
      agentId: agent.id,
      role: "contributor",
    });
    const skill = record.parse(
      await post("/skills", {
        title: "Accepted skill",
        instructions: "Original accepted instructions",
        visibility: "workspace",

        projectId: project.id,
      }),
    );
    await post(
      `/agents/${agent.id}`,
      { skillIds: [skill.id], editToken: 0 },
      "PATCH",
    );
    const config = {
      title: "Running schedule",
      agentId: agent.id,
      chatId: chat.id,
      type: "prompt",
      body: "hold",
      taskId: task.id,
      timezone: "UTC",
      status: "enabled",
    };
    const schedule = record.parse(await post("/schedules", config));
    const run = record.parse(
      await post(`/schedules/${schedule.id}/run`, {
        requestId: crypto.randomUUID(),
      }),
    );
    await expect
      .poll(async () => (await saved(run.id))?.state, { timeout: 10000 })
      .toBe("running");
    await post(
      `/schedules/${schedule.id}`,
      {
        ...config,
        status: "disabled",
        editToken: 0,
      },
      "PATCH",
    );
    await post(`/skills/${skill.id}/archive`, {
      archived: true,
      editToken: 0,
    });
    await post(`/tasks/${task.id}/archive`, { archived: true, editToken: 0 });
    await post(`/chats/${chat.id}/archive`, {
      archived: true,
      editToken: 0,
    });
    await post(`/projects/${project.id}/archive`, { archived: true });
    const row = await saved(run.id);
    if (!row) throw new Error("Missing Run");
    await withRunAttempt(
      database.db,
      {
        runId: row.id,
        agentId: row.agentId,
        attempt: row.attempt,
        launchKey: row.launchKey,
      },
      async () => true,
      validateSchedule,
    );
    expect((await saved(run.id))?.state).toBe("running");
    const denied = await fetch(`${origin}/api/workspaces/${workspaceId}/runs`, {
      method: "POST",
      headers: { cookie, origin, "content-type": "application/json" },
      body: JSON.stringify({
        chatId: chat.id,
        agentId: agent.id,
        type: "prompt",
        body: "finish",
        requestId: crypto.randomUUID(),
      }),
    });
    expect(denied.status).toBe(409);
    await post(`/runs/${run.id}/steer`, {
      requestId: crypto.randomUUID(),
      body: "Still controlled",
    });
    await expect
      .poll(async () => {
        const activity = z
          .array(z.object({ body: z.string() }))
          .parse(await (await get(`/runs/${run.id}/activity`)).json());
        return activity.some(
          (item) => item.body === "fixture after steer: Still controlled",
        );
      })
      .toBe(true);
    expect(await post(`/runs/${run.id}/stop`)).toEqual({ stopped: true });
    for (const path of [
      `projects/${project.id}`,
      `chats/${chat.id}`,
      `tasks/${task.id}`,
      `skills/${skill.id}`,
    ])
      await post(`/${path}/archive`, { archived: false, editToken: 1 });
  });
  it("persists queued permission revocation without launch or endless retry", async () => {
    await worker.stop({ graceful: false });
    try {
      const { run, agent, chat } = await setup("hold");
      const launches = computer.launches;
      const admittedAt = (await saved(run.id))?.updatedAt;
      await inWorkspace(database.db, workspaceId, { userId }, async (c) => {
        const participant = (
          await c.tx
            .select()
            .from(participants)
            .where(eq(participants.agentId, agent.id))
        )[0];
        if (!participant) throw new Error("Missing participant");
        await deleteParticipant(c, chat.id, participant.id);
      });
      await runtime.dispatch(run.id);
      expect((await saved(run.id))?.state).toBe("failed");
      expect(computer.launches).toBe(launches);
      expect((await saved(run.id))?.updatedAt.getTime()).toBeGreaterThan(
        admittedAt?.getTime() ?? 0,
      );
    } finally {
      worker = await startQueue(database.db, database.pool, {
        runtime,
        pi,
      });
    }
  });
  it("releases other active computer handles when one runtime cleanup fails", async () => {
    await worker.stop({ graceful: false });
    const backend = new ControlledComputer(accountId);
    const local = createRunRuntime(database.db, {
      ...piRuntime,
      backend,
      pi,
      deadlineMs: 30000,
    });
    const first = await setup("hold");
    const second = await setup("hold");
    try {
      await local.dispatch(first.run.id);
      await local.dispatch(second.run.id);
      await expect.poll(() => local.health().active).toBe(2);
      backend.detachFailures.add(first.agent.id);
      await expect(local.close()).rejects.toBeInstanceOf(AggregateError);
      expect(new Set(backend.detached)).toEqual(
        new Set([first.agent.id, second.agent.id]),
      );
    } finally {
      // Test cleanup must finish even while reproducing the old short-circuit failure.
      await local.close().catch(() => {});
      for (const execution of backend.executions.values())
        await execution.process.stop();
      await local.reconcile(first.run.id);
      await local.reconcile(second.run.id);
      worker = await startQueue(database.db, database.pool, {
        runtime,
        pi,
      });
    }
  });
  it("refuses the legacy queue schema rather than starting a second empty queue", async () => {
    await database.pool.query("create schema otto_jobs");
    try {
      await expect(
        startQueue(database.db, database.pool, { workers: false }),
      ).rejects.toThrow("operator-reviewed queue migration");
    } finally {
      await database.pool.query("drop schema otto_jobs");
    }
  });
  for (const racing of ["close", "revocation"] as const)
    it(`preserves an actual receipt conflict during ${racing}`, async () => {
      await worker.stop({ graceful: false });
      let promptEntered: () => void = () => {};
      let promptRelease: () => void = () => {};
      let conflictEntered: () => void = () => {};
      let conflictRelease: () => void = () => {};
      const promptReady = new Promise<void>((resolve) => {
        promptEntered = resolve;
      });
      const promptGate = new Promise<void>((resolve) => {
        promptRelease = resolve;
      });
      const conflictReady = new Promise<void>((resolve) => {
        conflictEntered = resolve;
      });
      const conflictGate = new Promise<void>((resolve) => {
        conflictRelease = resolve;
      });
      let originalConflict = false;
      const backend = new ControlledComputer(accountId);
      const guarded = new Proxy(database.db, {
        get(target, key, receiver) {
          if (key === "transaction") {
            const transaction: typeof database.db.transaction = async (
              work,
              config,
            ) => {
              try {
                return await target.transaction(work, config);
              } catch (error) {
                if (
                  !originalConflict &&
                  error instanceof DomainError &&
                  error.code === "conflict"
                ) {
                  originalConflict = true;
                  conflictEntered();
                  // Pause after the real PostgreSQL publication conflict; later
                  // cancellation/authority must not change its original cause.
                  await conflictGate;
                }
                throw error;
              }
            };
            return transaction;
          }
          const value = Reflect.get(target, key, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const isolated = createRunRuntime(guarded, {
        ...piRuntime,
        pi,
        backend: {
          provider: backend.provider,
          inspectComputer: backend.inspectComputer.bind(backend),
          lookup: backend.lookup.bind(backend),
          async launch(input) {
            const process = await backend.launch(input);
            return {
              ...process,
              async write(bytes) {
                const message = z
                  .object({ type: z.string() })
                  .parse(JSON.parse(new TextDecoder().decode(bytes)));
                if (message.type === "prompt") {
                  promptEntered();
                  await promptGate;
                }
                return process.write(bytes);
              },
            };
          },
        },
      });
      let runId: string | undefined;
      let closing: Promise<{ rejected: boolean }> | undefined;
      const close = () =>
        isolated.close().then(
          () => ({ rejected: false }),
          () => ({ rejected: true }),
        );
      try {
        const { run } = await setup("finish");
        runId = run.id;
        await isolated.dispatch(run.id);
        await promptReady;
        const row = await saved(run.id);
        if (!row) throw new Error("Missing current attempt");
        const tokens = {
          inputTokens: 10,
          outputTokens: 3,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 13,
        };
        await database.db
          .update(runs)
          .set({ usage: [{ attempt: row.attempt, sequence: 1, tokens }] })
          .where(eq(runs.id, run.id));
        promptRelease();
        await conflictReady;
        if (racing === "close") {
          closing = close();
          await expect.poll(() => isolated.health().closing).toBe(true);
        } else {
          await post(
            `/subscriptions/${accountId}`,
            { status: "disabled" },
            "PATCH",
          );
          await expect
            .poll(() =>
              [...backend.executions.values()].every(
                (execution) => execution.exited,
              ),
            )
            .toBe(true);
        }
        conflictRelease();
        await expect
          .poll(() => isolated.health().active, { timeout: 10000 })
          .toBe(0);
        const state = await saved(run.id);
        expect(originalConflict).toBe(true);
        expect(state?.usage).toEqual([
          { attempt: row.attempt, sequence: 1, tokens },
        ]);
        expect(state?.state).toBe("uncertain");
        expect(state?.outcome).toBe("tool_cleanup_unconfirmed");
        expect(isolated.health().persistenceErrors).toBeGreaterThan(0);
        expect(await (closing ?? close())).toEqual({ rejected: true });
        const [environment] = await database.db
          .select()
          .from(environments)
          .where(eq(environments.agentId, row.agentId));
        expect(environment?.activeRunId).toBe(run.id);
        expect(environment?.state).toBe("uncertain");
      } finally {
        promptRelease();
        conflictRelease();
        await close();
        await backend.close();
        await database.db
          .update(subscriptions)
          .set({ status: "enabled" })
          .where(eq(subscriptions.id, accountId));
        if (runId) {
          const jobs = await boss.findJobs(RUN_QUEUE, { data: { runId } });
          if (jobs.length)
            await boss.cancel(
              RUN_QUEUE,
              jobs.map((job) => job.id),
            );
        }
        worker = await startQueue(database.db, database.pool, { runtime, pi });
      }
    });
});
