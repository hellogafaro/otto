import type { MastraModelConfig } from "@mastra/core/llm";
import { RequestContext } from "@mastra/core/request-context";
import * as DateTime from "effect/DateTime";
import * as Predicate from "effect/Predicate";
import { describe, expect, it } from "vite-plus/test";
import {
  createOttoChatContext,
  createOttoChatContextUpdate,
  createOttoInstructions,
} from "../otto-agent-instructions.ts";
import {
  OTTO_COMPACTION_INSTRUCTION,
  type OttoChatContextRecord,
  withOttoPrompt,
} from "./otto-instructions.ts";

type TestModel = Extract<
  MastraModelConfig,
  {
    readonly specificationVersion: "v3";
    doGenerate: (...args: never[]) => PromiseLike<{ readonly content: ReadonlyArray<object> }>;
  }
>;

type CallOptions = Parameters<TestModel["doGenerate"]>[0];

type Prompt = CallOptions["prompt"];

const now = () => DateTime.makeUnsafe("2026-09-15T13:37:00.000Z");

const TURN = '<turn date="Tuesday, September 15, 2026" time="15:37" timezone="Europe/Madrid" />';

function recordingModel(provider: string) {
  const calls: Array<CallOptions> = [];

  const model: TestModel = {
    specificationVersion: "v3",
    provider,
    modelId: "test-model",
    supportedUrls: {},
    doGenerate: async (options: CallOptions) => {
      calls.push(options);

      return {
        content: [],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      };
    },
    doStream: async () => {
      throw new Error("The test model only generates.");
    },
  };

  return { model, calls };
}

function context(state: Record<string, string | boolean>) {
  const requestContext = new RequestContext();
  requestContext.setRaw("controller", {
    resourceId: "thread-1",
    state: { timezone: "Europe/Madrid", ...state },
  });

  return requestContext;
}

async function send(
  model: MastraModelConfig,
  prompt: Prompt,
  tools: CallOptions["tools"] = undefined,
) {
  if (!Predicate.isObject(model) || !("specificationVersion" in model)) {
    throw new Error("withOttoPrompt must keep a v3 model.");
  }

  const native: TestModel = model as TestModel;

  await native.doGenerate({ prompt, ...(tools ? { tools } : {}) });
}

function user(text: string): Prompt[number] {
  return { role: "user", content: [{ type: "text", text }] };
}

function assistant(text: string): Prompt[number] {
  return { role: "assistant", content: [{ type: "text", text }] };
}

