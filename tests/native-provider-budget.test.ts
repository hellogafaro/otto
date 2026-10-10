import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { z } from "zod";
import { readConfig } from "../apps/server/src/config";
import { startServer } from "../apps/server/src/lifecycle";
import { startQueue } from "../apps/server/src/queue";
import { createAgent } from "../packages/agents/src";
import { createChat, createParticipant } from "../packages/chats/src";
import { createEnvironment } from "../packages/environments/src";
import { runs } from "../packages/runs/src/schema";
import { createSubscription } from "../packages/subscriptions/src";
import type { NativeModelConfig } from "../packages/subscriptions/src/native-provider-config";
import { createProviderFetch } from "../packages/subscriptions/src/native-provider-http";
import { createNativeModel } from "../packages/subscriptions/src/native-provider-model";
import { setSubscriptionApiKey } from "../packages/subscriptions/src/server";
import { claimInstallation, inWorkspace } from "../packages/workspaces/src";
import { fixtureEncryptionKey } from "./fixtures/native-model";
import { startPostgres } from "./postgres";

const network = vi.hoisted(() => ({
  lookup: vi.fn(),
  calls: [] as {
    body: string;
    signal: AbortSignal;
    headers: Record<string, string>;
  }[],
  mode: "json" as "json" | "steps" | "error" | "pending",
  response: {} as unknown,
}));
vi.mock("node:dns/promises", () => ({
  lookup: async (...args: unknown[]) => {
    await network.lookup(...args);
    return [{ address: "8.8.8.8", family: 4 }];
  },
}));
vi.mock("node:https", () => ({
  request: (
    _url: URL,
    options: { signal: AbortSignal; headers: Record<string, string> },
    callback: (
      incoming: PassThrough & {
        statusCode: number;
        headers: Record<string, string>;
      },
    ) => void,
  ) => {
    const outgoing = new EventEmitter() as EventEmitter & {
      end(body: string): void;
    };
    outgoing.end = (body) => {
      network.calls.push({
        body,
        signal: options.signal,
        headers: options.headers,
      });
      if (network.mode === "pending") {
        options.signal.addEventListener(
          "abort",
          () => outgoing.emit("error", new Error("Controlled abort")),
          { once: true },
        );
        return;
      }
      queueMicrotask(() => {
        const incoming = Object.assign(new PassThrough(), {
          statusCode: network.mode === "error" ? 503 : 200,
          headers: {
            "content-type":
              network.mode === "steps"
                ? "text/event-stream"
                : "application/json",
          },
        });
        callback(incoming);
        if (network.mode !== "steps") {
          incoming.end(JSON.stringify(network.response));
          return;
        }
        const input = z
          .object({ messages: z.array(z.object({ role: z.string() })) })
          .parse(JSON.parse(body));
        const step =
          input.messages.filter((message) => message.role === "tool").length +
          1;
        const tool = step < 16;
        const chunk = {
          id: `chat_fixture_${step}`,
          object: "chat.completion.chunk",
          created: 1,
          model: "fixture-model",
          choices: [
            {
              index: 0,
              delta: tool
                ? {
                    role: "assistant",
                    tool_calls: [
                      {
                        index: 0,
                        id: `call_fixture_${step}`,
                        type: "function",
                        function: { name: "chat_get", arguments: "{}" },
                      },
                    ],
                  }
                : {
                    role: "assistant",
                    content: "Sixteen bounded requests complete",
                  },
              finish_reason: null,
            },
          ],
        };
        const finish = {
          ...chunk,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: tool ? "tool_calls" : "stop",
            },
          ],
        };
        incoming.end(
          `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(finish)}\n\ndata: [DONE]\n\n`,
        );
      });
    };
    return outgoing;
  },
}));

const config: NativeModelConfig = {
  id: "fixture-model",
  provider: "openai-compatible",
  protocol: "chat-completions",
  baseUrl: "https://api.vendor.com/v1",
};
const endpoint = `${config.baseUrl}/chat/completions`;
beforeEach(() => {
  network.lookup.mockReset();
  network.calls = [];
  network.mode = "json";
  network.response = {};
});

