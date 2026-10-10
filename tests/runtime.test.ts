import type { Server } from "bun";
import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { z } from "zod";
import { createApp } from "../apps/server/src/app";
import { createAuth } from "../apps/server/src/auth";
import { createSmtpMail } from "../apps/server/src/mail";
import { startQueue } from "../apps/server/src/queue";
import { createRealtime, type RealtimeData } from "../apps/server/src/realtime";
import { authorizeRunSources } from "../apps/server/src/run-sources";
import {
  createNativeRunTools,
  createRunTools,
  effectRequestId,
} from "../apps/server/src/tools";
import { deleteParticipant, publishNativeMessage } from "../packages/chats/src";
import { participants } from "../packages/chats/src/schema";
import { files } from "../packages/files/src/schema";
import { RUN_QUEUE } from "../packages/runs/src";
import {
  assertRunAttempt,
  createRunRuntime,
  type RunRuntime,
  withRunAttempt,
} from "../packages/runs/src/runtime";
import { runActivity, runs } from "../packages/runs/src/schema";
import { validateSchedule } from "../packages/schedules/src";
import {
  openNativeStorage,
  saveNativeMessage,
} from "../packages/sessions/src/native";

import { claimInstallation, inWorkspace } from "../packages/workspaces/src";
import { members } from "../packages/workspaces/src/schema";
import {
  controlledModel,
  controlledSubscription,
  fixtureEncryptionKey,
  nativeModelAuthorization,
} from "./fixtures/native-model";
import { type SmtpMessage, startSmtp } from "./fixtures/smtp";
import { fixtureStorage, testSpool } from "./fixtures/storage";
import { startPostgres } from "./postgres";

const transfers = await testSpool();

