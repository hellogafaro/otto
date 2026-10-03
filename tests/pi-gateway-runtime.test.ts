import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createApp } from "../apps/server/src/app";
import { createAuth } from "../apps/server/src/auth";
import { createModelGateway } from "../apps/server/src/model-gateway";
import { startQueue } from "../apps/server/src/queue";
import { readRunSkillFile } from "../apps/server/src/skill-files";
import { createSubscriptionLogin } from "../apps/server/src/subscription-login";
import {
  type AccountAuth,
  createInfisicalAccounts,
} from "../apps/server/src/subscription-secrets";
import { createRunTools, runToolSchema } from "../apps/server/src/tools";
import type { ArtifactStorage } from "../packages/artifacts/src";
import { participants } from "../packages/conversations/src/schema";
import { type PiInstallation, RUN_QUEUE } from "../packages/runs/src";
import { createRunRuntime } from "../packages/runs/src/runtime";
import { runActivity, runs } from "../packages/runs/src/schema";
import { subscriptions } from "../packages/subscriptions/src/schema";
import { claimInstallation } from "../packages/workspaces/src";
import { NativePiComputer } from "./fixtures/native-pi";
import { startPostgres } from "./postgres";

// Actual published Pi + actual embedded Go/native executor + HTTP/PG/queue.
// Upstream OAuth/account/store and computer are controlled peers, not billing/isolation proof.
describe("managed Pi through Otto and the private account gateway", () => {
  const sourceDirectory = dirname(fileURLToPath(import.meta.url));
  let pi: PiInstallation;
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let boss: Awaited<ReturnType<typeof startQueue>>;
  let worker: Awaited<ReturnType<typeof startQueue>>;
  let server: Bun.Server<undefined>;
  let peer: Bun.Server<undefined>;
  let gatewayProcess: ReturnType<typeof Bun.spawn>;
  let computer: NativePiComputer;
  let runtime: ReturnType<typeof createRunRuntime>;
  let publicationGate: (() => Promise<void>) | undefined;
  let nativeTextObserved = false;
  let accounts: ReturnType<typeof createSubscriptionLogin>;
  let gateway: ReturnType<typeof createModelGateway>;
  let app: ReturnType<typeof createApp>;
  let workspaceId: string;
  let cookie: string;
  let subscriptionId: string;
  let documentId: string;
  let skillId: string;
  const objects = new Map<string, Uint8Array>();
  const storage: ArtifactStorage = {
    async put(key, bytes) {
      objects.set(key, bytes.slice());
    },
    async get(key) {
      const bytes = objects.get(key);
      if (!bytes) throw new Error("Missing controlled Skill bytes");
      return bytes.slice();
    },
  };
  let savedCredential: AccountAuth;
  const accountId = "controlled-native-account";
  const model = "gpt-6.1-sol";
  let scenario: "coding" | "question" | "text" | "skills" = "coding";
  let scenarioStart = 0;
  const questionRequestId = crypto.randomUUID();
  let continuing: {
    agentId: string;
    conversationId: string;
    sessionId: string;
  };
  const requests: z.infer<typeof modelRequest>[] = [];
  const modelInputs: string[][] = [];
  const modelRequest = z
    .object({
      model: z.literal(model),
      stream: z.boolean(),
      tools: z.array(
        z
          .object({ name: z.string(), description: z.string().optional() })
          .passthrough(),
      ),
      input: z.array(z.unknown()),
      prompt_cache_key: z.string().optional(),
      reasoning: z.unknown().optional(),
    })
    .passthrough();
  function completion(index: number) {
    const tool =
      scenario === "coding" || scenario === "skills"
        ? index < 3
        : scenario === "question" && index === 1;
    const name =
      scenario === "skills" && index === 1
        ? "read"
        : scenario === "coding" && index === 1
          ? "write"
          : "otto";
    const args = JSON.stringify(
      scenario === "skills"
        ? index === 1
          ? { path: `skills/${skillId}/references/guide.txt` }
          : { input: { name: "skill.get", skillId } }
        : scenario === "question"
          ? {
              input: {
                name: "human.ask",
                requestId: questionRequestId,
                body: "May I continue?",
              },
            }
          : index === 1
            ? { path: "controlled.txt", content: "written by managed Pi\n" }
            : { input: { name: "document.get", documentId } },
    );
    const item = tool
      ? {
          type: "function_call",
          id: `fc_${index}`,
          call_id: `call_${index}`,
          name,
          arguments: args,
        }
      : {
          type: "message",
          id: `msg_${index}`,
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: "accepted document and file",
              annotations: [],
            },
          ],
        };
    const events = [
      {
        type: "response.created",
        response: { id: `response_${index}`, status: "in_progress", model },
      },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: tool ? { ...item, arguments: "" } : { ...item, content: [] },
      },
      ...(tool
        ? [
            {
              type: "response.function_call_arguments.delta",
              item_id: `fc_${index}`,
              output_index: 0,
              delta: args,
            },
            {
              type: "response.function_call_arguments.done",
              item_id: `fc_${index}`,
              output_index: 0,
              arguments: args,
            },
          ]
        : [
            {
              type: "response.content_part.added",
              item_id: `msg_${index}`,
              output_index: 0,
              content_index: 0,
              part: { type: "output_text", text: "", annotations: [] },
            },
            {
              type: "response.output_text.delta",
              item_id: `msg_${index}`,
              output_index: 0,
              content_index: 0,
              delta: "accepted document and file",
            },
            {
              type: "response.output_text.done",
              item_id: `msg_${index}`,
              output_index: 0,
              content_index: 0,
              text: "accepted document and file",
            },
          ]),
      { type: "response.output_item.done", output_index: 0, item },
      {
        type: "response.completed",
        response: {
          id: `response_${index}`,
          status: "completed",
          model,
          output: [item],
          usage: {
            input_tokens: 10,
            output_tokens: 2,
            total_tokens: 12,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
        },
      },
    ];
    return new Response(
      events
        .map(
          (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
        )
        .join(""),
      { headers: { "content-type": "text/event-stream" } },
    );
  }
  async function post(path: string, value: unknown, method = "POST") {
    const response = await fetch(
      `${server.url.origin}/api/workspaces/${workspaceId}${path}`,
      {
        method,
        headers: {
          cookie,
          origin: server.url.origin,
          "content-type": "application/json",
        },
        body: JSON.stringify(value),
      },
    );
    expect(response.status).toBe(200);
    return response.json();
  }
  const record = z.object({ id: z.uuid() });
  beforeAll(async () => {
    database = await startPostgres();
    boss = await startQueue(database.db, database.pool, {
      install: true,
      workers: false,
    });
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      maxRequestBodySize: 1048576,
      async fetch(request) {
        if (new URL(request.url).pathname === "/model/v1/responses") {
          const input = modelRequest.parse(await request.clone().json());
          modelInputs.push(Object.keys(input).sort());
        }
        return app.fetch(request);
      },
    });
    const auth = createAuth(
      database.db,
      crypto.randomUUID() + crypto.randomUUID(),
      server.url.origin,
    );
    app = createApp({ db: database.db, auth, boss, origin: server.url.origin });
    const signup = await fetch(`${server.url.origin}/api/auth/sign-up/email`, {
      method: "POST",
      headers: {
        origin: server.url.origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Human",
        email: "native-pi@example.test",
        password: crypto.randomUUID() + crypto.randomUUID(),
      }),
    });
    expect(signup.status).toBe(200);
    cookie = signup.headers.get("set-cookie") ?? "";
    const userId = z
      .object({ user: z.object({ id: z.string() }) })
      .parse(await signup.json()).user.id;
    workspaceId = (
      await claimInstallation(database.db, userId, "Pi integration")
    ).id;
    subscriptionId = record.parse(
      await post("/subscriptions", {
        title: "Controlled account",
        provider: "codex",
        visibility: "workspace",
      }),
    ).id;
    documentId = record.parse(
      await post("/documents", {
        title: "Accepted context",
        body: "exact accepted content",
        visibility: "workspace",
      }),
    ).id;
    const payload = Buffer.from(
      JSON.stringify({
        "https://api.openai.com/auth": { chatgpt_account_id: accountId },
      }),
    ).toString("base64url");
    savedCredential = {
      credential: {
        provider: "codex",
        accountId,
        accessToken: `fixture.${payload}.fixture`,
        refreshToken: "controlled-refresh",
        expired: "2030-01-01T00:00:00.000Z",
      },
      authenticatedAt: "2026-10-03T00:00:00.000Z",
    };
    // This confirmed synthetic account datum is not live OAuth qualification; the real SDK flow has separate controlled-peer proof.
    await database.db
      .update(subscriptions)
      .set({ status: "enabled" })
      .where(eq(subscriptions.id, subscriptionId));
    peer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path.startsWith("/api/v4/secrets/"))
          return Response.json({
            secret: { secretValue: JSON.stringify(savedCredential) },
          });
        expect(request.headers.get("chatgpt-account-id")).toBe(accountId);
        expect(request.headers.get("authorization")).toBe(
          `Bearer ${savedCredential.credential.accessToken}`,
        );
        if (path.endsWith("/models"))
          return Response.json({ models: [{ slug: model }] });
        expect(path.endsWith("/responses")).toBe(true);
        const value = modelRequest.parse(await request.json());
        requests.push(value);
        return completion(requests.length - scenarioStart);
      },
    });
    accounts = createSubscriptionLogin(
      database.db,
      createInfisicalAccounts({
        endpoint: peer.url.origin,
        allowLoopbackHttp: true,
        bindings: [
          {
            workspaceId,
            projectId: "controlled",
            environment: "controlled",
            secretPath: "/otto",
          },
        ],
        getAccessToken: async () => "controlled-infisical-capability",
      }),
      database.pool,
    );
    const listener = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response(null),
    });
    const port = listener.port;
    await listener.stop(true);
    const binary = process.env.OTTO_GATEWAY_FIXTURE_BINARY;
    if (!binary)
      throw new Error(
        "Build the pinned Go test helper and set OTTO_GATEWAY_FIXTURE_BINARY for native integration",
      );
    gatewayProcess = Bun.spawn(
      [binary, "-test.run=^TestGatewayProcessHelper$"],
      {
        env: {
          ...process.env,
          OTTO_FIXTURE_CHILD: "1",
          OTTO_FIXTURE_PEER: peer.url.origin,
          OTTO_FIXTURE_STORE: server.url.origin,
          OTTO_FIXTURE_PORT: String(port),
        },
        stdout: "ignore",
        stderr: "ignore",
      },
    );
    gateway = createModelGateway(database.db, {
      endpoint: `http://127.0.0.1:${port}`,
      key: "synthetic-gateway-key",
      origin: server.url.origin,
      accounts,
      allowLoopbackHttp: true,
    });
    pi = {
      version: "1.0.0",
      argv: [
        process.execPath,
        join(
          dirname(
            Bun.resolveSync(
              "@earendil-works/pi-coding-agent",
              join(sourceDirectory, "../apps/server"),
            ),
          ),
          "bundle/cli.js",
        ),
      ],
      authorizeModel: gateway.authorizeModel,
    };
    computer = new NativePiComputer();
    const guarded = new Proxy(database.db, {
      get(target, key, receiver) {
        if (key === "select" && publicationGate && nativeTextObserved) {
          const gate = publicationGate;
          publicationGate = undefined;
          function delay<T extends object>(chain: T): T {
            return new Proxy(chain, {
              get(selected, property, selectedReceiver) {
                const value = Reflect.get(selected, property, selectedReceiver);
                if (property === "then" && typeof value === "function")
                  return async (...callbacks: unknown[]) => {
                    await gate?.();
                    return Reflect.apply(value, selected, callbacks);
                  };
                if (
                  (property === "from" || property === "where") &&
                  typeof value === "function"
                )
                  return (...args: unknown[]) => {
                    const next: unknown = Reflect.apply(value, selected, args);
                    if (typeof next !== "object" || next === null)
                      throw new Error("Invalid query builder");
                    return delay(next);
                  };
                return typeof value === "function"
                  ? value.bind(selected)
                  : value;
              },
            });
          }
          return (...args: unknown[]) =>
            delay(Reflect.apply(target.select, target, args));
        }
        const value = Reflect.get(target, key, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    runtime = createRunRuntime(guarded, {
      backend: {
        provider: computer.provider,
        inspectComputer: computer.inspectComputer.bind(computer),
        lookup: computer.lookup.bind(computer),
        async launch(input) {
          const process = await computer.launch(input);
          const decoder = new TextDecoder();
          let pending = "";
          return {
            ...process,
            stdout: process.stdout.pipeThrough(
              new TransformStream<Uint8Array, Uint8Array>({
                transform(chunk, stream) {
                  pending += decoder.decode(chunk, { stream: true });
                  const lines = pending.split("\n");
                  pending = lines.pop() ?? "";
                  for (const line of lines) {
                    if (!line) continue;
                    const event = z
                      .object({
                        type: z.string(),
                        assistantMessageEvent: z
                          .object({ type: z.string() })
                          .optional(),
                      })
                      .parse(JSON.parse(line));
                    if (
                      publicationGate &&
                      event.type === "message_update" &&
                      event.assistantMessageEvent?.type === "text_delta"
                    )
                      nativeTextObserved = true;
                  }
                  stream.enqueue(chunk);
                },
              }),
            ),
          };
        },
      },
      pi,
      extensionSource: await Bun.file(
        join(sourceDirectory, "../packages/runs/src/pi-extension.ts"),
      ).text(),
      toolSchema: runToolSchema,
      modelAccess: gateway.issue,
      handleTool: createRunTools(database.db, boss, { pi, storage }),
      readSkillFile: (input) => readRunSkillFile(database.db, storage, input),
      deadlineMs: 30000,
    });
    app = createApp({
      db: database.db,
      auth,
      boss,
      origin: server.url.origin,
      runtime,
      pi,
      storage,
      subscriptionLogin: accounts,
      gatewayStoreKey: "synthetic-store-key",
      modelGateway: gateway,
    });
    worker = await startQueue(database.db, database.pool, { runtime, pi });
  });
  afterAll(async () => {
    const errors: unknown[] = [];
    let exitCode: number | undefined;
    const cleanup = [
      () => worker?.stop({ graceful: false }),
      () => runtime?.close(),
      () => computer?.close(),
      () => gateway?.close(),
      () => accounts?.close(),
      async () => {
        if (gatewayProcess) {
          gatewayProcess.kill("SIGTERM");
          exitCode = await gatewayProcess.exited;
        }
      },
      () => server?.stop(true),
      () => peer?.stop(true),
      () => boss?.stop(),
      () => database?.stop(),
    ];
    for (const stop of cleanup) {
      try {
        await stop();
      } catch (error) {
        errors.push(error);
      }
    }
    console.info(
      JSON.stringify({
        nativeModelRequestFields: modelInputs,
        upstreamRequestCount: requests.length,
      }),
    );
    if (errors.length)
      throw new AggregateError(errors, "Native fixture cleanup failed");
    if (runtime) expect(exitCode).toBe(0);
  });
  it("admission -> real queue -> packaged Pi coding/scoped tools -> private gateway -> exact account -> saved output and usage", async () => {
    await expect.poll(() => gateway.isReady(), { timeout: 5000 }).toBe(true);
    const agent = z.object({ agent: record }).parse(
      await post("/agents", {
        title: "Managed Pi",
        instructions: "Work",
        visibility: "workspace",
        model,
        subscriptionId,
      }),
    ).agent;
    await post(`/agents/${agent.id}/computer`, { computerRef: agent.id });
    const conversation = record.parse(
      await post("/conversations", {
        title: "Native loop",
        visibility: "workspace",
      }),
    );
    await post(`/conversations/${conversation.id}/participants`, {
      agentId: agent.id,
      role: "contributor",
    });
    const input = {
      agentId: agent.id,
      conversationId: conversation.id,
      requestId: crypto.randomUUID(),
      type: "prompt",
      body: "Write a file, read the accepted document and report.",
      documentIds: [documentId],
    };
    const run = record.parse(await post("/runs", input));
    await expect
      .poll(
        async () =>
          (await database.db.select().from(runs).where(eq(runs.id, run.id)))[0]
            ?.state,
        { timeout: 15000 },
      )
      .toBe("finished");
    expect(requests).toHaveLength(3);
    expect(requests[0]?.tools.map((tool) => tool.name).sort()).toEqual([
      "bash",
      "edit",
      "otto",
      "read",
      "write",
    ]);
    expect(
      requests[0]?.tools.find((tool) => tool.name === "otto")?.description,
    ).toContain(JSON.stringify(runToolSchema));
    expect(JSON.stringify(requests[2]?.input)).toContain(
      "exact accepted content",
    );
    const execution = [...computer.executions.values()][0];
    expect(execution).toBeDefined();
    expect(
      await Bun.file(join(execution?.directory ?? "", "controlled.txt")).text(),
    ).toBe("written by managed Pi\n");
    const response = await fetch(
      `${server.url.origin}/api/workspaces/${workspaceId}/runs/${run.id}/usage`,
      { headers: { cookie } },
    );
    expect(response.status).toBe(200);
    expect(
      z
        .object({
          provider: z.literal("codex"),
          model: z.literal(model),
          complete: z.boolean(),
          messageCount: z.number(),
          inputTokens: z.number(),
          outputTokens: z.number(),
          totalTokens: z.number(),
        })
        .parse(await response.json()),
    ).toEqual({
      provider: "codex",
      model,
      complete: true,
      messageCount: 3,
      inputTokens: 30,
      outputTokens: 6,
      totalTokens: 36,
    });
    expect(record.parse(await post("/runs", input)).id).toBe(run.id);
    expect(requests).toHaveLength(3);
    const accepted = (
      await database.db.select().from(runs).where(eq(runs.id, run.id))
    )[0];
    expect(accepted?.sessionId).toBeDefined();
    expect(
      requests.every(
        (request) => request.prompt_cache_key === accepted?.sessionId,
      ),
    ).toBe(true);
    continuing = {
      agentId: agent.id,
      conversationId: conversation.id,
      sessionId: accepted?.sessionId ?? "",
    };
    expect(runtime.health().persistenceErrors).toBe(0);
  });
  it("materializes accepted Skill instructions/files and executes the new scoped Skill API through actual Pi", async () => {
    scenario = "skills";
    scenarioStart = requests.length;
    skillId = record.parse(
      await post("/skills", {
        title: "accepted-skill",
        instructions: "original accepted instructions",
        whenToUse: "Review",
        visibility: "workspace",
      }),
    ).id;
    const file = record.parse(
      await post("/artifacts", {
        requestId: crypto.randomUUID(),
        title: "Skill reference",
        type: "text",
        mediaType: "text/plain",
        visibility: "workspace",
        bytes: Buffer.from("immutable supporting bytes").toString("base64"),
      }),
    );
    await post(
      `/skills/${skillId}/files`,
      {
        editToken: 0,
        files: [{ path: "references/guide.txt", artifactId: file.id }],
      },
      "PUT",
    );
    const agent = z.object({ agent: record }).parse(
      await post("/agents", {
        title: "Skill Pi",
        instructions: "Use accepted skill",
        model,
        subscriptionId,
        visibility: "workspace",
        skillIds: [skillId],
      }),
    ).agent;
    await post(`/agents/${agent.id}/computer`, { computerRef: agent.id });
    const conversation = record.parse(
      await post("/conversations", {
        title: "Skills",
        visibility: "workspace",
      }),
    );
    await post(`/conversations/${conversation.id}/participants`, {
      agentId: agent.id,
      role: "contributor",
    });
    await worker.stop({ graceful: false });
    let runId: string | undefined;
    try {
      runId = record.parse(
        await post("/runs", {
          agentId: agent.id,
          conversationId: conversation.id,
          requestId: crypto.randomUUID(),
          type: "prompt",
          body: "Read accepted skill bytes and instructions",
        }),
      ).id;
      const accepted = (
        await database.db.select().from(runs).where(eq(runs.id, runId))
      )[0]?.inputs;
      await post(
        `/skills/${skillId}`,
        { editToken: 1, instructions: "later edited instructions" },
        "PATCH",
      );
      worker = await startQueue(database.db, database.pool, { runtime, pi });
      await expect
        .poll(
          async () =>
            (
              await database.db
                .select()
                .from(runs)
                .where(eq(runs.id, runId ?? ""))
            )[0]?.state,
          { timeout: 15000 },
        )
        .toBe("finished");
      const saved = (
        await database.db.select().from(runs).where(eq(runs.id, runId))
      )[0];
      const execution = computer.executions.get(saved?.launchKey ?? "");
      expect(execution).toBeDefined();
      expect(
        await Bun.file(
          join(execution?.directory ?? "", `skills/${skillId}/SKILL.md`),
        ).text(),
      ).toContain("original accepted instructions");
      expect(
        await Bun.file(
          join(
            execution?.directory ?? "",
            `skills/${skillId}/references/guide.txt`,
          ),
        ).text(),
      ).toBe("immutable supporting bytes");
      expect(JSON.stringify(requests.at(-1)?.input)).toContain(
        "original accepted instructions",
      );
      expect(JSON.stringify(requests.at(-1)?.input)).toContain(
        "immutable supporting bytes",
      );
      expect(JSON.stringify(requests.at(-1)?.input)).not.toContain(
        "later edited instructions",
      );
      expect(
        (await database.db.select().from(runs).where(eq(runs.id, runId)))[0]
          ?.inputs,
      ).toEqual(accepted);
      expect(requests.length - scenarioStart).toBe(3);
    } finally {
      if (runId) await post(`/runs/${runId}/stop`, {});
      if (!worker)
        worker = await startQueue(database.db, database.pool, { runtime, pi });
    }
  });
  it("resumes the private Pi Session and rejects a changed account identity without rewriting accepted inputs", async () => {
    scenario = "text";
    scenarioStart = requests.length;
    const run = record.parse(
      await post("/runs", {
        ...continuing,
        requestId: crypto.randomUUID(),
        type: "prompt",
        body: "Continue the accepted Session.",
        documentIds: [documentId],
      }),
    );
    await expect
      .poll(
        async () =>
          (await database.db.select().from(runs).where(eq(runs.id, run.id)))[0]
            ?.state,
        { timeout: 15000 },
      )
      .toBe("finished");
    expect(requests.length - scenarioStart).toBe(1);
    const before = await database.db.select({ id: runs.id }).from(runs);
    const old = savedCredential;
    const payload = Buffer.from(
      JSON.stringify({
        "https://api.openai.com/auth": {
          chatgpt_account_id: "another-controlled-account",
        },
      }),
    ).toString("base64url");
    savedCredential = {
      ...old,
      credential: {
        ...old.credential,
        accountId: "another-controlled-account",
        accessToken: `fixture.${payload}.fixture`,
      },
    };
    try {
      const response = await fetch(
        `${server.url.origin}/api/workspaces/${workspaceId}/runs`,
        {
          method: "POST",
          headers: {
            cookie,
            origin: server.url.origin,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            ...continuing,
            requestId: crypto.randomUUID(),
            type: "prompt",
            body: "Wrong account",
            documentIds: [documentId],
          }),
        },
      );
      // The private gateway refuses a changed selected account before Session
      // admission. Otto exposes only availability, not upstream identity details.
      expect(response.status).toBe(503);
      expect(await database.db.select({ id: runs.id }).from(runs)).toEqual(
        before,
      );
      expect(requests.length - scenarioStart).toBe(1);
      expect(
        (await database.db.select().from(runs).where(eq(runs.id, run.id)))[0]
          ?.inputs.accountId,
      ).toBe(accountId);
    } finally {
      savedCredential = old;
    }
  });
  it("keeps an active accepted model through future Agent edits and joins pending native question steer/Stop", async () => {
    scenario = "question";
    scenarioStart = requests.length;
    const agent = z.object({ agent: record }).parse(
      await post("/agents", {
        title: "Native controls",
        instructions: "Ask",
        visibility: "workspace",
        model,
        subscriptionId,
      }),
    ).agent;
    await post(`/agents/${agent.id}/computer`, { computerRef: agent.id });
    const conversation = record.parse(
      await post("/conversations", {
        title: "Question",
        visibility: "workspace",
      }),
    );
    await post(`/conversations/${conversation.id}/participants`, {
      agentId: agent.id,
      role: "contributor",
    });
    const run = record.parse(
      await post("/runs", {
        agentId: agent.id,
        conversationId: conversation.id,
        requestId: crypto.randomUUID(),
        type: "prompt",
        body: "Ask a human.",
      }),
    );
    await expect
      .poll(
        async () => {
          const response = await fetch(
            `${server.url.origin}/api/workspaces/${workspaceId}/runs/${run.id}/activity`,
            { headers: { cookie } },
          );
          return z
            .array(z.object({ type: z.string() }))
            .parse(await response.json())
            .some((event) => event.type === "question");
        },
        { timeout: 15000 },
      )
      .toBe(true);
    await post(
      `/agents/${agent.id}`,
      { model: "gpt-6-sol", editToken: 0 },
      "PATCH",
    );
    expect(
      (await database.db.select().from(runs).where(eq(runs.id, run.id)))[0]
        ?.state,
    ).toBe("running");
    expect(
      await post(`/runs/${run.id}/steer`, {
        requestId: crypto.randomUUID(),
        body: "Wait for my answer.",
      }),
    ).toEqual({ delivered: true });
    expect(await post(`/runs/${run.id}/stop`, {})).toEqual({ stopped: true });
    await expect
      .poll(
        async () =>
          (await database.db.select().from(runs).where(eq(runs.id, run.id)))[0]
            ?.state,
      )
      .toBe("interrupted");
    await expect.poll(() => runtime.health().active).toBe(0);
    expect(requests.length - scenarioStart).toBe(1);
    const observed = await fetch(
      `${server.url.origin}/api/workspaces/${workspaceId}/runs/${run.id}/usage`,
      { headers: { cookie } },
    );
    expect(observed.status).toBe(200);
    expect(await observed.json()).toMatchObject({
      complete: false,
      messageCount: 1,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    });
    expect(requests.at(-1)?.model).toBe(model);
    expect(runtime.health().persistenceErrors).toBe(0);
  });
  it("keeps observed usage incomplete when account revocation prevents the final native receipt", async () => {
    scenario = "question";
    scenarioStart = requests.length;
    const run = record.parse(
      await post("/runs", {
        ...continuing,
        requestId: crypto.randomUUID(),
        type: "prompt",
        body: "Ask a human before finishing.",
        documentIds: [documentId],
      }),
    );
    try {
      await expect
        .poll(
          async () => {
            const saved = (
              await database.db.select().from(runs).where(eq(runs.id, run.id))
            )[0];
            return saved?.usage.length;
          },
          { timeout: 15000 },
        )
        .toBe(1);
      await post(
        `/subscriptions/${subscriptionId}`,
        { status: "disabled" },
        "PATCH",
      );
      await expect
        .poll(
          async () =>
            (
              await database.db.select().from(runs).where(eq(runs.id, run.id))
            )[0]?.state,
        )
        .toBe("interrupted");
      await expect.poll(() => runtime.health().active).toBe(0);
      const response = await fetch(
        `${server.url.origin}/api/workspaces/${workspaceId}/runs/${run.id}/usage`,
        { headers: { cookie } },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        complete: false,
        messageCount: 1,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
      });
      expect(requests.length - scenarioStart).toBe(1);
      expect(runtime.health().persistenceErrors).toBe(0);
    } finally {
      await post(`/runs/${run.id}/stop`, {});
      await post(
        `/subscriptions/${subscriptionId}`,
        { status: "needs_auth" },
        "PATCH",
      );
      // Restore the same confirmed synthetic account fixture, not a browser qualification path.
      await database.db
        .update(subscriptions)
        .set({ status: "enabled" })
        .where(eq(subscriptions.id, subscriptionId));
    }
  });
  it("Stops the actual Pi process during startup without poisoning a sibling Run", async () => {
    await worker.stop({ graceful: false });
    scenario = "text";
    scenarioStart = requests.length;
    try {
      const agent = z.object({ agent: record }).parse(
        await post("/agents", {
          title: "Startup Stop",
          instructions: "Work",
          visibility: "workspace",
          model,
          subscriptionId,
        }),
      ).agent;
      await post(`/agents/${agent.id}/computer`, { computerRef: agent.id });
      const conversation = record.parse(
        await post("/conversations", {
          title: "Startup",
          visibility: "workspace",
        }),
      );
      await post(`/conversations/${conversation.id}/participants`, {
        agentId: agent.id,
        role: "contributor",
      });
      const run = record.parse(
        await post("/runs", {
          agentId: agent.id,
          conversationId: conversation.id,
          requestId: crypto.randomUUID(),
          type: "prompt",
          body: "Must stop before requesting a model.",
        }),
      );
      await runtime.dispatch(run.id);
      expect(await post(`/runs/${run.id}/stop`, {})).toEqual({ stopped: true });
      await expect.poll(() => runtime.health().active).toBe(0);
      expect(
        (await database.db.select().from(runs).where(eq(runs.id, run.id)))[0]
          ?.state,
      ).toBe("interrupted");
      expect(requests.length - scenarioStart).toBe(0);
      expect(runtime.health().persistenceErrors).toBe(0);
      const jobs = await boss.findJobs(RUN_QUEUE, { data: { runId: run.id } });
      if (jobs.length)
        await boss.cancel(
          RUN_QUEUE,
          jobs.map((job) => job.id),
        );
    } finally {
      worker = await startQueue(database.db, database.pool, { runtime, pi });
    }
  });
  it("executes a script with no AI account or model request", async () => {
    scenario = "text";
    scenarioStart = requests.length;
    const agent = z.object({ agent: record }).parse(
      await post("/agents", {
        title: "Script only",
        instructions: "Script",
        visibility: "workspace",
        model: "unused-model",
      }),
    ).agent;
    await post(`/agents/${agent.id}/computer`, { computerRef: agent.id });
    const conversation = record.parse(
      await post("/conversations", {
        title: "Script",
        visibility: "workspace",
      }),
    );
    await post(`/conversations/${conversation.id}/participants`, {
      agentId: agent.id,
      role: "contributor",
    });
    const run = record.parse(
      await post("/runs", {
        agentId: agent.id,
        conversationId: conversation.id,
        requestId: crypto.randomUUID(),
        type: "script",
        body: "printf controlled-script",
      }),
    );
    await expect
      .poll(
        async () =>
          (await database.db.select().from(runs).where(eq(runs.id, run.id)))[0]
            ?.state,
        { timeout: 15000 },
      )
      .toBe("finished");
    const accepted = (
      await database.db.select().from(runs).where(eq(runs.id, run.id))
    )[0];
    expect(accepted?.inputs.subscriptionId).toBeNull();
    expect(accepted?.inputs.accountId).toBeNull();
    expect(requests.length - scenarioStart).toBe(0);
  });
  it("retains unconfirmed model I/O when its transport ignores cancellation", async () => {
    scenario = "question";
    scenarioStart = requests.length;
    const agent = z.object({ agent: record }).parse(
      await post("/agents", {
        title: "Unjoined model transport",
        instructions: "Ask",
        visibility: "workspace",
        model,
        subscriptionId,
      }),
    ).agent;
    await post(`/agents/${agent.id}/computer`, { computerRef: agent.id });
    const conversation = record.parse(
      await post("/conversations", {
        title: "Unjoined transport",
        visibility: "workspace",
      }),
    );
    await post(`/conversations/${conversation.id}/participants`, {
      agentId: agent.id,
      role: "contributor",
    });
    const run = record.parse(
      await post("/runs", {
        agentId: agent.id,
        conversationId: conversation.id,
        requestId: crypto.randomUUID(),
        type: "prompt",
        body: "Ask human",
      }),
    );
    await expect
      .poll(
        async () =>
          (await database.db.select().from(runs).where(eq(runs.id, run.id)))[0]
            ?.usage.length,
        { timeout: 15000 },
      )
      .toBe(1);
    const current = (
      await database.db.select().from(runs).where(eq(runs.id, run.id))
    )[0];
    if (!current) throw new Error("Missing native attempt");
    const isolated = createModelGateway(database.db, {
      endpoint: "http://127.0.0.1:1",
      key: "controlled-unjoined",
      origin: server.url.origin,
      accounts,
      allowLoopbackHttp: true,
    });
    const access = await isolated.issue({
      runId: run.id,
      agentId: agent.id,
      attempt: current.attempt,
      launchKey: current.launchKey,
    });
    let finish: () => void = () => {};
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(new TextEncoder().encode("data: controlled\n\n"));
        finish = () => stream.close();
      },
    });
    const originalFetch = globalThis.fetch;
    const patched = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        if (String(input) === "http://127.0.0.1:1/otto/v1/responses")
          return Promise.resolve(
            new Response(body, {
              headers: { "content-type": "text/event-stream" },
            }),
          );
        return originalFetch(input, init);
      });
    let consumed: Promise<string> | undefined;
    try {
      const response = await isolated.handle(
        new Request(`${server.url.origin}/model/v1/responses`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${access.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ model, stream: true }),
        }),
      );
      consumed = response.text();
      void consumed.catch(() => {});
      await expect(access.release()).rejects.toThrow(
        "Model request cleanup unconfirmed",
      );
      await expect(isolated.close()).rejects.toThrow(
        "Model request cleanup unconfirmed",
      );
    } finally {
      finish();
      await consumed?.catch(() => {});
      patched.mockRestore();
      await post(`/runs/${run.id}/stop`, {});
      await expect.poll(() => runtime.health().active).toBe(0);
      expect(runtime.health().persistenceErrors).toBe(0);
    }
  });
  it("joins the actual native stream after participant revocation before output authorization", async () => {
    scenario = "text";
    scenarioStart = requests.length;
    let entered: () => void = () => {};
    let release: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    nativeTextObserved = false;
    publicationGate = async () => {
      entered();
      await blocked;
    };
    const agent = z.object({ agent: record }).parse(
      await post("/agents", {
        title: "Revocable native output",
        instructions: "Work",
        visibility: "workspace",
        model,
        subscriptionId,
      }),
    ).agent;
    await post(`/agents/${agent.id}/computer`, { computerRef: agent.id });
    const conversation = record.parse(
      await post("/conversations", {
        title: "Revocable output",
        visibility: "participants",
      }),
    );
    await post(`/conversations/${conversation.id}/participants`, {
      agentId: agent.id,
      role: "contributor",
    });
    const participant = (
      await database.db
        .select()
        .from(participants)
        .where(eq(participants.agentId, agent.id))
    )[0];
    if (!participant) throw new Error("Missing native participant");
    const run = record.parse(
      await post("/runs", {
        agentId: agent.id,
        conversationId: conversation.id,
        requestId: crypto.randomUUID(),
        type: "prompt",
        body: "Produce final text",
      }),
    );
    try {
      await started;
      expect(nativeTextObserved).toBe(true);
      await post(
        `/conversations/${conversation.id}/participants/${participant.id}`,
        {},
        "DELETE",
      );
      release();
      await expect
        .poll(() => runtime.health().active, { timeout: 10000 })
        .toBe(0);
      const saved = (
        await database.db.select().from(runs).where(eq(runs.id, run.id))
      )[0];
      expect(saved?.state).toBe("interrupted");
      const activity = await database.db
        .select()
        .from(runActivity)
        .where(eq(runActivity.runId, run.id));
      expect(activity.filter((event) => event.type === "output")).toHaveLength(
        0,
      );
      expect(runtime.health().persistenceErrors).toBe(0);
      expect(await gateway.isReady()).toBe(true);
      await post(`/conversations/${conversation.id}/participants`, {
        agentId: agent.id,
        role: "contributor",
      });
      const siblingAgent = z.object({ agent: record }).parse(
        await post("/agents", {
          title: "Sibling control",
          instructions: "Script",
          visibility: "workspace",
          model: "unused-model",
        }),
      ).agent;
      await post(`/agents/${siblingAgent.id}/computer`, {
        computerRef: siblingAgent.id,
      });
      await post(`/conversations/${conversation.id}/participants`, {
        agentId: siblingAgent.id,
        role: "contributor",
      });
      const sibling = record.parse(
        await post("/runs", {
          agentId: siblingAgent.id,
          conversationId: conversation.id,
          requestId: crypto.randomUUID(),
          type: "script",
          body: "printf sibling",
        }),
      );
      await expect
        .poll(
          async () =>
            (
              await database.db
                .select()
                .from(runs)
                .where(eq(runs.id, sibling.id))
            )[0]?.state,
          { timeout: 10000 },
        )
        .toBe("finished");
      expect(runtime.health().persistenceErrors).toBe(0);
      expect(requests.length - scenarioStart).toBe(1);
    } finally {
      release();
      publicationGate = undefined;
      await post(`/runs/${run.id}/stop`, {});
    }
  });
});