describe("per-Run provider transport request budget", () => {
  it("reserves exactly sixteen concurrent attempts and refuses the seventeenth before authority, DNS or transmission", async () => {
    const authorize = vi.fn(async () => {});
    const fetch = createProviderFetch(
      config,
      new AbortController().signal,
      authorize,
    );
    const results = await Promise.allSettled(
      Array.from({ length: 17 }, () =>
        fetch(endpoint, { method: "POST", body: "{}" }).then((response) =>
          response.text(),
        ),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(16);
    expect(results[16]).toMatchObject({
      status: "rejected",
      reason: { message: "Provider request limit" },
    });
    expect(authorize).toHaveBeenCalledTimes(32);
    expect(network.lookup).toHaveBeenCalledTimes(16);
    expect(network.calls).toHaveLength(16);
    await expect(
      fetch(endpoint, { method: "POST", body: "{}" }),
    ).rejects.toThrow("Provider request limit");
    expect(network.lookup).toHaveBeenCalledTimes(16);
  });

  it("does not refund failed requests or DNS/authorization failures", async () => {
    const authorize = vi
      .fn()
      .mockRejectedValueOnce(new Error("Controlled revoked authority"))
      .mockResolvedValue(undefined);
    const fetch = createProviderFetch(
      config,
      new AbortController().signal,
      authorize,
    );
    await expect(
      fetch(endpoint, { method: "POST", body: "{}" }),
    ).rejects.toThrow("Controlled revoked authority");
    network.lookup.mockRejectedValueOnce(new Error("Controlled DNS failure"));
    await expect(
      fetch(endpoint, { method: "POST", body: "{}" }),
    ).rejects.toThrow("Controlled DNS failure");
    network.mode = "error";
    for (let index = 0; index < 14; index++) {
      const response = await fetch(endpoint, { method: "POST", body: "{}" });
      expect(response.status).toBe(503);
      await response.text();
    }
    const checks = authorize.mock.calls.length;
    await expect(
      fetch(endpoint, { method: "POST", body: "{}" }),
    ).rejects.toThrow("Provider request limit");
    expect(authorize).toHaveBeenCalledTimes(checks);
    expect(network.lookup).toHaveBeenCalledTimes(15);
    expect(network.calls).toHaveLength(14);
  });

  it("keeps independent counters for two concurrent Runs", async () => {
    const a = createProviderFetch(
      config,
      new AbortController().signal,
      async () => {},
    );
    const b = createProviderFetch(
      config,
      new AbortController().signal,
      async () => {},
    );
    await Promise.all(
      [a, b].flatMap((fetch, run) =>
        Array.from({ length: 16 }, () =>
          fetch(endpoint, {
            method: "POST",
            headers: { "x-fixture-run": String(run) },
            body: "{}",
          }).then((response) => response.text()),
        ),
      ),
    );
    expect(
      network.calls.filter((call) => call.headers["x-fixture-run"] === "0"),
    ).toHaveLength(16);
    expect(
      network.calls.filter((call) => call.headers["x-fixture-run"] === "1"),
    ).toHaveLength(16);
    for (const fetch of [a, b])
      await expect(
        fetch(endpoint, { method: "POST", body: "{}" }),
      ).rejects.toThrow("Provider request limit");
    expect(network.calls).toHaveLength(32);
  });

  it.each(["parent", "request"])(
    "propagates the %s abort into an in-flight transport and rejects an already aborted request before DNS",
    async (source) => {
      const parent = new AbortController();
      const request = new AbortController();
      const fetch = createProviderFetch(config, parent.signal, async () => {});
      network.mode = "pending";
      const pending = fetch(endpoint, {
        method: "POST",
        body: "{}",
        signal: request.signal,
      });
      const rejection = expect(pending).rejects.toThrow(
        "Provider transport failed",
      );
      await expect.poll(() => network.calls.length).toBe(1);
      (source === "parent" ? parent : request).abort();
      await rejection;
      expect(network.calls[0]?.signal.aborted).toBe(true);
      await expect(
        fetch(endpoint, { method: "POST", body: "{}", signal: request.signal }),
      ).rejects.toThrow();
      expect(network.lookup).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["responses", "anthropic"] as const)(
    "forwards the 8192 output-token setting through the official %s SDK",
    async (protocol) => {
      const selected: NativeModelConfig = {
        ...config,
        provider: protocol === "anthropic" ? "anthropic" : "openai-compatible",
        protocol,
      };
      network.response =
        protocol === "responses"
          ? {
              id: "resp_fixture",
              created_at: 1,
              model: "fixture-model",
              output: [
                {
                  type: "message",
                  id: "msg_fixture",
                  role: "assistant",
                  content: [
                    { type: "output_text", text: "Bounded", annotations: [] },
                  ],
                },
              ],
              usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
            }
          : {
              id: "msg_fixture",
              type: "message",
              role: "assistant",
              model: "fixture-model",
              content: [{ type: "text", text: "Bounded" }],
              stop_reason: "end_turn",
              stop_sequence: null,
              usage: { input_tokens: 2, output_tokens: 1 },
            };
      const model = createNativeModel(
        selected,
        "controlled-not-a-real-key",
        createProviderFetch(
          selected,
          new AbortController().signal,
          async () => {},
        ),
      );
      await model.doGenerate({
        maxOutputTokens: 8192,
        prompt: [
          { role: "user", content: [{ type: "text", text: "Bounded output" }] },
        ],
      });
      const body = JSON.parse(network.calls[0]?.body ?? "{}");
      expect(
        body[protocol === "responses" ? "max_output_tokens" : "max_tokens"],
      ).toBe(8192);
      expect(network.calls).toHaveLength(1);
    },
  );
});

describe("normal native Run budget with official SDK and controlled HTTPS", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let server: Awaited<ReturnType<typeof startServer>>;
  let workspaceId: string;
  let cookie: string;
  let chatId: string;
  let agentId: string;
  const origin = "http://127.0.0.1:45289";
  beforeAll(async () => {
    database = await startPostgres();
    const installer = await startQueue(database.db, database.pool, {
      workers: false,
      install: true,
    });
    await installer.stop();
    server = await startServer(
      readConfig({
        DATABASE_URL: `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`,
        BETTER_AUTH_SECRET: crypto.randomUUID() + crypto.randomUUID(),
        ENCRYPTION_KEY: Buffer.from(fixtureEncryptionKey).toString("base64"),
        OTTO_ORIGIN: origin,
        PORT: "0",
      }),
      { mail: null },
    );
    const response = await fetch(
      `${server.server.url.origin}/api/auth/sign-up/email`,
      {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          name: "Budget fixture",
          email: `${crypto.randomUUID()}@example.test`,
          password: crypto.randomUUID() + crypto.randomUUID(),
        }),
      },
    );
    expect(response.status).toBe(200);
    const userId = z
      .object({ user: z.object({ id: z.string() }) })
      .parse(await response.json()).user.id;
    cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(cookie).not.toBe("");
    workspaceId = (
      await claimInstallation(database.db, userId, "Bounded native fixture")
    ).id;
    await inWorkspace(database.db, workspaceId, { userId }, async (c) => {
      const account = await createSubscription(c, {
        title: "Controlled budget account",
        provider: "openai-compatible",
        protocol: "chat-completions",
        baseUrl: config.baseUrl,
        models: [config.id],
        visibility: "workspace",
      });
      await setSubscriptionApiKey(
        c,
        account.id,
        { apiKey: "controlled-not-a-real-key" },
        fixtureEncryptionKey,
      );
      const agent = await createAgent(c, {
        title: "Bounded Agent",
        instructions: "Use only the controlled fixture",
        model: config.id,
        subscriptionId: account.id,
        visibility: "workspace",
      });
      agentId = agent.id;
      await createEnvironment(c, agent.id);
      const chat = await createChat(c, {
        title: "Native budget proof",
        visibility: "participants",
      });
      chatId = chat.id;
      await createParticipant(c, chat.id, { agentId, role: "contributor" });
    });
  }, 120000);
  afterAll(async () => {
    await server?.stop();
    await database?.stop();
  });

  const request = (path: string, input?: unknown) =>
    fetch(`${server.server.url.origin}/api/workspaces/${workspaceId}${path}`, {
      method: input === undefined ? "GET" : "POST",
      headers: { origin, cookie, "content-type": "application/json" },
      body: input === undefined ? undefined : JSON.stringify(input),
    });
  async function launch(requestId = crypto.randomUUID()) {
    const input = {
      requestId,
      agentId,
      chatId,
      type: "prompt",
      body: "Bound every real request",
    };
    const response = await request("/runs", input);
    expect(response.status).toBe(200);
    return {
      input,
      run: z.object({ id: z.uuid() }).parse(await response.json()),
    };
  }
  const state = async (id: string) =>
    z
      .object({
        state: z.string(),
      })
      .parse(await (await request(`/runs/${id}`)).json());

  it("uses one counter over sixteen native tool steps, resets for a distinct Run, and does not relaunch an exact retry", async () => {
    network.mode = "steps";
    const beforeLaunch = Date.now();
    const first = await launch();
    await expect
      .poll(async () => (await state(first.run.id)).state, { timeout: 25000 })
      .toBe("finished");
    expect(network.calls).toHaveLength(16);
    for (const call of network.calls) {
      const body = JSON.parse(call.body);
      expect(body.max_tokens ?? body.max_completion_tokens).toBe(8192);
    }
    const [firstState] = await database.db
      .select({ deadlineAt: runs.deadlineAt })
      .from(runs)
      .where(eq(runs.id, first.run.id));
    expect(firstState?.deadlineAt?.getTime()).toBeGreaterThanOrEqual(
      beforeLaunch + 300000,
    );
    expect(firstState?.deadlineAt?.getTime()).toBeLessThanOrEqual(
      Date.now() + 300000,
    );
    const retry = await request("/runs", first.input);
    expect(z.object({ id: z.uuid() }).parse(await retry.json()).id).toBe(
      first.run.id,
    );
    const second = await launch();
    await expect
      .poll(async () => (await state(second.run.id)).state, { timeout: 25000 })
      .toBe("finished");
    expect(second.run.id).not.toBe(first.run.id);
    expect(network.calls).toHaveLength(32);
    const messages = z
      .array(z.object({ body: z.string() }))
      .parse(await (await request(`/chats/${chatId}/messages`)).json());
    expect(
      messages.filter(
        (message) => message.body === "Sixteen bounded requests complete",
      ),
    ).toHaveLength(2);
  }, 60000);

  it("does not retry a retryable provider failure in the native Run", async () => {
    network.mode = "error";
    const { run } = await launch();
    await expect
      .poll(async () => (await state(run.id)).state, { timeout: 15000 })
      .toMatch(/^(failed|interrupted)$/);
    expect(network.calls).toHaveLength(1);
    expect(network.lookup).toHaveBeenCalledTimes(1);
  });
});
