import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeModelConfig } from "../packages/subscriptions/src/native-provider-config";
import { createProviderFetch } from "../packages/subscriptions/src/native-provider-http";
import { createNativeModel } from "../packages/subscriptions/src/native-provider-model";

const network = vi.hoisted(() => ({
  addresses: [{ address: "8.8.8.8", family: 4 }],
  calls: [] as { url: URL; options: Record<string, unknown>; body: string }[],
  status: 200,
  contentType: "application/json",
  response: {} as unknown,
  rejectItemReferences: false,
  lookup: vi.fn(),
}));
vi.mock("node:dns/promises", () => ({
  lookup: async (hostname: string, options: unknown) => {
    network.lookup(hostname, options);
    return network.addresses;
  },
}));
vi.mock("node:https", () => ({
  request: (
    url: URL,
    options: Record<string, unknown>,
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
      network.calls.push({ url, options, body });
      queueMicrotask(() => {
        const missingReference =
          network.rejectItemReferences &&
          JSON.parse(body).input.some(
            (item: { type: string }) => item.type === "item_reference",
          );
        const incoming = Object.assign(new PassThrough(), {
          statusCode: missingReference ? 404 : network.status,
          headers: {
            "content-type": network.contentType,
            location: "http://169.254.169.254/latest/meta-data",
            "set-cookie": "never-propagate",
          },
        });
        callback(incoming);
        incoming.end(
          missingReference
            ? '{"error":{"message":"Controlled missing stored item"}}'
            : typeof network.response === "string"
              ? network.response
              : JSON.stringify(network.response),
        );
      });
    };
    return outgoing;
  },
}));

const config = (
  protocol: NativeModelConfig["protocol"],
): NativeModelConfig => ({
  id: "fixture-model",
  provider: protocol === "anthropic" ? "anthropic" : "openai-compatible",
  protocol,
  baseUrl: "https://api.vendor.com/v1",
});
beforeEach(() => {
  network.calls = [];
  network.addresses = [{ address: "8.8.8.8", family: 4 }];
  network.status = 200;
  network.contentType = "application/json";
  network.response = {};
  network.rejectItemReferences = false;
  network.lookup.mockClear();
});

