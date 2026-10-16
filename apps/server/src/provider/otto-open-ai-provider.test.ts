import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { AuthStorage } from "@mastra/code-sdk/auth/storage";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { ApiKeyCredential } from "../subscription-auth/types.ts";
import {
  buildOttoOpenAIFetch,
  ottoCodexOAuthProvider,
  ottoOpenAIProvider,
} from "./otto-open-ai-provider.ts";

type OpenAIModel = ReturnType<typeof ottoOpenAIProvider>;

type CallOptions = Parameters<OpenAIModel["doGenerate"]>[0];

const RESPONSE = {
  id: "resp_1",
  created_at: 1_760_000_000,
  model: "gpt-5.6",
  output: [],
  usage: { input_tokens: 1, output_tokens: 1 },
};

/** Sends one request through a new model and returns what reached the network. */
async function sendRequest(createModel: () => OpenAIModel, options: CallOptions) {
  const requests: Array<{ readonly body: string; readonly headers: Headers }> = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(
        input instanceof Request
          ? { body: await input.clone().text(), headers: input.headers }
          : { body: String(init?.body), headers: new Headers(init?.headers) },
      );

      return Response.json(RESPONSE);
    }),
  );
  await createModel().doGenerate(options);

  return { body: JSON.parse(requests[0]?.body ?? "{}"), headers: requests[0]?.headers };
}

async function requestBody(createModel: () => OpenAIModel, options: CallOptions) {
  return (await sendRequest(createModel, options)).body;
}

const PROMPT: CallOptions["prompt"] = [
  { role: "system", content: "You are Mina." },
  { role: "system", content: "<workspace>\nPeople: Ana\n</workspace>" },
  { role: "user", content: [{ type: "text", text: "hola" }] },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Otto OpenAI API-key transport", () => {
  it("uses Responses without a ChatGPT account or OAuth token", () => {
    expect(ottoOpenAIProvider("gpt-5.6", () => ({ type: "api-key", access: "key" }))).toMatchObject(
      { modelId: "gpt-5.6", provider: "openai.responses" },
    );
  });

  it("loads current credentials for every request and stops after logout", async () => {
    let credential: ApiKeyCredential | undefined = {
      type: "api-key",
      access: "first-key",
      baseUrl: "https://proxy.example/v1",
    };

    const request = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) => new Response("{}"),
    );

    const fetch = buildOttoOpenAIFetch(() => credential, request);
    await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      body: "{}",
      headers: { "chatgpt-account-id": "stale-account" },
    });
    expect(request).toHaveBeenCalledWith(
      "https://proxy.example/v1/responses",
      expect.objectContaining({ method: "POST", body: "{}", redirect: "error" }),
    );
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).get("authorization")).toBe(
      "Bearer first-key",
    );
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).get("chatgpt-account-id")).toBeNull();
    credential = { type: "api-key", access: "replacement-key" };
    await fetch("https://api.openai.com/v1/responses");
    expect(new Headers(request.mock.calls[1]?.[1]?.headers).get("authorization")).toBe(
      "Bearer replacement-key",
    );
    credential = undefined;
    await expect(fetch("https://api.openai.com/v1/responses")).rejects.toThrow(
      "no longer connected",
    );
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("keys the prompt cache by chat", async () => {
    const body = await requestBody(
      () => ottoOpenAIProvider("gpt-5.6", () => ({ type: "api-key", access: "key" }), "chat-1"),
      { prompt: PROMPT },
    );

    expect(body.prompt_cache_key).toBe("chat-1");
    expect(body.input[0]).toEqual({ role: "developer", content: "You are Mina." });
  });
});

describe("Otto ChatGPT subscription transport", () => {
  function codexModel(threadId?: string) {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-codex-"));
    const authStorage = new AuthStorage(NodePath.join(directory, "auth.json"));
    authStorage.set("openai-codex", {
      type: "oauth",
      access: "codex-token",
      refresh: "codex-refresh",
      expires: Date.now() + 3_600_000,
      accountId: "account-1",
    });

    return ottoCodexOAuthProvider("gpt-5.6", authStorage, threadId);
  }

  it("sends the leading system prompt as instructions with the chat's cache key", async () => {
    const body = await requestBody(() => codexModel("chat-1"), {
      prompt: PROMPT,
      temperature: 0.2,
      topP: 0.9,
    });

    expect(body).toMatchObject({
      instructions: "You are Mina.",
      prompt_cache_key: "chat-1",
      store: false,
      reasoning: { effort: "medium" },
    });
    expect(body.top_p).toBeUndefined();
    expect(body.input[0]).toEqual({
      role: "developer",
      content: "<workspace>\nPeople: Ana\n</workspace>",
    });
    expect(JSON.stringify(body.input)).not.toContain("You are Mina.");
  });

  it("routes the chat to its cached session", async () => {
    const { headers } = await sendRequest(() => codexModel("chat-1"), { prompt: PROMPT });

    expect(headers?.get("session-id")).toBe("chat-1");
    expect(headers?.get("x-client-request-id")).toBe("chat-1");
  });

  it("falls back to a minimal instruction when there is no system prompt", async () => {
    const body = await requestBody(() => codexModel(), {
      prompt: [{ role: "user", content: [{ type: "text", text: "hola" }] }],
    });

    expect(body.instructions).toBe("You are a helpful assistant.");
    expect(body.prompt_cache_key).toBeUndefined();
  });
});
