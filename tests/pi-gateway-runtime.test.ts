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
  ACCOUNT_AUTH,
  type AccountAuth,
  createInfisicalAccounts,
  credentialFingerprint,
} from "../apps/server/src/subscription-secrets";
import { createRunTools, runToolSchema } from "../apps/server/src/tools";
import { agents } from "../packages/agents/src/schema";
import { participants } from "../packages/chats/src/schema";
import { type PiInstallation, RUN_QUEUE } from "../packages/runs/src";
import { createRunRuntime } from "../packages/runs/src/runtime";
import { runActivity, runs } from "../packages/runs/src/schema";
import { subscriptions } from "../packages/subscriptions/src/schema";
import { claimInstallation } from "../packages/workspaces/src";
import { members } from "../packages/workspaces/src/schema";
import { NativePiComputer } from "./fixtures/native-pi";
import { fixtureStorage, testSpool } from "./fixtures/storage";
import { startPostgres } from "./postgres";

const transfers = await testSpool();

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
  let connector: { id: string; cookie: string };
  let member: { id: string; cookie: string };
  let subscriptionId: string;
  let documentId: string;
  let skillId: string;
  const objects = new Map<string, Uint8Array>();
  const storage = fixtureStorage({
    async put(key, bytes) {
      objects.set(key, bytes.slice());
    },
    async get(key) {
      const bytes = objects.get(key);
      if (!bytes) throw new Error("Missing controlled Skill bytes");
      return bytes.slice();
    },
  });
  let savedCredential: AccountAuth;
  const accountId = "controlled-native-account";
  const model = "gpt-6.1-sol";
  let scenario:
    | "coding"
    | "question"
    | "text"
    | "skills"
    | "file"
    | "compaction"
    | "compaction-error"
    | "compaction-overflow"
    | "compaction-stop" = "coding";
  // Secret records for accounts connected through the real OAuth flow, and the models each upstream account offers.
  const records = new Map<string, AccountAuth>();
  const modelsBy = new Map<string, string[]>();
  let secretWriteFailure = false;
  let summaryRequests = 0;
  let summaryRelease: () => void = () => {};
  const requestAccounts: string[] = [];
  // Pi's own price computation observed on the native wire, used only to cross-check Otto's estimate.
  const nativeCosts: { type: string; total: number }[] = [];
  let connectingCredential = { accessToken: "", refreshToken: "" };
  let scenarioStart = 0;
  const questionRequestId = crypto.randomUUID();
  const fileRequestId = crypto.randomUUID();
  let continuing: {
    agentId: string;
    chatId: string;
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
    const compacting = scenario.startsWith("compaction");
    // After the large write, every request ends truncated below the output limit, so Pi compacts once, retries
    // and then reports that recovery already ran.
    if (scenario === "compaction-overflow" && index >= 2) {
      const response = {
        id: `response_${index}`,
        status: "incomplete",
        model,
        incomplete_details: { reason: "max_output_tokens" },
        output: [],
        usage: {
          input_tokens: 10,
          output_tokens: 2,
          total_tokens: 12,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      };
      return new Response(
        [
          {
            type: "response.created",
            response: { ...response, status: "in_progress" },
          },
          { type: "response.incomplete", response },
        ]
          .map(
            (event) =>
              `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
          )
          .join(""),
        { headers: { "content-type": "text/event-stream" } },
      );
    }
    const tool =
      scenario === "coding" || scenario === "skills" || scenario === "file"
        ? index < 3
        : compacting
          ? index === 1
          : scenario === "question" && index === 1;
    const name =
      scenario === "skills" && index === 1
        ? "read"
        : (scenario === "coding" || scenario === "file" || compacting) &&
            index === 1
          ? "write"
          : "otto";
    const args = JSON.stringify(
      compacting
        ? { path: "large.txt", content: "lorem ".repeat(20000) }
        : scenario === "skills"
          ? index === 1
            ? { path: `skills/${skillId}/references/guide.txt` }
            : { input: { name: "skill.get", skillId } }
          : scenario === "file" && index === 2
            ? {
                input: {
                  name: "file.create",
                  requestId: fileRequestId,
                  title: "Native Pi result",
                  type: "text",
                  labels: [],
                  visibility: "workspace",
                  mediaType: "text/plain",
                  text: "written by managed Pi\n",
                },
              }
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
          // The second compaction-scenario message crosses Pi's context threshold and the 272000-token price tier.
          usage:
            compacting && index === 2
              ? {
                  input_tokens: 300000,
                  output_tokens: 5,
                  total_tokens: 300005,
                  input_tokens_details: { cached_tokens: 50000 },
                  output_tokens_details: { reasoning_tokens: 0 },
                }
              : {
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
  async function summary(request: Request) {
    summaryRequests++;
    if (scenario === "compaction-error")
      return new Response("controlled summary failure", { status: 500 });
    if (scenario === "compaction-stop")
      await new Promise<void>((resolve) => {
        summaryRelease = resolve;
        request.signal.addEventListener("abort", () => resolve(), {
          once: true,
        });
      });
    const item = {
      type: "message",
      id: "msg_summary",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "SUMMARY", annotations: [] }],
    };
    const events = [
      {
        type: "response.created",
        response: { id: "response_summary", status: "in_progress", model },
      },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { ...item, content: [] },
      },
      {
        type: "response.content_part.added",
        item_id: "msg_summary",
        output_index: 0,
        content_index: 0,
        part: { type: "output_text", text: "", annotations: [] },
      },
      {
        type: "response.output_text.delta",
        item_id: "msg_summary",
        output_index: 0,
        content_index: 0,
        delta: "SUMMARY",
      },
      {
        type: "response.output_text.done",
        item_id: "msg_summary",
        output_index: 0,
        content_index: 0,
        text: "SUMMARY",
      },
      { type: "response.output_item.done", output_index: 0, item },
      {
        type: "response.completed",
        response: {
          id: "response_summary",
          status: "completed",
          model,
          output: [item],
          usage: {
            input_tokens: 500,
            output_tokens: 7,
            total_tokens: 507,
            input_tokens_details: { cached_tokens: 100 },
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
  async function post(
    path: string,
    value: unknown,
    method = "POST",
    as = cookie,
  ) {
    const response = await fetch(
      `${server.url.origin}/api/workspaces/${workspaceId}${path}`,
      {
        method,
        headers: {
          cookie: as,
          origin: server.url.origin,
          "content-type": "application/json",
        },
        body: JSON.stringify(value),
      },
    );
    expect(
      response.status,
      `${method} ${path} ${await response.clone().text()}`,
    ).toBe(200);
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
          const input = z
            .record(z.string(), z.unknown())
            .parse(await request.clone().json());
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
    async function signupUser(name: string) {
      const response = await fetch(
        `${server.url.origin}/api/auth/sign-up/email`,
        {
          method: "POST",
          headers: {
            origin: server.url.origin,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name,
            email: `${name}@native-pi.test`,
            password: crypto.randomUUID() + crypto.randomUUID(),
          }),
        },
      );
      expect(response.status).toBe(200);
      const user = z
        .object({ user: z.object({ id: z.string() }) })
        .parse(await response.json()).user;
      return { id: user.id, cookie: response.headers.get("set-cookie") ?? "" };
    }
    connector = await signupUser("connector");
    member = await signupUser("member");
    await database.db.insert(members).values(
      [connector, member].map((human) => ({
        workspaceId,
        userId: human.id,
        role: "contributor" as const,
      })),
    );
    modelsBy.set(accountId, [model, "gpt-6-sol"]);
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
        if (path.startsWith("/api/v4/secrets/")) {
          const id = (path.split("/").at(-1) ?? "")
            .replace("OTTO_ACCOUNT_", "")
            .replaceAll("_", "-");
          if (request.method !== "GET") {
            if (secretWriteFailure) return new Response(null, { status: 503 });
            records.set(
              id,
              ACCOUNT_AUTH.parse(
                JSON.parse(
                  z
                    .object({ secretValue: z.string() })
                    .parse(await request.json()).secretValue,
                ),
              ),
            );
          }
          const value =
            id === subscriptionId ? savedCredential : records.get(id);
          if (!value) return new Response(null, { status: 404 });
          return Response.json({
            secret: { secretValue: JSON.stringify(value) },
          });
        }
        if (path.startsWith("/oauth-peer/")) {
          const connected = connectingCredential;
          if (path.endsWith("/usercode"))
            return Response.json({
              device_auth_id: "controlled-device",
              user_code: "CONTROLLED",
              interval: 0,
            });
          if (path.endsWith("/deviceauth/token"))
            return Response.json({
              authorization_code: "controlled-code",
              code_verifier: "controlled-verifier",
            });
          return Response.json({
            access_token: connected.accessToken,
            refresh_token: connected.refreshToken,
            expires_in: 3600,
          });
        }
        // Each upstream call must carry the account whose token it presents; no fallback account may serve it.
        const bearer = request.headers.get("authorization");
        const upstream = [savedCredential, ...records.values()].find(
          (value) => `Bearer ${value.credential.accessToken}` === bearer,
        );
        expect(upstream).toBeDefined();
        const upstreamAccount = upstream?.credential.accountId ?? "";
        expect(request.headers.get("chatgpt-account-id")).toBe(upstreamAccount);
        if (path.endsWith("/models"))
          return Response.json({
            models: (modelsBy.get(upstreamAccount) ?? [model]).map((slug) => ({
              slug,
            })),
          });
        expect(path.endsWith("/responses")).toBe(true);
        requestAccounts.push(upstreamAccount);
        const raw = z
          .object({ tools: z.unknown().optional() })
          .passthrough()
          .parse(await request.json());
        // Pi's compaction summary is a model request without tools or a Session cache key.
        if (raw.tools === undefined) return summary(request);
        const value = modelRequest.parse(raw);
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
                    const json: unknown = JSON.parse(line);
                    const event = z
                      .object({
                        type: z.string(),
                        assistantMessageEvent: z
                          .object({ type: z.string() })
                          .optional(),
                      })
                      .parse(json);
                    const priced = z
                      .object({
                        type: z.enum(["message_end", "compaction_end"]),
                        message: z
                          .object({
                            role: z.literal("assistant"),
                            usage: z.object({
                              cost: z.object({ total: z.number() }),
                            }),
                          })
                          .optional(),
                        result: z
                          .object({
                            usage: z.object({
                              cost: z.object({ total: z.number() }),
                            }),
                          })
                          .optional(),
                      })
                      .safeParse(json);
                    const cost =
                      priced.data?.message?.usage.cost.total ??
                      priced.data?.result?.usage.cost.total;
                    if (priced.success && cost !== undefined)
                      nativeCosts.push({ type: priced.data.type, total: cost });
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
      spool: transfers.spool,
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
    const chat = record.parse(
      await post("/chats", {
        title: "Native loop",
        visibility: "workspace",
      }),
    );
    await post(`/chats/${chat.id}/participants`, {
      agentId: agent.id,
      role: "contributor",
    });
    const input = {
      agentId: agent.id,
      chatId: chat.id,
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
    // 3 final receipts x (10 in, 2 out) at the accepted gpt-6.1-sol list price (USD 2 / 10 per million tokens).
    expect(await response.json()).toEqual({
      provider: "codex",
      model,
      scope: "pi_observed",
      complete: true,
      messageCount: 3,
      unreportedCount: 0,
      inputTokens: 30,
      outputTokens: 6,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 36,
      estimatedCost: {
        amount: 0.00012,
        currency: "USD",
        basis: "api_list_price",
      },
    });
    // Pi's own native computation, from the same accepted price, agrees with Otto's estimate.
    expect(
      nativeCosts
        .filter((cost) => cost.type === "message_end")
        .reduce((sum, cost) => sum + cost.total, 0),
    ).toBeCloseTo(0.00012, 9);
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
      chatId: chat.id,
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
      await post("/files", {
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
        files: [{ path: "references/guide.txt", fileId: file.id }],
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
    const chat = record.parse(
      await post("/chats", {
        title: "Skills",
        visibility: "workspace",
      }),
    );
    await post(`/chats/${chat.id}/participants`, {
      agentId: agent.id,
      role: "contributor",
    });
    await worker.stop({ graceful: false });
    let runId: string | undefined;
    try {
      runId = record.parse(
        await post("/runs", {
          agentId: agent.id,
          chatId: chat.id,
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
  it("published Pi advertises and calls file.create through the real gateway and saves immutable scoped output", async () => {
    scenario = "file";
    scenarioStart = requests.length;
    const run = record.parse(
      await post("/runs", {
        ...continuing,
        requestId: crypto.randomUUID(),
        type: "prompt",
        body: "Write and save a File.",
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
    const description = requests[scenarioStart]?.tools.find(
      (tool) => tool.name === "otto",
    )?.description;
    expect(description).toContain('"file.create"');
    expect(description).not.toContain('"resource.create"');
    const response = await fetch(
      `${server.url.origin}/api/workspaces/${workspaceId}/files`,
      { headers: { cookie } },
    );
    expect(response.status).toBe(200);
    const result = z
      .object({
        items: z.array(
          z.object({ id: z.string(), title: z.string() }).passthrough(),
        ),
      })
      .parse(await response.json())
      .items.find((row) => row.title === "Native Pi result");
    if (!result) throw new Error("Missing native File output");
    const metadata = await fetch(
      `${server.url.origin}/api/workspaces/${workspaceId}/files/${result.id}`,
      { headers: { cookie } },
    );
    expect(await metadata.json()).toMatchObject({
      sourceRunId: run.id,
      creatorAgentId: continuing.agentId,
    });
    const bytes = await fetch(
      `${server.url.origin}/api/workspaces/${workspaceId}/files/${result.id}/file`,
      { headers: { cookie } },
    );
    expect(bytes.status).toBe(200);
    expect(await bytes.text()).toBe("written by managed Pi\n");
    expect(requests.length - scenarioStart).toBe(3);
    expect(runtime.health().persistenceErrors).toBe(0);
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
      // The upstream peer now serves the swapped account validly, so the Session's bound account is what refuses
      // it; Otto exposes only the conflict, not upstream identity details.
      expect(response.status).toBe(409);
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
    const chat = record.parse(
      await post("/chats", {
        title: "Question",
        visibility: "workspace",
      }),
    );
    await post(`/chats/${chat.id}/participants`, {
      agentId: agent.id,
      role: "contributor",
    });
    const run = record.parse(
      await post("/runs", {
        agentId: agent.id,
        chatId: chat.id,
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
      const chat = record.parse(
        await post("/chats", {
          title: "Startup",
          visibility: "workspace",
        }),
      );
      await post(`/chats/${chat.id}/participants`, {
        agentId: agent.id,
        role: "contributor",
      });
      const run = record.parse(
        await post("/runs", {
          agentId: agent.id,
          chatId: chat.id,
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
    const chat = record.parse(
      await post("/chats", {
        title: "Script",
        visibility: "workspace",
      }),
    );
    await post(`/chats/${chat.id}/participants`, {
      agentId: agent.id,
      role: "contributor",
    });
    const run = record.parse(
      await post("/runs", {
        agentId: agent.id,
        chatId: chat.id,
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
    const chat = record.parse(
      await post("/chats", {
        title: "Unjoined transport",
        visibility: "workspace",
      }),
    );
    await post(`/chats/${chat.id}/participants`, {
      agentId: agent.id,
      role: "contributor",
    });
    const run = record.parse(
      await post("/runs", {
        agentId: agent.id,
        chatId: chat.id,
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
    const chat = record.parse(
      await post("/chats", {
        title: "Revocable output",
        visibility: "participants",
      }),
    );
    await post(`/chats/${chat.id}/participants`, {
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
        chatId: chat.id,
        requestId: crypto.randomUUID(),
        type: "prompt",
        body: "Produce final text",
      }),
    );
    try {
      await started;
      expect(nativeTextObserved).toBe(true);
      await post(
        `/chats/${chat.id}/participants/${participant.id}`,
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
      await post(`/chats/${chat.id}/participants`, {
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
      await post(`/chats/${chat.id}/participants`, {
        agentId: siblingAgent.id,
        role: "contributor",
      });
      const sibling = record.parse(
        await post("/runs", {
          agentId: siblingAgent.id,
          chatId: chat.id,
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
  async function compactionRun(name: string) {
    await accountReady(subscriptionId);
    const agent = z.object({ agent: record }).parse(
      await post("/agents", {
        title: name,
        instructions: "Work",
        visibility: "workspace",
        model,
        subscriptionId,
      }),
    ).agent;
    await post(`/agents/${agent.id}/computer`, { computerRef: agent.id });
    const chat = record.parse(
      await post("/chats", { title: name, visibility: "workspace" }),
    );
    await post(`/chats/${chat.id}/participants`, {
      agentId: agent.id,
      role: "contributor",
    });
    scenarioStart = requests.length;
    summaryRequests = 0;
    nativeCosts.length = 0;
    return record.parse(
      await post("/runs", {
        agentId: agent.id,
        chatId: chat.id,
        requestId: crypto.randomUUID(),
        type: "prompt",
        body: "Write a large file and report.",
      }),
    );
  }
  async function usageOf(runId: string, as = cookie) {
    const response = await fetch(
      `${server.url.origin}/api/workspaces/${workspaceId}/runs/${runId}/usage`,
      { headers: { cookie: as } },
    );
    expect(response.status).toBe(200);
    return response.json();
  }
  /** The gateway keeps an account gate until earlier native I/O has joined; wait for it instead of racing it. */
  async function accountReady(id: string, as = cookie) {
    await expect
      .poll(
        async () => (await call(as, `/subscriptions/${id}/models`)).status,
        {
          timeout: 20000,
        },
      )
      .toBe(200);
  }
  it("counts the actual native automatic compaction summary once and prices the 272000-token tier like Pi", async () => {
    scenario = "compaction";
    const run = await compactionRun("Automatic compaction");
    await expect
      .poll(
        async () =>
          (await database.db.select().from(runs).where(eq(runs.id, run.id)))[0]
            ?.state,
        { timeout: 20000 },
      )
      .toBe("finished");
    expect(summaryRequests).toBe(1);
    const saved = (
      await database.db.select().from(runs).where(eq(runs.id, run.id))
    )[0];
    expect(saved?.usage.map((receipt) => receipt.sequence)).toEqual([1, 2, 3]);
    // tool-call message, threshold message (300000 request input), then the compaction summary request.
    // Pi reports input excluding cached tokens: 250000 input + 50000 cacheRead; summary 400 + 100.
    const tier = (250000 * 4 + 5 * 15 + 50000 * 0.2) / 1e6;
    const base = (10 * 2 + 2 * 10) / 1e6;
    const summaryCost = (400 * 2 + 7 * 10 + 100 * 0.1) / 1e6;
    expect(await usageOf(run.id)).toEqual({
      provider: "codex",
      model,
      scope: "pi_observed",
      complete: true,
      messageCount: 3,
      unreportedCount: 0,
      inputTokens: 10 + 250000 + 400,
      outputTokens: 2 + 5 + 7,
      cacheReadTokens: 0 + 50000 + 100,
      cacheWriteTokens: 0,
      totalTokens: 12 + 300005 + 507,
      estimatedCost: {
        amount: Math.round((base + tier + summaryCost) * 1e9) / 1e9,
        currency: "USD",
        basis: "api_list_price",
      },
    });
    // The compaction summary needed no Session cache key, yet stayed on the accepted account and model.
    expect(new Set(requestAccounts.slice(-3))).toEqual(new Set([accountId]));
    expect(nativeCosts.reduce((sum, cost) => sum + cost.total, 0)).toBeCloseTo(
      base + tier + summaryCost,
      9,
    );
    expect(runtime.health().persistenceErrors).toBe(0);
  });
  it("keeps whole-Run totals and cost unknown when the native summary request fails and retries", async () => {
    scenario = "compaction-error";
    const run = await compactionRun("Failing compaction");
    await expect
      .poll(
        async () =>
          (await database.db.select().from(runs).where(eq(runs.id, run.id)))[0]
            ?.state,
        { timeout: 40000 },
      )
      .toBe("finished");
    const usage = z
      .object({
        complete: z.boolean(),
        messageCount: z.number(),
        unreportedCount: z.number(),
        inputTokens: z.null(),
        totalTokens: z.null(),
        estimatedCost: z.null(),
      })
      .parse(await usageOf(run.id));
    // two reported messages plus one unmeasured receipt for every failed summary request (initial + 3 retries).
    expect(summaryRequests).toBeGreaterThanOrEqual(4);
    expect(usage).toMatchObject({
      complete: true,
      messageCount: 2 + 4,
      unreportedCount: 4,
    });
    expect(runtime.health().persistenceErrors).toBe(0);
  }, 60000);
  it("native overflow recovery already attempted ends the Run cleanly without an unstarted-compaction fault", async () => {
    scenario = "compaction-overflow";
    const run = await compactionRun("Overflow recovery");
    await expect
      .poll(
        async () =>
          (await database.db.select().from(runs).where(eq(runs.id, run.id)))[0]
            ?.state,
        { timeout: 30000 },
      )
      .toBe("failed");
    await expect.poll(() => runtime.health().active).toBe(0);
    // One summary request ran; the second overflow only produced Pi's terminal notice, with no receipt of its own.
    expect(summaryRequests).toBeGreaterThanOrEqual(1);
    expect(await usageOf(run.id)).toMatchObject({
      complete: false,
      inputTokens: null,
      estimatedCost: null,
    });
    expect(runtime.health().persistenceErrors).toBe(0);
  }, 40000);
  it("Stopping during the native compaction summary keeps usage incomplete without inventing counts", async () => {
    scenario = "compaction-stop";
    const run = await compactionRun("Stopped compaction");
    await expect.poll(() => summaryRequests, { timeout: 20000 }).toBe(1);
    expect(await post(`/runs/${run.id}/stop`, {})).toEqual({ stopped: true });
    summaryRelease();
    await expect
      .poll(
        async () =>
          (await database.db.select().from(runs).where(eq(runs.id, run.id)))[0]
            ?.state,
        { timeout: 20000 },
      )
      .toBe("interrupted");
    await expect.poll(() => runtime.health().active).toBe(0);
    // Receipts after a Stop request are not published, so the in-flight summary leaves only the two earlier
    // messages: incomplete, with no whole-Run total or cost presented.
    expect(await usageOf(run.id)).toMatchObject({
      complete: false,
      messageCount: 2,
      inputTokens: null,
      totalTokens: null,
      estimatedCost: null,
    });
    expect(runtime.health().persistenceErrors).toBe(0);
  });
  // The account owner connects through the public SDK OAuth flow; members only ever use shared capability.
  const connectedAccount = "controlled-connected-account";
  function connectedCredential(account: string) {
    const payload = Buffer.from(
      JSON.stringify({
        "https://api.openai.com/auth": { chatgpt_account_id: account },
      }),
    ).toString("base64url");
    return {
      accessToken: `fixture.${payload}.fixture`,
      refreshToken: `refresh-${account}`,
    };
  }
  async function call(
    as: string,
    path: string,
    method = "GET",
    value?: unknown,
  ) {
    return fetch(`${server.url.origin}/api/workspaces/${workspaceId}${path}`, {
      method,
      headers: {
        cookie: as,
        origin: server.url.origin,
        "content-type": "application/json",
      },
      body: value === undefined ? undefined : JSON.stringify(value),
    });
  }
  async function login(id: string, as: string) {
    const nativeFetch = globalThis.fetch;
    const scoped: typeof fetch = Object.assign(
      async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        if (url.hostname === "auth.openai.com") {
          url.protocol = "http:";
          url.host = peer.url.host;
          url.pathname = `/oauth-peer${url.pathname}`;
          return nativeFetch(url, init);
        }
        if (url.hostname !== "127.0.0.1")
          throw new Error("External request denied in fixture");
        return nativeFetch(input, init);
      },
      { preconnect: nativeFetch.preconnect },
    );
    vi.stubGlobal("fetch", scoped);
    try {
      const response = await call(as, `/subscriptions/${id}/login`, "POST");
      expect(response.status).toBe(200);
      return (await response.text())
        .trim()
        .split("\n")
        .map((line) =>
          z.object({ type: z.string() }).passthrough().parse(JSON.parse(line)),
        );
    } finally {
      vi.unstubAllGlobals();
    }
  }
  async function statusOf(id: string) {
    return (
      await database.db
        .select({ status: subscriptions.status })
        .from(subscriptions)
        .where(eq(subscriptions.id, id))
    )[0]?.status;
  }
  async function counts() {
    return {
      runs: (await database.db.select({ id: runs.id }).from(runs)).length,
      agents: (await database.db.select({ id: agents.id }).from(agents)).length,
      upstream: requestAccounts.length,
    };
  }
  let sharedId = "";
  async function memberAgent(
    model_: string,
    title: string,
    subscription = sharedId,
  ) {
    const agent = z.object({ agent: record }).parse(
      await post(
        "/agents",
        {
          title,
          instructions: "Work",
          visibility: "workspace",
          model: model_,
          subscriptionId: subscription,
        },
        "POST",
        member.cookie,
      ),
    ).agent;
    await post(
      `/agents/${agent.id}/computer`,
      { computerRef: agent.id },
      "POST",
      member.cookie,
    );
    const chat = record.parse(
      await post(
        "/chats",
        { title, visibility: "workspace" },
        "POST",
        member.cookie,
      ),
    );
    await post(
      `/chats/${chat.id}/participants`,
      { agentId: agent.id, role: "contributor" },
      "POST",
      member.cookie,
    );
    return { agent, chat };
  }
  function memberRun(
    target: { agent: { id: string }; chat: { id: string } },
    body: string,
  ) {
    return call(member.cookie, "/runs", "POST", {
      agentId: target.agent.id,
      chatId: target.chat.id,
      requestId: crypto.randomUUID(),
      type: "prompt",
      body,
    });
  }
  async function runState(id: string) {
    return (await database.db.select().from(runs).where(eq(runs.id, id)))[0]
      ?.state;
  }
  it("a user-visibility account connected through OAuth is invisible and unusable to members, with no side effects", async () => {
    const created = z
      .object({
        id: z.uuid(),
        status: z.literal("needs_auth"),
        visibility: z.literal("user"),
      })
      .parse(
        await post(
          "/subscriptions",
          { title: "Connected", provider: "codex" },
          "POST",
          connector.cookie,
        ),
      );
    sharedId = created.id;
    connectingCredential = connectedCredential(connectedAccount);
    modelsBy.set(connectedAccount, [model]);
    expect(await login(sharedId, connector.cookie)).toEqual([
      {
        type: "device_code",
        verificationUri: "https://auth.openai.com/codex/device",
        userCode: "CONTROLLED",
        expiresInSeconds: 300,
      },
      { type: "connected", provider: "codex" },
    ]);
    expect(await statusOf(sharedId)).toBe("enabled");
    expect(records.get(sharedId)?.credential.accountId).toBe(connectedAccount);
    const before = await counts();
    const list = z
      .object({ items: z.array(z.object({ id: z.uuid() })) })
      .parse(await (await call(member.cookie, "/subscriptions")).json());
    expect(list.items.map((item) => item.id)).not.toContain(sharedId);
    for (const [path, method, value] of [
      [`/subscriptions/${sharedId}`, "GET"],
      [`/subscriptions/${sharedId}/models`, "GET"],
      [`/subscriptions/${sharedId}`, "PATCH", { visibility: "workspace" }],
      [`/subscriptions/${sharedId}/login`, "POST"],
    ] as const)
      expect((await call(member.cookie, path, method, value)).status).toBe(403);
    // An Agent cannot be pointed at an account its author may not use, and no Run reaches the provider.
    expect(
      (
        await call(member.cookie, "/agents", "POST", {
          title: "Private account",
          instructions: "Work",
          visibility: "workspace",
          model,
          subscriptionId: sharedId,
        })
      ).status,
    ).toBe(403);
    expect(await statusOf(sharedId)).toBe("enabled");
    expect(await counts()).toEqual(before);
  });
  it("explicit sharing lets a member discover the exact account models and run end to end without credentials", async () => {
    expect(
      (
        await call(connector.cookie, `/subscriptions/${sharedId}`, "PATCH", {
          visibility: "workspace",
        })
      ).status,
    ).toBe(200);
    const view = await (
      await call(member.cookie, `/subscriptions/${sharedId}`)
    ).text();
    expect(Object.keys(JSON.parse(view)).sort()).toEqual([
      "createdAt",
      "createdBy",
      "id",
      "provider",
      "status",
      "title",
      "updatedAt",
      "visibility",
    ]);
    expect(JSON.parse(view)).toMatchObject({
      createdBy: connector.id,
      visibility: "workspace",
      status: "enabled",
    });
    const memberList = z
      .object({ items: z.array(z.object({ id: z.uuid() })) })
      .parse(await (await call(member.cookie, "/subscriptions")).json());
    expect(memberList.items.map((item) => item.id)).toContain(sharedId);
    // Creator-only control stays with the connector.
    for (const [path, method, value] of [
      [`/subscriptions/${sharedId}`, "PATCH", { status: "disabled" }],
      [`/subscriptions/${sharedId}/login`, "POST"],
    ] as const)
      expect((await call(member.cookie, path, method, value)).status).toBe(403);
    expect(await statusOf(sharedId)).toBe("enabled");
    // Discovery is per exact account: the primary account offers a second model, this one does not.
    const discovered = await call(
      member.cookie,
      `/subscriptions/${sharedId}/models`,
    );
    const discoveredText = await discovered.text();
    expect(JSON.parse(discoveredText)).toEqual({
      items: [{ id: model }],
      next: null,
    });
    await accountReady(subscriptionId);
    const primary = await call(
      cookie,
      `/subscriptions/${subscriptionId}/models`,
    );
    expect(
      z
        .object({ items: z.array(z.object({ id: z.string() })) })
        .parse(await primary.json())
        .items.map((item) => item.id)
        .sort(),
    ).toEqual([model, "gpt-6-sol"].sort());
    // A model this account does not offer is refused at admission, with no Run and no provider request.
    const unavailable = await memberAgent("gpt-6-sol", "Unavailable model");
    const before = await counts();
    expect((await memberRun(unavailable, "Use another model")).status).toBe(
      403,
    );
    expect(await counts()).toEqual(before);
    scenario = "coding";
    scenarioStart = requests.length;
    const target = await memberAgent(model, "Shared account member");
    const run = record.parse(
      await (
        await memberRun(
          target,
          "Write a file, read the accepted document and report.",
        )
      ).json(),
    );
    await expect
      .poll(() => runState(run.id), { timeout: 20000 })
      .toBe("finished");
    // Every upstream request of the member's Run used the connector's account, never the primary one.
    expect(requestAccounts.slice(before.upstream)).toEqual(
      Array(requests.length - scenarioStart).fill(connectedAccount),
    );
    const usage = await usageOf(run.id, member.cookie);
    expect(usage).toMatchObject({
      scope: "pi_observed",
      complete: true,
      messageCount: requests.length - scenarioStart,
      estimatedCost: { currency: "USD", basis: "api_list_price" },
    });
    const body = JSON.stringify([usage, view, discoveredText]);
    for (const secret of [
      connectedCredential(connectedAccount).accessToken,
      connectedCredential(connectedAccount).refreshToken,
    ])
      expect(body).not.toContain(secret);
  });
  async function pendingMemberRun(title: string) {
    scenario = "question";
    const target = await memberAgent(model, title);
    scenarioStart = requests.length;
    const run = record.parse(
      await (await memberRun(target, "Ask a human before finishing.")).json(),
    );
    await expect
      .poll(
        async () =>
          (await database.db.select().from(runs).where(eq(runs.id, run.id)))[0]
            ?.usage.length,
        { timeout: 20000 },
      )
      .toBe(1);
    return { run, target };
  }
  it("shrinking a shared account to user stops the active member Run and denies new use, with no provider fallback", async () => {
    const { run, target } = await pendingMemberRun("Shrink while active");
    const upstream = requestAccounts.length;
    expect(
      (
        await call(connector.cookie, `/subscriptions/${sharedId}`, "PATCH", {
          visibility: "user",
        })
      ).status,
    ).toBe(200);
    await expect
      .poll(() => runState(run.id), { timeout: 20000 })
      .toBe("interrupted");
    await expect.poll(() => runtime.health().active).toBe(0);
    expect(await usageOf(run.id, member.cookie)).toMatchObject({
      complete: false,
      messageCount: 1,
      totalTokens: null,
      estimatedCost: null,
    });
    const before = await counts();
    expect((await memberRun(target, "Try again")).status).toBe(403);
    for (const path of [
      `/subscriptions/${sharedId}`,
      `/subscriptions/${sharedId}/models`,
    ])
      expect((await call(member.cookie, path)).status).toBe(403);
    expect(await counts()).toEqual(before);
    expect(requestAccounts.length).toBe(upstream);
    // The creator still sees and controls it; sharing again restores member use.
    expect(
      (await call(connector.cookie, `/subscriptions/${sharedId}`)).status,
    ).toBe(200);
    expect(
      (
        await call(connector.cookie, `/subscriptions/${sharedId}`, "PATCH", {
          visibility: "workspace",
        })
      ).status,
    ).toBe(200);
    expect(runtime.health().persistenceErrors).toBe(0);
  });
  it("removing the account creator from the workspace revokes shared use mid-Run and for new Runs", async () => {
    const { run, target } = await pendingMemberRun(
      "Creator removed while active",
    );
    const upstream = requestAccounts.length;
    expect(
      (await call(cookie, `/members/${connector.id}`, "DELETE")).status,
    ).toBe(200);
    try {
      await expect
        .poll(() => runState(run.id), { timeout: 20000 })
        .toBe("interrupted");
      await expect.poll(() => runtime.health().active).toBe(0);
      expect(await usageOf(run.id, member.cookie)).toMatchObject({
        complete: false,
        totalTokens: null,
        estimatedCost: null,
      });
      const before = await counts();
      expect((await memberRun(target, "Creator is gone")).status).toBe(403);
      expect(
        (await call(member.cookie, `/subscriptions/${sharedId}`)).status,
      ).not.toBe(200);
      expect(await counts()).toEqual(before);
      expect(requestAccounts.length).toBe(upstream);
    } finally {
      await database.db
        .insert(members)
        .values({ workspaceId, userId: connector.id, role: "contributor" });
    }
    // Re-adding the same human restores the same account for members.
    scenario = "text";
    scenarioStart = requests.length;
    const again = record.parse(
      await (await memberRun(target, "Back again")).json(),
    );
    await expect
      .poll(() => runState(again.id), { timeout: 20000 })
      .toBe("finished");
    expect(new Set(requestAccounts.slice(upstream))).toEqual(
      new Set([connectedAccount]),
    );
    expect(runtime.health().persistenceErrors).toBe(0);
  });
  it("an unacknowledged refresh write leaves the shared account unavailable until its creator authenticates again; a different identity is refused", async () => {
    scenario = "text";
    const target = await memberAgent(model, "Refresh authority");
    const stored = records.get(sharedId);
    if (!stored) throw new Error("Missing connected account record");
    const rotated = {
      ...stored.credential,
      refreshToken: "refresh-rotated",
      expired: "2031-01-01T00:00:00.000Z",
    };
    const refresh = (credential: typeof rotated) =>
      fetch(`${server.url.origin}/internal/gateway/accounts/${sharedId}`, {
        method: "PUT",
        headers: {
          authorization: "Bearer synthetic-store-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          expectedFingerprint: credentialFingerprint(stored.credential),
          expectedAuthenticatedAt: stored.authenticatedAt,
          credential,
        }),
      });
    secretWriteFailure = true;
    try {
      expect((await refresh(rotated)).status).toBeGreaterThanOrEqual(500);
    } finally {
      secretWriteFailure = false;
    }
    // Uncertainty is persisted before delivery, so the account stays unavailable for every member.
    expect(await statusOf(sharedId)).toBe("needs_auth");
    expect(records.get(sharedId)).toEqual(stored);
    const before = await counts();
    expect((await memberRun(target, "Unavailable")).status).toBe(403);
    expect(
      (await call(member.cookie, `/subscriptions/${sharedId}/models`)).status,
    ).toBe(403);
    expect(await counts()).toEqual(before);
    // A restarted service sees the same durable state; a later refresh cannot re-qualify it.
    const restarted = createSubscriptionLogin(
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
    try {
      await expect(
        restarted.read(sharedId, new AbortController().signal),
      ).rejects.toThrow();
    } finally {
      await restarted.close();
    }
    expect((await refresh(rotated)).status).toBe(403);
    expect(await statusOf(sharedId)).toBe("needs_auth");
    // Another ChatGPT identity cannot take over this Subscription; the old account record is untouched.
    connectingCredential = connectedCredential("another-controlled-account");
    expect((await login(sharedId, connector.cookie)).at(-1)).toEqual({
      type: "error",
      code: "login_failed",
    });
    expect(await statusOf(sharedId)).toBe("needs_auth");
    expect(records.get(sharedId)).toEqual(stored);
    expect((await memberRun(target, "Still unavailable")).status).toBe(403);
    expect(await counts()).toEqual(before);
    // Only the creator's fresh OAuth restores the same account for members.
    connectingCredential = connectedCredential(connectedAccount);
    expect((await login(sharedId, connector.cookie)).at(-1)).toEqual({
      type: "connected",
      provider: "codex",
    });
    expect(await statusOf(sharedId)).toBe("enabled");
    scenarioStart = requests.length;
    const run = record.parse(
      await (await memberRun(target, "Available again")).json(),
    );
    await expect
      .poll(() => runState(run.id), { timeout: 20000 })
      .toBe("finished");
    expect(new Set(requestAccounts.slice(before.upstream))).toEqual(
      new Set([connectedAccount]),
    );
  });
});
