import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

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
  type OttoChatContexts,
  storedChatContexts,
  withOttoPrompt,
} from "./otto-instructions.ts";
import { createOttoMastraMemory } from "./otto-memory.ts";

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

function inMemoryChats(): OttoChatContexts {
  const records = new Map<string, OttoChatContextRecord>();

  return {
    get: async (threadId, botId) => records.get(`${threadId}:${botId}`),
    set: async (threadId, botId, record) => {
      records.set(`${threadId}:${botId}`, record);
    },
  };
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

    await send(withOttoPrompt(model, context(state), inMemoryChats(), now), [user("hola")]);

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

  it("asks for at most 32,768 output tokens, or the model's own smaller limit", async () => {
    const { model, calls } = recordingModel("xai.responses");
    const grok = new RequestContext();
    grok.setRaw("controller", { resourceId: "thread-1", session: { modelId: "xai/grok-4.3" } });

    await send(withOttoPrompt(model, context({}), inMemoryChats(), now), [user("a")]);
    await send(withOttoPrompt(model, grok, inMemoryChats(), now), [user("a")]);

    expect(calls.map((call) => call.maxOutputTokens)).toEqual([32_768, 30_000]);
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

    await send(withOttoPrompt(model, context(state), inMemoryChats(), now), [user("hi")]);

    expect(calls[0]?.prompt).toEqual([
      { role: "system", content: createOttoInstructions({ tools: [] }) },
      user("hi"),
      { role: "system", content: TURN },
    ]);
  });

  it("keeps the sent context and appends changes where they were first sent", async () => {
    const { model, calls } = recordingModel("openai.responses");
    const chats = inMemoryChats();
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

  it("keeps each group bot's prefix and OpenAI prompt cache apart", async () => {
    const { model, calls } = recordingModel("openai.responses");
    const chats = inMemoryChats();
    const mina = {
      botConversation: true,
      botId: "bot-mina",
      botName: "Mina",
      groupContext: "Mina",
    };
    const juno = {
      botConversation: true,
      botId: "bot-juno",
      botName: "Juno",
      groupContext: "Juno",
    };

    await send(withOttoPrompt(model, context(mina), chats, now), [user("a")]);
    await send(withOttoPrompt(model, context(juno), chats, now), [user("a"), assistant("b")]);

    await send(withOttoPrompt(model, context(mina), chats, now), [
      user("a"),
      assistant("b"),
      assistant("c"),
    ]);

    const minaChat = { role: "system", content: createOttoChatContext({ chat: "Mina" }) };

    expect(calls[2]?.prompt.slice(1, 3)).toEqual([minaChat, user("a")]);
    expect(
      calls[2]?.prompt.some(
        (message) => message.role === "system" && message.content.includes("Juno"),
      ),
    ).toBe(false);
    expect(calls.map((call) => call.providerOptions?.["openai"]?.["promptCacheKey"])).toEqual([
      "thread-1:bot-mina",
      "thread-1:bot-juno",
      "thread-1:bot-mina",
    ]);
  });

  it("sends the same chat context after the server restarts, with changes appended", async () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-chat-context-"));
    const options = { memoryDbPath: NodePath.join(directory, "messages.sqlite") };
    const first = { botConversation: true, botName: "Mina", workspaceContext: "People: Ana" };
    const changed = { ...first, workspaceContext: "People: Ana\nProjects: Beta" };

    // Mastra stamps a loaded message with a fresh createdAt on every request.
    const loaded = (createdAt: number) => ({
      ...user("a"),
      providerOptions: { mastra: { createdAt } },
    });

    try {
      const before = await createOttoMastraMemory(options);
      await before.memory.createThread({
        threadId: "thread-1",
        resourceId: "thread-1",
        title: "Launch",
      });
      const { model: sentBefore, calls: callsBefore } = recordingModel("openai.responses");

      await send(
        withOttoPrompt(sentBefore, context(first), storedChatContexts(before.memory), now),
        [loaded(1)],
      );
      await before.close();

      const after = await createOttoMastraMemory(options);
      const { model, calls } = recordingModel("openai.responses");

      await send(withOttoPrompt(model, context(changed), storedChatContexts(after.memory), now), [
        loaded(2),
        assistant("b"),
        user("c"),
      ]);

      expect(calls[0]?.prompt.slice(0, 2)).toEqual(callsBefore[0]?.prompt.slice(0, 2));
      expect(calls[0]?.prompt.slice(2)).toEqual([
        loaded(2),
        assistant("b"),
        user("c"),
        {
          role: "system",
          content: createOttoChatContextUpdate([["workspace", "People: Ana\nProjects: Beta"]]),
        },
        { role: "system", content: TURN },
      ]);
      expect((await after.memory.getThreadById({ threadId: "thread-1" }))?.title).toBe("Launch");
      await after.close();
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps a memory written during a turn as an update after the reloaded history", async () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-chat-context-"));
    const before = { botConversation: true, botName: "Mina", workspaceContext: "People: Ben" };
    const after = { ...before, persistentMemoryContext: "- [m_1] Ben prefers bullet points." };

    // Mastra stamps every loaded message with a fresh createdAt on each request.
    const loaded = (message: Prompt[number], createdAt: number): Prompt[number] => ({
      ...message,
      providerOptions: { mastra: { createdAt } },
    });

    const call: Prompt[number] = {
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "call-1", toolName: "memory_update", input: {} }],
    };

    const result: Prompt[number] = {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "memory_update",
          output: { type: "json", value: { status: "saved" } },
        },
      ],
    };

    const history = (createdAt: number) =>
      [
        user("Remember I like bullet points."),
        call,
        result,
        assistant("Got it."),
        user("And?"),
      ].map((message) => loaded(message, createdAt));

    try {
      const memory = await createOttoMastraMemory({
        memoryDbPath: NodePath.join(directory, "messages.sqlite"),
      });

      await memory.memory.createThread({ threadId: "thread-1", resourceId: "thread-1" });
      const chats = storedChatContexts(memory.memory);
      const { model, calls } = recordingModel("openai.responses");

      // The memory is written by a tool during the first turn; the next turn sees it.
      await send(withOttoPrompt(model, context(before), chats, now), history(1).slice(0, 1));
      await send(withOttoPrompt(model, context(before), chats, now), history(2).slice(0, 3));
      await send(withOttoPrompt(model, context(after), chats, now), history(3));
      await send(withOttoPrompt(model, context(after), chats, now), [
        ...history(4),
        assistant("Bullets."),
        user("Thanks."),
      ]);
      await memory.close();

      const update = {
        role: "system",
        content: createOttoChatContextUpdate([["memory", after.persistentMemoryContext]]),
      };

      expect(calls[2]?.prompt.slice(0, 2)).toEqual(calls[0]?.prompt.slice(0, 2));
      expect(calls[2]?.prompt.slice(2)).toEqual([
        ...history(3),
        update,
        { role: "system", content: TURN },
      ]);
      expect(calls[3]?.prompt.slice(0, 2)).toEqual(calls[0]?.prompt.slice(0, 2));
      expect(calls[3]?.prompt.slice(2)).toEqual([
        ...history(4),
        update,
        assistant("Bullets."),
        user("Thanks."),
        { role: "system", content: TURN },
      ]);
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("sends a compaction instruction in place of the turn block, after the same history", async () => {
    const { model, calls } = recordingModel("anthropic.messages");
    const chats = inMemoryChats();
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
      withOttoPrompt(model, context({ workspaceContext: "People: Ana" }), inMemoryChats(), now),
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