describe("official native SDK protocol boundary with controlled DNS and HTTPS peer", () => {
  it.each(["responses", "chat-completions", "anthropic"] as const)(
    "streams the selected %s protocol through the pinned transport",
    async (protocol) => {
      network.contentType = "text/event-stream";
      const events =
        protocol === "chat-completions"
          ? [
              {
                id: "chat_fixture",
                object: "chat.completion.chunk",
                created: 1,
                model: "fixture-model",
                choices: [
                  {
                    index: 0,
                    delta: {
                      role: "assistant",
                      content: "Controlled response",
                    },
                    finish_reason: null,
                  },
                ],
              },
              {
                id: "chat_fixture",
                object: "chat.completion.chunk",
                created: 1,
                model: "fixture-model",
                choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
              },
            ]
          : protocol === "responses"
            ? [
                {
                  type: "response.created",
                  response: {
                    id: "resp_fixture",
                    created_at: 1,
                    model: "fixture-model",
                  },
                },
                {
                  type: "response.output_item.added",
                  output_index: 0,
                  item: {
                    type: "message",
                    id: "msg_fixture",
                    role: "assistant",
                    content: [],
                  },
                },
                {
                  type: "response.output_text.delta",
                  item_id: "msg_fixture",
                  output_index: 0,
                  content_index: 0,
                  delta: "Controlled response",
                },
                {
                  type: "response.output_item.done",
                  output_index: 0,
                  item: {
                    type: "message",
                    id: "msg_fixture",
                    role: "assistant",
                    content: [
                      {
                        type: "output_text",
                        text: "Controlled response",
                        annotations: [],
                      },
                    ],
                  },
                },
                {
                  type: "response.completed",
                  response: {
                    id: "resp_fixture",
                    status: "completed",
                    usage: {
                      input_tokens: 2,
                      output_tokens: 3,
                      total_tokens: 5,
                    },
                  },
                },
              ]
            : [
                {
                  type: "message_start",
                  message: {
                    id: "msg_fixture",
                    type: "message",
                    role: "assistant",
                    model: "fixture-model",
                    content: [],
                    stop_reason: null,
                    stop_sequence: null,
                    usage: { input_tokens: 2, output_tokens: 0 },
                  },
                },
                {
                  type: "content_block_start",
                  index: 0,
                  content_block: { type: "text", text: "" },
                },
                {
                  type: "content_block_delta",
                  index: 0,
                  delta: { type: "text_delta", text: "Controlled response" },
                },
                { type: "content_block_stop", index: 0 },
                {
                  type: "message_delta",
                  delta: { stop_reason: "end_turn", stop_sequence: null },
                  usage: { output_tokens: 3 },
                },
                { type: "message_stop" },
              ];
      network.response =
        events
          .map(
            (event) =>
              `${"type" in event ? `event: ${event.type}\n` : ""}data: ${JSON.stringify(event)}\n\n`,
          )
          .join("") +
        (protocol === "chat-completions" ? "data: [DONE]\n\n" : "");
      const fetch = createProviderFetch(
        config(protocol),
        new AbortController().signal,
        async () => {},
      );
      const model = createNativeModel(
        config(protocol),
        "fixture-stream-account",
        fetch,
      );
      const result = await model.doStream({
        providerOptions: { openai: { store: true, user: "fixture-user" } },
        prompt: [
          {
            role: "user",
            content: [{ type: "text", text: "Controlled stream" }],
          },
        ],
      });
      const chunks = [];
      for await (const chunk of result.stream) chunks.push(chunk);
      expect(chunks.filter((chunk) => chunk.type === "error")).toEqual([]);
      expect(chunks).toContainEqual(
        expect.objectContaining({
          type: "text-delta",
          delta: "Controlled response",
        }),
      );
      expect(chunks).toContainEqual(
        expect.objectContaining({ type: "finish" }),
      );
      expect(network.calls).toHaveLength(1);
      const body = JSON.parse(network.calls[0]?.body ?? "{}");
      expect(body.stream).toBe(true);
      expect(body.store).toBe(
        protocol === "responses"
          ? false
          : protocol === "chat-completions"
            ? true
            : undefined,
      );
      expect(body.user).toBe(
        protocol === "anthropic" ? undefined : "fixture-user",
      );
    },
  );
  it.each(["responses", "chat-completions", "anthropic"] as const)(
    "uses exactly the selected %s protocol, model and account",
    async (protocol) => {
      network.response =
        protocol === "responses"
          ? {
              id: "resp_fixture",
              object: "response",
              created_at: 1,
              status: "completed",
              model: "fixture-model",
              output: [
                {
                  type: "message",
                  id: "msg_fixture",
                  role: "assistant",
                  status: "completed",
                  content: [
                    {
                      type: "output_text",
                      text: "Controlled response",
                      annotations: [],
                    },
                  ],
                },
              ],
              usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
            }
          : protocol === "chat-completions"
            ? {
                id: "chatcmpl_fixture",
                object: "chat.completion",
                created: 1,
                model: "fixture-model",
                choices: [
                  {
                    index: 0,
                    message: {
                      role: "assistant",
                      content: "Controlled response",
                    },
                    finish_reason: "stop",
                  },
                ],
                usage: {
                  prompt_tokens: 2,
                  completion_tokens: 3,
                  total_tokens: 5,
                },
              }
            : {
                id: "msg_fixture",
                type: "message",
                role: "assistant",
                model: "fixture-model",
                content: [{ type: "text", text: "Controlled response" }],
                stop_reason: "end_turn",
                stop_sequence: null,
                usage: { input_tokens: 2, output_tokens: 3 },
              };
      const authorize = vi.fn(async () => {});
      const fetch = createProviderFetch(
        config(protocol),
        new AbortController().signal,
        authorize,
      );
      const model = createNativeModel(
        config(protocol),
        "fixture-selected-account",
        fetch,
      );
      const result = await model.doGenerate({
        prompt: [
          {
            role: "user",
            content: [{ type: "text", text: "Controlled request" }],
          },
        ],
      });
      expect(result.content).toContainEqual(
        expect.objectContaining({
          type: "text",
          text: "Controlled response",
        }),
      );
      expect(network.calls).toHaveLength(1);
      expect(authorize).toHaveBeenCalledTimes(2);
      const call = network.calls[0];
      if (!call) throw new Error("Expected controlled HTTPS call");
      expect(call.url.pathname).toBe(
        protocol === "responses"
          ? "/v1/responses"
          : protocol === "chat-completions"
            ? "/v1/chat/completions"
            : "/v1/messages",
      );
      expect(JSON.parse(call.body).model).toBe("fixture-model");
      const headers = call.options.headers as Record<string, string>;
      expect(
        protocol === "anthropic" ? headers["x-api-key"] : headers.authorization,
      ).toBe(
        protocol === "anthropic"
          ? "fixture-selected-account"
          : "Bearer fixture-selected-account",
      );
      expect(call.options.agent).toBe(false);
      expect(call.options.family).toBe(4);
      const pinnedLookup = call.options.lookup as (
        hostname: string,
        options: unknown,
        callback: (error: unknown, address: string, family: number) => void,
      ) => void;
      network.addresses = [{ address: "127.0.0.1", family: 4 }];
      const lookupResult = vi.fn();
      pinnedLookup("api.vendor.com", {}, lookupResult);
      expect(lookupResult).toHaveBeenCalledWith(null, "8.8.8.8", 4);
    },
  );
  it("keeps Responses history inline when tool follow-up options are omitted", async () => {
    network.rejectItemReferences = true;
    const model = createNativeModel(
      config("responses"),
      "fixture-continuation-account",
      createProviderFetch(
        config("responses"),
        new AbortController().signal,
        async () => {},
      ),
    );
    const prompt: Array<
      | {
          role: "user";
          content: Array<{ type: "text"; text: string }>;
        }
      | {
          role: "assistant";
          content: Array<
            | {
                type: "text";
                text: string;
                providerOptions?: { openai: { itemId: string } };
              }
            | {
                type: "tool-call";
                toolCallId: string;
                toolName: string;
                input: Record<string, never>;
                providerOptions: { openai: { itemId: string } };
              }
          >;
        }
      | {
          role: "tool";
          content: Array<{
            type: "tool-result";
            toolCallId: string;
            toolName: string;
            output: { type: "json"; value: { title: string } };
          }>;
        }
    > = [{ role: "user", content: [{ type: "text", text: "Read the Task" }] }];
    const options = {
      prompt,
      tools: [
        {
          type: "function" as const,
          name: "task_get",
          inputSchema: { type: "object" as const, properties: {} },
        },
      ],
    };
    for (const invocation of [1, 2, 3]) {
      network.response = {
        id: `resp_fixture_${invocation}`,
        object: "response",
        created_at: invocation,
        status: "completed",
        model: "fixture-model",
        output: [
          ...(invocation >= 2
            ? [
                {
                  type: "message",
                  id: `msg_fixture_${invocation}`,
                  role: "assistant",
                  status: "completed",
                  content: [
                    {
                      type: "output_text",
                      text: "The fixture Task exists",
                      annotations: [],
                    },
                  ],
                },
              ]
            : []),
          ...(invocation !== 2
            ? [
                {
                  type: "function_call",
                  id: `fc_fixture_${invocation}`,
                  call_id: `call_fixture_${invocation}`,
                  name: "task_get",
                  arguments: "{}",
                  status: "completed",
                },
              ]
            : []),
        ],
        usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
      };
      const result = await model.doGenerate({
        ...options,
        ...(invocation % 2 === 1
          ? { providerOptions: { openai: { store: false } } }
          : {}),
      });
      const content = result.content.flatMap((part) => {
        if (part.type === "text")
          return [
            {
              type: "text" as const,
              text: part.text,
              providerOptions: {
                openai: {
                  itemId: String(part.providerMetadata?.openai?.itemId),
                },
              },
            },
          ];
        return [];
      });
      if (invocation === 2) {
        expect(content).toHaveLength(1);
        prompt.push({ role: "assistant", content });
        prompt.push({
          role: "user",
          content: [{ type: "text", text: "Read it again" }],
        });
        continue;
      }
      const call = result.content.find((part) => part.type === "tool-call");
      if (call?.type !== "tool-call")
        throw new Error("Expected controlled function call");
      prompt.push({
        role: "assistant",
        content: [
          ...content,
          {
            type: "tool-call",
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            input: JSON.parse(call.input),
            providerOptions: {
              openai: { itemId: String(call.providerMetadata?.openai?.itemId) },
            },
          },
        ],
      });
      prompt.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            output: { type: "json", value: { title: "Fixture Task" } },
          },
        ],
      });
    }
    const fourth = await model.doGenerate(options).then(
      () => null,
      (error: unknown) => ({
        name: error instanceof Error ? error.name : "unknown",
        status:
          error instanceof Error && "statusCode" in error
            ? error.statusCode
            : null,
      }),
    );
    expect({
      fourth,
      wire: network.calls.map((call) => {
        const body = JSON.parse(call.body);
        return {
          store: body.store ?? null,
          references: body.input.filter(
            (item: { type: string }) => item.type === "item_reference",
          ).length,
        };
      }),
    }).toEqual({
      fourth: null,
      wire: Array.from({ length: 4 }, () => ({ store: false, references: 0 })),
    });
    expect(network.calls).toHaveLength(4);
    for (const call of network.calls) {
      expect(call.url.href).toBe("https://api.vendor.com/v1/responses");
      expect(call.options.method).toBe("POST");
      const body = JSON.parse(call.body);
      expect(body.store).toBe(false);
      expect(body.previous_response_id).toBeUndefined();
      expect(body.conversation).toBeUndefined();
      expect(body.input).not.toContainEqual(
        expect.objectContaining({ type: "item_reference" }),
      );
    }
    const last = JSON.parse(network.calls[3]?.body ?? "{}");
    const calls = last.input.filter(
      (item: { type: string }) => item.type === "function_call",
    );
    const outputs = last.input.filter(
      (item: { type: string }) => item.type === "function_call_output",
    );
    expect(calls.map((item: { call_id: string }) => item.call_id)).toEqual([
      "call_fixture_1",
      "call_fixture_3",
    ]);
    expect(outputs.map((item: { call_id: string }) => item.call_id)).toEqual([
      "call_fixture_1",
      "call_fixture_3",
    ]);
    expect(calls.every((item: { id?: string }) => item.id === undefined)).toBe(
      true,
    );
    expect(last.input).toContainEqual(
      expect.objectContaining({
        role: "assistant",
        content: "The fixture Task exists",
      }),
    );
  });
  it("refuses a mixed public/private DNS answer before sending credentials", async () => {
    network.addresses.push({ address: "169.254.169.254", family: 4 });
    const fetch = createProviderFetch(
      config("responses"),
      new AbortController().signal,
      async () => {},
    );
    await expect(
      fetch("https://api.vendor.com/v1/responses", {
        method: "POST",
        body: "{}",
      }),
    ).rejects.toThrow("Provider endpoint must resolve to public addresses");
    expect(network.calls).toHaveLength(0);
  });
  it("bounds response bytes even for streaming provider responses", async () => {
    network.response = "x".repeat(16 * 1024 * 1024 + 1);
    const fetch = createProviderFetch(
      config("responses"),
      new AbortController().signal,
      async () => {},
    );
    const response = await fetch("https://api.vendor.com/v1/responses", {
      method: "POST",
      body: "{}",
    });
    await expect(response.text()).rejects.toThrow(
      "Provider response size limit",
    );
  });
  it("never follows a redirect or relays its location, cookies or error body", async () => {
    network.status = 307;
    network.response = { error: "fixture-sensitive-provider-echo" };
    const fetch = createProviderFetch(
      config("responses"),
      new AbortController().signal,
      async () => {},
    );
    const result = await fetch("https://api.vendor.com/v1/responses", {
      method: "POST",
      body: "{}",
    });
    expect(result.status).toBe(307);
    expect(result.headers.has("location")).toBe(false);
    expect(result.headers.has("set-cookie")).toBe(false);
    expect(await result.text()).not.toContain(
      "fixture-sensitive-provider-echo",
    );
    expect(network.calls).toHaveLength(1);
  });
  it("refuses authority revoked during DNS and an already cancelled request", async () => {
    const authorize = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("revoked"));
    const fetch = createProviderFetch(
      config("responses"),
      new AbortController().signal,
      authorize,
    );
    await expect(
      fetch("https://api.vendor.com/v1/responses", {
        method: "POST",
        body: "{}",
      }),
    ).rejects.toThrow("revoked");
    expect(network.calls).toHaveLength(0);
    const cancelled = createProviderFetch(
      config("responses"),
      AbortSignal.abort(),
      async () => {},
    );
    await expect(
      cancelled("https://api.vendor.com/v1/responses", {
        method: "POST",
        body: "{}",
      }),
    ).rejects.toThrow();
    expect(network.calls).toHaveLength(0);
  });
  it("does not look up or transmit to a foreign origin, path or a protocol fallback", async () => {
    const fetch = createProviderFetch(
      config("responses"),
      new AbortController().signal,
      async () => {},
    );
    for (const url of [
      "https://other.vendor.com/v1/responses",
      "https://api.vendor.com/v1/chat/completions",
      "http://api.vendor.com/v1/responses",
    ])
      await expect(
        fetch(url, { method: "POST", body: "{}" }),
      ).rejects.toThrow();
    expect(network.lookup).not.toHaveBeenCalled();
    expect(network.calls).toHaveLength(0);
  });
});