describe("HTTP to PostgreSQL queue to deterministic native runtime", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let boss: PgBoss;
  let worker: PgBoss;
  let runtime: RunRuntime;
  let native: Awaited<ReturnType<typeof openNativeStorage>>;
  let modelStarts = 0;
  const observedResults: unknown[] = [];
  const prompts = new Map<string, unknown[]>();
  const fixtureTools = new Map<
    string,
    { name: string; [key: string]: unknown }
  >();
  let server: Server<RealtimeData>;
  let realtime: ReturnType<typeof createRealtime>;
  let origin: string;
  let cookie: string;
  let mailSink: Awaited<ReturnType<typeof startSmtp>>;
  let mail: ReturnType<typeof createSmtpMail>;
  let received: SmtpMessage[];
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
  let toolOptions: Parameters<typeof createRunTools>[2];
  const record = z.object({ id: z.string() });
  async function post(
    path: string,
    value: Record<string, unknown> = {},
    method = "POST",
  ) {
    const { fixtureTool, ...body } = value;
    if (fixtureTool !== undefined) {
      const tool = z
        .object({ name: z.string() })
        .catchall(z.unknown())
        .parse(fixtureTool);
      fixtureTools.set(z.string().parse(body.requestId), tool);
      body.body ??= "Controlled native tool request";
    }
    const response = await fetch(
      `${origin}/api/workspaces/${workspaceId}${path}`,
      {
        method,
        headers: { cookie, origin, "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
    body: string | { name: string; [key: string]: unknown } = "finish",
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
      body: typeof body === "string" ? body : "Controlled native tool request",
      ...(typeof body === "object" ? { fixtureTool: body } : {}),
    };
    const run = record.parse(await post("/runs", input));
    return { agent, chat, input, run };
  }
  const saved = async (id: string) =>
    (await database.db.select().from(runs).where(eq(runs.id, id)))[0];
  beforeAll(async () => {
    database = await startPostgres();
    native = await openNativeStorage({
      connectionString: `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`,
    });
    toolOptions = { storage, native, models: nativeModelAuthorization };
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
    mailSink = await startSmtp();
    received = mailSink.messages;
    mail = createSmtpMail({
      from: "otto@example.test",
      host: mailSink.host,
      port: mailSink.port,
      tls: "none",
    });
    auth = createAuth(database.db, authSecret, origin, mail);
    app = createApp({
      nativeStorage: native,
      modelAuthorization: nativeModelAuthorization,
      encryptionKey: fixtureEncryptionKey,
      db: database.db,
      boss,
      auth,
      origin,
      mail,
    });
    const owner = await createHuman("runtime@example.test");
    cookie = owner.cookie;
    userId = owner.id;
    workspaceId = (await claimInstallation(database.db, userId, "Runtime")).id;
    accountId = await inWorkspace(
      database.db,
      workspaceId,
      { userId },
      controlledSubscription,
    );
    runtime = createEngine();
    app = createApp({
      nativeStorage: native,
      modelAuthorization: nativeModelAuthorization,
      encryptionKey: fixtureEncryptionKey,
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
      nativeStorage: native,
    });
    worker = await startQueue(database.db, database.pool, {
      runtime,
      nativeStorage: native,
      modelAuthorization: nativeModelAuthorization,
    });
  });
  afterAll(async () => {
    await worker?.stop({ graceful: false });

    await runtime?.close();
    await native?.close();
    await boss?.stop();
    realtime?.close();
    await server?.stop(true);
    try {
      await mailSink?.close();
    } finally {
      await database?.stop();
    }
  });
  async function nativeHistory(id: string) {
    const row = await saved(id);
    if (!row?.sessionId) throw new Error("Missing native Session");
    const memory = await native.storage.getStore("memory");
    if (!memory) throw new Error("Missing native memory");
    return (
      await memory.listMessages({
        threadId: row.sessionId,
        resourceId: workspaceId,
        perPage: 100,
        page: 0,
      })
    ).messages;
  }
  function createEngine(
    overrides: Partial<Parameters<typeof createRunRuntime>[1]> = {},
  ) {
    return createRunRuntime(database.db, {
      storage: native,
      deadlineMs: 30000,
      validateSchedule,
      authorizeSources: authorizeRunSources,
      resolveModel: async (attempt, signal) => {
        modelStarts++;
        const row = await saved(attempt.runId);
        if (!row) throw new Error("Missing run");
        const {
          name,
          requestId: _requestId,
          ...input
        } = fixtureTools.get(row.requestId) ?? {
          name: "",
          requestId: undefined,
        };
        const skill = row.inputs.skills[0];
        const supportingFile = skill?.supportingFiles?.[0];
        return controlledModel({
          signal,
          hold: row.inputs.body === "hold",
          text: "fixture output",
          onPrompt: (prompt) => {
            const values = prompts.get(row.id) ?? [];
            values.push(prompt);
            prompts.set(row.id, values);
          },
          ...(name
            ? { toolRequests: [{ toolName: name.replaceAll(".", "_"), input }] }
            : {}),
          ...(name === "file.create" && skill && supportingFile
            ? {
                steps: [
                  {
                    toolRequests: [
                      {
                        toolName: "skill_read",
                        input: {
                          skillId: skill.documentId,
                          path: supportingFile.path,
                        },
                      },
                    ],
                  },
                  { toolRequests: [{ toolName: "file_create", input }] },
                  { text: "fixture output" },
                ],
              }
            : {}),
        });
      },
      tools: (attempt, signal) => {
        const tools = createNativeRunTools(
          database.db,
          boss,
          attempt,
          toolOptions,
          signal,
        );
        return Object.fromEntries(
          Object.entries(tools).map(([name, tool]) => {
            if (!("execute" in tool) || !tool.execute)
              throw new Error("Expected native executable tool");
            const execute = tool.execute;
            return [
              name,
              {
                ...tool,
                execute: async (...args: Parameters<typeof execute>) => {
                  const result = await execute(args[0], args[1]);
                  observedResults.push(result);
                  return result;
                },
              },
            ];
          }),
        );
      },
      publishOutput: async (identity, output) => {
        const scope = await withRunAttempt(
          database.db,
          identity,
          async (c, run) => ({
            actor: c.actor,
            sessionId: run.sessionId,
            chatId: run.chatId,
          }),
          validateSchedule,
          native,
          authorizeRunSources,
        );
        if (!scope.sessionId) throw new Error("Missing native Session");
        await publishNativeMessage(
          database.db,
          native,
          workspaceId,
          scope.actor,
          scope.chatId,
          {
            requestId: effectRequestId(identity.runId, output.nativeMessageId),
            sessionId: scope.sessionId,
            ...output,
          },
          async (c) => {
            await assertRunAttempt(
              c,
              identity,
              validateSchedule,
              native,
              authorizeRunSources,
            );
          },
        );
      },
      ...overrides,
    });
  }
  function invokeTools() {
    const execute = createRunTools(database.db, boss, toolOptions);
    return (attempt: Parameters<typeof execute>[0], value: unknown) =>
      execute(attempt, value, undefined, crypto.randomUUID());
  }
  async function unsupportedSteer(id: string) {
    const response = await fetch(
      `${origin}/api/workspaces/${workspaceId}/runs/${id}/steer`,
      {
        method: "POST",
        headers: { cookie, origin, "content-type": "application/json" },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          body: "Unsupported native steering",
        }),
      },
    );
    expect(response.status).toBe(503);
  }
  it("executes an admitted native prompt through the real worker and saves authorized output", async () => {
    const { input, run, chat } = await setup("finish");
    await expect
      .poll(async () => (await saved(run.id))?.state, { timeout: 10000 })
      .toBe("finished");
    const launches = modelStarts;
    expect(record.parse(await post("/runs", input)).id).toBe(run.id);
    await runtime.dispatch(run.id);
    expect(modelStarts).toBe(launches);
    const messages = z
      .array(z.object({ body: z.string() }))
      .parse(await (await get(`/chats/${chat.id}/messages`)).json());
    expect(messages).toEqual([
      expect.objectContaining({ body: "fixture output" }),
    ]);
    const view = await (await get(`/runs/${run.id}`)).text();
    expect(view).not.toContain("contextRef");
    expect(view).not.toContain("inputs");
    expect(view).not.toContain("launchKey");
  });
  it("runs two Agents independently and targets Stop without stopping the other", async () => {
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
    await unsupportedSteer(a.run.id);
    const startedAt = performance.now();
    const reads = Promise.all(
      Array.from({ length: 32 }, async () =>
        expect((await get(`/runs/${b.run.id}/activity`)).status).toBe(200),
      ),
    );
    expect(await post(`/runs/${a.run.id}/stop`)).toMatchObject({
      stopped: true,
    });
    await reads;
    expect(performance.now() - startedAt).toBeLessThan(10000);
    expect((await saved(a.run.id))?.state).toBe("interrupted");
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
        validateSchedule,
        native,
        authorizeRunSources,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await post(`/runs/${b.run.id}/stop`);
  });
  it("invokes a native scoped message tool without accepting a forged Agent identity", async () => {
    const { run, chat, agent } = await setup({
      name: "message.create",
      body: "Scoped fixture message",
    });
    await expect
      .poll(async () => (await saved(run.id))?.state, { timeout: 10000 })
      .toBe("finished");
    const messages = z
      .array(
        z.object({
          body: z.string(),
          authorAgentId: z.string().nullable(),
          authorUserId: z.string().nullable(),
        }),
      )
      .parse(await (await get(`/chats/${chat.id}/messages`)).json());
    expect(messages).toContainEqual({
      body: "Scoped fixture message",
      authorAgentId: agent.id,
      authorUserId: null,
    });
    const active = await setup("hold");
    await expect
      .poll(async () => (await saved(active.run.id))?.state, { timeout: 10000 })
      .toBe("running");
    const row = await saved(active.run.id);
    if (!row) throw new Error("Missing Run");
    const identity = {
      runId: row.id,
      agentId: row.agentId,
      attempt: row.attempt,
      launchKey: row.launchKey,
    };
    await expect(
      invokeTools()(identity, {
        name: "message.create",
        body: "Forged",
        requestId: crypto.randomUUID(),
        agentId: agent.id,
      }),
    ).rejects.toMatchObject({
      name: "ZodError",
      issues: [{ code: "unrecognized_keys", keys: ["agentId"], path: [] }],
    });
    const afterRejection = await (
      await get(`/chats/${active.chat.id}/messages`)
    ).json();
    expect(afterRejection).not.toContainEqual(
      expect.objectContaining({ body: "Forged" }),
    );
    const authorized = await invokeTools()(identity, {
      name: "message.create",
      body: "Authorized current Agent",
      requestId: crypto.randomUUID(),
    });
    expect(authorized).toMatchObject({
      authorAgentId: active.agent.id,
      authorUserId: null,
    });
    expect(authorized).not.toMatchObject({ authorAgentId: agent.id });
    await post(`/runs/${active.run.id}/stop`);
  });
  it("catches up native output and saved question activity after a WebSocket gap", async () => {
    const { run, chat } = await setup({
      name: "human.ask",
      body: "Gap question",
    });
    let questionId = "";
    await expect
      .poll(
        async () => {
          const activity = z
            .array(z.object({ id: z.string(), type: z.string() }))
            .parse(await (await get(`/runs/${run.id}/activity`)).json());
          questionId =
            activity.find((item) => item.type === "question")?.id ?? "";
          return questionId;
        },
        { timeout: 10000 },
      )
      .not.toBe("");
    const frameSchema = z.object({
      cursor: z.number(),
      messages: z.array(z.object({ body: z.string(), cursor: z.number() })),
      activity: z.array(
        z.object({
          id: z.string(),
          body: z.string(),
          answer: z.string().nullable(),
          cursor: z.number(),
        }),
      ),
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
              } catch (error) {
                reject(error);
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
    expect(first.activity).toContainEqual(
      expect.objectContaining({
        id: questionId,
        body: "Gap question",
        answer: null,
      }),
    );
    await post(`/questions/${questionId}/answer`, { body: "Gap answer" });
    await expect
      .poll(async () => (await saved(run.id))?.state, { timeout: 10000 })
      .toBe("finished");
    const catchup = await readFrame(first.cursor);
    expect(catchup.activity).toContainEqual(
      expect.objectContaining({ id: questionId, answer: "Gap answer" }),
    );
    expect(
      catchup.messages.some((message) => message.body === "fixture output"),
    ).toBe(true);
    expect(
      [...catchup.activity, ...catchup.messages].every(
        (item) => item.cursor > first.cursor,
      ),
    ).toBe(true);
    const stranger = await createHuman("runtime-ws-outsider@example.test");
    expect(
      (
        await fetch(
          `${origin}/api/realtime?workspaceId=${workspaceId}&chatId=${chat.id}&runId=${run.id}`,
          { headers: { cookie: stranger.cookie, origin } },
        )
      ).status,
    ).toBe(403);
  });
  it("loads persisted private Session history without republishing it as shared output", async () => {
    const first = await setup("PRIVATE NATIVE HISTORY");
    await expect
      .poll(async () => (await saved(first.run.id))?.state, { timeout: 10000 })
      .toBe("finished");
    const sessionId = (await saved(first.run.id))?.sessionId;
    expect(sessionId).toBeTruthy();
    const before = z
      .array(record)
      .parse(await (await get(`/chats/${first.chat.id}/messages`)).json());
    const second = record.parse(
      await post("/runs", {
        ...first.input,
        body: "Continue the saved Session",
        sessionId,
        requestId: crypto.randomUUID(),
      }),
    );
    await expect
      .poll(async () => (await saved(second.id))?.state, { timeout: 10000 })
      .toBe("finished");
    expect((await saved(second.id))?.sessionId).toBe(sessionId);
    expect(JSON.stringify(prompts.get(second.id))).toContain(
      "PRIVATE NATIVE HISTORY",
    );
    const shared = z
      .array(z.object({ id: z.string(), body: z.string() }))
      .parse(await (await get(`/chats/${first.chat.id}/messages`)).json());
    expect(shared).toHaveLength(before.length + 1);
    expect(shared.map((message) => message.body).join("\n")).not.toContain(
      "PRIVATE NATIVE HISTORY",
    );
    expect(new Set(shared.map((message) => message.id)).size).toBe(
      shared.length,
    );
  });
  it("preserves native message identity against conflicting replay", async () => {
    const { run } = await setup("finish");
    await expect
      .poll(async () => (await saved(run.id))?.state, { timeout: 10000 })
      .toBe("finished");
    const sessionId = (await saved(run.id))?.sessionId;
    if (!sessionId) throw new Error("Missing Session");
    const input = {
      workspaceId,
      threadId: sessionId,
      messageId: crypto.randomUUID(),
      role: "user" as const,
      body: "PRIVATE REPLAY",
      createdAt: new Date(),
    };
    const original = await saveNativeMessage(native, input);
    expect((await saveNativeMessage(native, input)).id).toBe(original.id);
    await expect(
      saveNativeMessage(native, { ...input, body: "CHANGED REPLAY" }),
    ).rejects.toMatchObject({ code: "conflict" });
    const history = await nativeHistory(run.id);
    expect(
      history.filter((message) => message.id === original.id),
    ).toHaveLength(1);
    expect(JSON.stringify(history)).toContain("PRIVATE REPLAY");
    expect(JSON.stringify(history)).not.toContain("CHANGED REPLAY");
  });
  it("persists native usage once and denies unauthorized aggregate reads", async () => {
    const { run } = await setup("finish");
    await expect
      .poll(async () => (await saved(run.id))?.state, { timeout: 10000 })
      .toBe("finished");
    const usage = (await saved(run.id))?.usage;
    expect(usage).toHaveLength(1);
    expect(await (await get(`/runs/${run.id}/usage`)).json()).toMatchObject({
      provider: "openai",
      model: "fixture",
      scope: "native_observed",
      complete: true,
      messageCount: 1,
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
    });
    await runtime.dispatch(run.id);
    await runtime.reconcile(run.id);
    expect((await saved(run.id))?.usage).toEqual(usage);
    const outsider = await createHuman("usage-outsider@example.test");
    expect(
      (
        await fetch(
          `${origin}/api/workspaces/${workspaceId}/runs/${run.id}/usage`,
          { headers: { cookie: outsider.cookie } },
        )
      ).status,
    ).toBe(403);
    expect((await saved(run.id))?.usage).toEqual(usage);
  });
  it("bounds native output without publishing an oversized result", async () => {
    await worker.stop({ graceful: false });
    const isolated = createEngine({
      resolveModel: async (_attempt, signal) =>
        controlledModel({ signal, text: "x".repeat(1048577) }),
    });
    try {
      const { run, chat } = await setup("finish");
      await isolated.dispatch(run.id);
      await expect
        .poll(() => isolated.health().active, { timeout: 10000 })
        .toBe(0);
      expect((await saved(run.id))?.state).toBe("interrupted");
      expect((await saved(run.id))?.outcome).toBe(
        "stopped_or_authorization_revoked",
      );
      expect(await (await get(`/chats/${chat.id}/messages`)).json()).toEqual(
        [],
      );
    } finally {
      await isolated.close();
      worker = await startQueue(database.db, database.pool, {
        runtime,
        nativeStorage: native,
        modelAuthorization: nativeModelAuthorization,
      });
    }
  });
  it("Stops during native model resolution and joins cleanup without poisoning a sibling", async () => {
    await worker.stop({ graceful: false });
    let entered: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let resolutions = 0;
    let aborted = false;
    const isolated = createEngine({
      resolveModel: async (_attempt, signal) => {
        if (resolutions++ === 0) {
          entered();
          await new Promise<void>((resolve) => {
            const abort = () => {
              aborted = true;
              resolve();
            };
            if (signal.aborted) abort();
            else signal.addEventListener("abort", abort, { once: true });
          });
        }
        return controlledModel({ signal });
      },
    });
    try {
      const first = await setup("hold");
      const dispatch = isolated.dispatch(first.run.id);
      await ready;
      expect(
        await isolated.stop(workspaceId, { userId }, first.run.id),
      ).toMatchObject({ stopped: true });
      await dispatch;
      expect(aborted).toBe(true);
      expect(isolated.health()).toMatchObject({
        active: 0,
        persistenceErrors: 0,
      });
      expect((await saved(first.run.id))?.state).toBe("interrupted");
      const sibling = await setup("finish");
      await isolated.dispatch(sibling.run.id);
      await expect
        .poll(async () => (await saved(sibling.run.id))?.state, {
          timeout: 10000,
        })
        .toBe("finished");
    } finally {
      await isolated.close();
      worker = await startQueue(database.db, database.pool, {
        runtime,
        nativeStorage: native,
        modelAuthorization: nativeModelAuthorization,
      });
    }
  });
  it("bounds simultaneous native starts before model resolution", async () => {
    await worker.stop({ graceful: false });
    const admitted = [];
    for (let index = 0; index < 17; index++)
      admitted.push(await setup("finish"));
    let resolutions = 0;
    const isolated = createEngine({
      resolveModel: async (_attempt, signal) => {
        if (++resolutions <= 16) {
          await new Promise<void>((resolve) => {
            if (signal.aborted) resolve();
            else
              signal.addEventListener("abort", () => resolve(), { once: true });
          });
        }
        return controlledModel({ signal });
      },
    });
    const pending = admitted
      .slice(0, 16)
      .map(({ run }) => isolated.dispatch(run.id));
    try {
      await expect.poll(() => resolutions).toBe(16);
      const overflow = admitted[16];
      if (!overflow) throw new Error("Missing overflow Run");
      await expect(isolated.dispatch(overflow.run.id)).rejects.toMatchObject({
        code: "unavailable",
        message: "Runtime capacity",
      });
      expect((await saved(overflow.run.id))?.state).toBe("queued");
      expect(resolutions).toBe(16);
      await Promise.all(
        admitted
          .slice(0, 16)
          .map(({ run }) => isolated.stop(workspaceId, { userId }, run.id)),
      );
      await Promise.all(pending);
      expect(isolated.health()).toMatchObject({
        active: 0,
        persistenceErrors: 0,
      });
      await isolated.dispatch(overflow.run.id);
      expect((await saved(overflow.run.id))?.state).toBe("finished");
      expect(resolutions).toBe(17);
    } finally {
      await isolated.close();
      await Promise.all(pending);
      for (const { run } of admitted) {
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
        nativeStorage: native,
        modelAuthorization: nativeModelAuthorization,
      });
    }
  });
  it("joins active native Runs on close and recovers through a new worker without duplicate execution", async () => {
    const first = await setup("hold");
    const second = await setup("hold");
    await expect
      .poll(
        async () => [
          (await saved(first.run.id))?.state,
          (await saved(second.run.id))?.state,
        ],
        { timeout: 10000 },
      )
      .toEqual(["running", "running"]);
    await worker.stop({ graceful: false });
    await runtime.close();
    expect(runtime.health()).toMatchObject({
      active: 0,
      closing: true,
      persistenceErrors: 0,
    });
    const launches = modelStarts;
    runtime = createEngine();
    realtime.close();
    auth = createAuth(database.db, authSecret, origin, mail);
    app = createApp({
      db: database.db,
      boss,
      auth,
      origin,
      runtime,
      storage,
      spool: transfers.spool,
      mail,
      nativeStorage: native,
      encryptionKey: fixtureEncryptionKey,
      modelAuthorization: nativeModelAuthorization,
    });
    realtime = createRealtime({
      db: database.db,
      boss,
      auth,
      origin,
      runtime,
      storage,
      nativeStorage: native,
    });
    worker = await startQueue(database.db, database.pool, {
      runtime,
      nativeStorage: native,
      modelAuthorization: nativeModelAuthorization,
    });
    for (const { run } of [first, second]) {
      expect((await saved(run.id))?.state).toBe("interrupted");
      await runtime.dispatch(run.id);
    }
    expect(modelStarts).toBe(launches);
    const next = await setup("finish");
    await expect
      .poll(async () => (await saved(next.run.id))?.state, { timeout: 10000 })
      .toBe("finished");
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
    const tools = invokeTools();
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
      invokeTools()(
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
  it("routes a native peer request to a second Agent through atomic admission and the real worker", async () => {
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
        fixtureTool: {
          name: "agent.request",
          requestId: crypto.randomUUID(),
          agentId: receiver.id,
          body: "finish",
        },
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
    const launches = modelStarts;
    await runtime.dispatch(child.id);
    expect(modelStarts).toBe(launches);
  });
  it("executes a scoped MCP write only after exact human approval through HTTP and native tools", async () => {
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
      nativeStorage: native,
      modelAuthorization: nativeModelAuthorization,
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
          fixtureTool: {
            name: "connection.request",
            connectionId: connection.id,
            requestId: crypto.randomUUID(),
            action: "tool.write",
            target: "repo:one",
            arguments: { target: "repo:one" },
          },
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
      await unsupportedSteer(run.id);
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
      expect(JSON.stringify(await nativeHistory(run.id))).toContain(
        "controlled MCP result",
      );
      const shared = await (await get(`/chats/${chat.id}/messages`)).text();
      expect(shared).toContain("fixture output");
      expect(shared).not.toContain("controlled MCP result");
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
        nativeStorage: native,
        modelAuthorization: nativeModelAuthorization,
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
      code: "conflict",
    });
    expect((await saved(second.id))?.state).toBe("queued");
    const activeLaunches = modelStarts;
    await post(`/runs/${first.run.id}/stop`);
    await expect
      .poll(async () => (await saved(second.id))?.state, { timeout: 15000 })
      .toBe("finished");
    expect(modelStarts).toBe(activeLaunches + 1);
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
    const { run } = await setup(request, "prompt", {
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
      nativeStorage: native,
      modelAuthorization: nativeModelAuthorization,
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
    expect(JSON.stringify(prompts.get(run.id))).toContain(
      "saved skill instructions",
    );
    expect(JSON.stringify(prompts.get(run.id))).toContain(
      "saved selected context",
    );
    expect(JSON.stringify(prompts.get(run.id))).not.toContain("later context");
    expect(accepted?.inputs.skills[0]?.supportingFiles).toEqual([
      expect.objectContaining({
        artifactId: file.id,
        path: "references/example.txt",
        byteLength: 22,
        sha256: new Bun.CryptoHasher("sha256")
          .update("saved supporting bytes")
          .digest("hex"),
      }),
    ]);
    const skillResults = (await nativeHistory(run.id))
      .flatMap((message) => message.content.parts)
      .flatMap((part) =>
        part.type === "tool-invocation" &&
        part.toolInvocation.toolName === "skill_read" &&
        part.toolInvocation.state === "result"
          ? [z.object({ base64: z.string() }).parse(part.toolInvocation.result)]
          : [],
      );
    expect(skillResults).toHaveLength(1);
    expect(
      Buffer.from(skillResults[0]?.base64 ?? "", "base64").toString(),
    ).toBe("saved supporting bytes");
    const receipt = record.parse(observedResults.at(-1));
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
    const { run } = await setup(request);
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
        nativeStorage: native,
        modelAuthorization: nativeModelAuthorization,
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
        .where(eq(files.sourceRunId, run.id));
      expect(intent?.state).toBe("pending");
      expect((await get(`/files/${intent?.id}`)).status).toBe(404);
      expect(await stopResponse).toMatchObject({ stopped: true });
    } finally {
      afterPut = undefined;
      await stopResponse;
    }
  });
  it("waits for an authorized human answer through saved activity and resumes the same native Run", async () => {
    const request = {
      name: "human.ask",
      requestId: crypto.randomUUID(),
      body: "Which destination?",
    };
    const { run } = await setup(request);
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
    await unsupportedSteer(run.id);
    expect(performance.now() - steerStarted).toBeLessThan(5000);
    await post(`/questions/${questionId}/answer`, {
      body: "Use the approved destination",
    });
    await expect
      .poll(async () => (await saved(run.id))?.state, { timeout: 10000 })
      .toBe("finished");
    expect(observedResults.at(-1)).toEqual({
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
    const answers = await database.db
      .select()
      .from(runActivity)
      .where(eq(runActivity.id, questionId));
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({
      runId: run.id,
      answer: "Use the approved destination",
      answeredBy: userId,
    });
    expect(answers[0]?.answeredAt).toBeInstanceOf(Date);
    expect(JSON.stringify(await nativeHistory(run.id))).toContain(
      "Use the approved destination",
    );
    const waiting = await setup({ ...request, requestId: crypto.randomUUID() });
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
    expect(await post(`/runs/${waiting.run.id}/stop`)).toMatchObject({
      stopped: true,
    });
    expect(performance.now() - stopStarted).toBeLessThan(5000);
    expect((await saved(waiting.run.id))?.state).toBe("interrupted");
  });
  it("fires native prompt Schedule occurrences through the real pg-boss clock", async () => {
    const records = [];
    for (const type of ["prompt"]) {
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
      native,
      authorizeRunSources,
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
    await unsupportedSteer(run.id);
    expect(await post(`/runs/${run.id}/stop`)).toMatchObject({ stopped: true });
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
      const launches = modelStarts;
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
      expect(modelStarts).toBe(launches);
      expect((await saved(run.id))?.updatedAt.getTime()).toBeGreaterThan(
        admittedAt?.getTime() ?? 0,
      );
    } finally {
      worker = await startQueue(database.db, database.pool, {
        runtime,
        nativeStorage: native,
        modelAuthorization: nativeModelAuthorization,
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
});