describe("withOttoPrompt", () => {
  it("lays out instructions, chat context, history and the turn block in that order", async () => {
    const { model, calls } = recordingModel("openai.responses");

    const state = {
      botConversation: true,
      botName: "Mina",
      botInstructions: "Answer in Spanish.",
      workspaceName: "Acme",
      workspaceContext: "People: Ana",
      persistentMemoryContext: "Likes tea",
      turnContext: "Your turn in the group.",
    };

    await send(withOttoPrompt(model, context(state), new Map(), now), [user("hola")]);

    expect(calls[0]?.prompt).toEqual([
      {
        role: "system",
        content: createOttoInstructions({
          name: "Mina",
          workspaceName: "Acme",
          instructions: "Answer in Spanish.",
          tools: [],
        }),
      },
      {
        role: "system",
        content: createOttoChatContext({ workspace: "People: Ana", memory: "Likes tea" }),
      },
      user("hola"),
      {
        role: "system",
        content: `${TURN.slice(0, -3)}>\nYour turn in the group.\n</turn>`,
      },
    ]);
  });

  it("names Otto and drops bot-only context outside bot conversations", async () => {
    const { model, calls } = recordingModel("openai.responses");

    const state = {
      botConversation: false,
      botName: "Mina",
      botInstructions: "Answer in Spanish.",
      projectContext: "Launch",
      groupContext: "Group of three",
    };

    await send(withOttoPrompt(model, context(state), new Map(), now), [user("hi")]);

    expect(calls[0]?.prompt).toEqual([
      { role: "system", content: createOttoInstructions({ tools: [] }) },
      user("hi"),
      { role: "system", content: TURN },
    ]);
  });

  it("keeps the sent context and appends changes where they were first sent", async () => {
    const { model, calls } = recordingModel("openai.responses");
    const chats = new Map<string, OttoChatContextRecord>();
    const first = { botConversation: true, botName: "Mina", projectContext: "Launch" };
    const changed = { ...first, projectContext: "Launch, now in beta" };

    const instructions = {
      role: "system",
      content: createOttoInstructions({ name: "Mina", tools: [] }),
    };

    const chat = { role: "system", content: createOttoChatContext({ project: "Launch" }) };

    const update = {
      role: "system",
      content: createOttoChatContextUpdate([["project", "Launch, now in beta"]]),
    };

    const turn = { role: "system", content: TURN };

    await send(withOttoPrompt(model, context(first), chats, now), [user("a")]);
    await send(withOttoPrompt(model, context(changed), chats, now), [
      user("a"),
      assistant("b"),
      user("c"),
    ]);
    await send(withOttoPrompt(model, context(changed), chats, now), [
      user("a"),
      assistant("b"),
      user("c"),
      assistant("d"),
      user("e"),
    ]);

    expect(calls[1]?.prompt).toEqual([
      instructions,
      chat,
      user("a"),
      assistant("b"),
      user("c"),
      update,
      turn,
    ]);
    expect(calls[2]?.prompt).toEqual([
      instructions,
      chat,
      user("a"),
      assistant("b"),
      user("c"),
      update,
      assistant("d"),
      user("e"),
      turn,
    ]);

    await send(withOttoPrompt(model, context(changed), chats, now), [user("summary"), user("e")]);

    expect(calls[3]?.prompt).toEqual([
      instructions,
      { role: "system", content: createOttoChatContext({ project: "Launch, now in beta" }) },
      user("summary"),
      user("e"),
      turn,
    ]);
  });

  it("sends a compaction instruction in place of the turn block, after the same history", async () => {
    const { model, calls } = recordingModel("anthropic.messages");
    const chats = new Map<string, OttoChatContextRecord>();
    const state = { workspaceContext: "People: Ana", turnContext: "Your turn in the group." };
    const history = [user("a"), assistant("b"), user("c")];

    await send(withOttoPrompt(model, context(state), chats, now), history);
    await send(withOttoPrompt(model, context(state), chats, now), [
      ...history,
      { ...user("Write a checkpoint."), providerOptions: OTTO_COMPACTION_INSTRUCTION },
    ]);

    expect(calls[1]?.prompt.slice(0, -1)).toEqual(calls[0]?.prompt.slice(0, -1));
    expect(calls[1]?.prompt.at(-1)).toEqual(user("Write a checkpoint."));
  });

  it("marks the system prompt, last tool and last history message for Anthropic's cache", async () => {
    const { model, calls } = recordingModel("anthropic.messages");
    const cache = { anthropic: { cacheControl: { type: "ephemeral" } } };

    const tools: CallOptions["tools"] = [
      { type: "function", name: "read", inputSchema: { type: "object" } },
      { type: "function", name: "memory", inputSchema: { type: "object" } },
    ];

    await send(
      withOttoPrompt(model, context({ workspaceContext: "People: Ana" }), new Map(), now),
      [user("a"), assistant("b"), user("c")],
      tools,
    );

    const request = calls[0];

    expect(request?.prompt.map((message) => [message.role, message.providerOptions])).toEqual([
      ["system", undefined],
      ["system", cache],
      ["user", undefined],
      ["assistant", undefined],
      ["user", cache],
      ["user", undefined],
    ]);
    expect(request?.prompt.at(-1)).toEqual(user(TURN));
    expect(
      request?.tools?.map((tool) => [
        tool.name,
        "providerOptions" in tool ? tool.providerOptions : undefined,
      ]),
    ).toEqual([
      ["read", undefined],
      ["memory", cache],
    ]);
    expect(request?.prompt[0]).toEqual({
      role: "system",
      content: createOttoInstructions({ tools: ["read", "memory"] }),
    });
  });
});
