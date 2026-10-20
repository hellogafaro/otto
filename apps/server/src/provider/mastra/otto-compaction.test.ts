import { MessageList } from "@mastra/core/agent";
import type { MastraDBMessage } from "@mastra/core/agent-controller";
import type { Memory } from "@mastra/memory";
import * as DateTime from "effect/DateTime";
import { describe, expect, it, vi } from "vite-plus/test";

import { OTTO_CHECKPOINT, projectHistory } from "../chat-history.ts";
import { partialSdkFixture } from "../test-support/partial-sdk-fixture.ts";
import {
  contextWindow,
  createOttoCompaction,
  estimateTokens,
  firstKeptIndex,
  isContextOverflow,
  OTTO_CHECKPOINT_SECTIONS,
  OTTO_IMAGE_TOKENS,
} from "./otto-compaction.ts";
import type { OttoCallOptions, OttoLanguageModel } from "./otto-instructions.ts";

const threadId = "thread-1";

const thread = { threadId, resourceId: threadId };

const start = DateTime.makeUnsafe("2026-10-17T08:00:00.000Z");

const words = (tokens: number) => "word ".repeat((tokens * 4) / 5);

const message = (
  id: string,
  role: "user" | "assistant",
  text: string,
  minute: number,
): MastraDBMessage => ({
  id,
  role,
  content: { format: 2, parts: [{ type: "text", text }] },
  createdAt: DateTime.toDate(DateTime.add(start, { minutes: minute })),
  threadId,
  resourceId: threadId,
});

/** Six stored turns of about 15,000 tokens each, then this turn's question. */
function longChat() {
  const messageList = new MessageList({ threadId, resourceId: threadId });

  for (let turn = 0; turn < 6; turn += 1) {
    messageList.add(message(`user-${turn}`, "user", words(7_500), turn * 2), "memory");
    messageList.add(
      message(`assistant-${turn}`, "assistant", words(7_500), turn * 2 + 1),
      "memory",
    );
  }

  messageList.add(message("question", "user", "What now?", 100), "input");

  return messageList;
}

const checkpointText = OTTO_CHECKPOINT_SECTIONS.map(([title]) => `## ${title}\n(none)`).join(
  "\n\n",
);

function fixtureModel(reply: string) {
  const calls: OttoCallOptions[] = [];

  const model: OttoLanguageModel = {
    specificationVersion: "v3",
    provider: "custom-openai.chat",
    modelId: "local",
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error("Compaction streams.");
    },
    doStream: async (params) => {
      calls.push(params);

      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "text-delta", id: "text-1", delta: reply });
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: { total: 96_000, noCache: 1_000, cacheRead: 95_000, cacheWrite: 0 },
                outputTokens: { total: 900, text: 900, reasoning: 0 },
              },
            });
            controller.close();
          },
        }),
      };
    },
  };

  return { model, calls };
}

function setup(reply = checkpointText) {
  const persistMessages = vi.fn(async (_messages: ReadonlyArray<MastraDBMessage>) => undefined);
  const finishCompaction = vi.fn(async () => undefined);
  const warn = vi.fn();

  const compaction = createOttoCompaction({
    memory: partialSdkFixture<Memory>({ persistMessages }),
    warn,
    startCompaction: async () => "compaction-call",
    finishCompaction,
  });

  const { model, calls } = fixtureModel(reply);

  const lastParams: OttoCallOptions = {
    prompt: [{ role: "user", content: [{ type: "text", text: "the last request" }] }],
    tools: [{ type: "function", name: "read", inputSchema: { type: "object" } }],
    toolChoice: { type: "auto" },
    maxOutputTokens: 32_768,
  };

  compaction.requests.set(threadId, { model, params: lastParams });

  return { compaction, calls, lastParams, persistMessages, finishCompaction, warn };
}

// An unknown model has a 128,000-token window, so compaction starts above 95,232.
const MODEL = "custom-openai/local";

describe("contextWindow", () => {
  it("uses the catalog window, at most 400,000 tokens, else 128,000", () => {
    expect(contextWindow("openai/gpt-6.1-sol")).toBe(400_000);
    expect(contextWindow("anthropic/claude-opus-5-5")).toBe(400_000);
    expect(contextWindow("anthropic/claude-sonnet-4-5")).toBe(200_000);
    expect(contextWindow("openai/gpt-5.4-mini")).toBe(272_000);
    expect(contextWindow(MODEL)).toBe(128_000);
  });
});

describe("estimateTokens", () => {
  it("counts an inline image as a fixed amount, not by its base64 length", () => {
    const image = {
      ...message("image", "user", "look", 0),
      content: {
        format: 2 as const,
        parts: [
          { type: "text" as const, text: "look" },
          { type: "file" as const, mimeType: "image/png", data: "iVBORw0K".repeat(41_250) },
        ],
      },
    };

    expect(estimateTokens([image])).toBeLessThan(OTTO_IMAGE_TOKENS + 100);
    expect(estimateTokens([image])).toBeGreaterThanOrEqual(OTTO_IMAGE_TOKENS);
  });

  it("counts a multi-megabyte inline image without overflowing the stack", () => {
    // A 6.5 MB PNG is about 8.7 MB of base64.
    const data = "iVBORw0K".repeat(1_150_000);

    const image = {
      ...message("image", "user", "look", 0),
      content: {
        format: 2 as const,
        parts: [
          { type: "text" as const, text: "look" },
          { type: "file" as const, mimeType: "image/png", data },
          { type: "file" as const, mimeType: "image/png", data: `data:image/png;base64,${data}` },
        ],
      },
    };

    expect(estimateTokens([image])).toBeLessThan(2 * OTTO_IMAGE_TOKENS + 100);
    expect(estimateTokens([image])).toBeGreaterThanOrEqual(2 * OTTO_IMAGE_TOKENS);
  });
});

describe("firstKeptIndex", () => {
  it("keeps at least the given tokens from a user message and never splits a turn", () => {
    const messages = longChat().get.all.db();

    expect(messages[firstKeptIndex(messages, 12_800, 10)!]?.id).toBe("user-5");
    expect(messages[firstKeptIndex(messages, 20_000, 10)!]?.id).toBe("user-4");
    // A newest turn larger than the share to keep is kept whole.
    expect(messages[firstKeptIndex(messages, 1_000, 10)!]?.id).toBe("user-5");
    expect(firstKeptIndex(messages, 1_000_000, 10)).toBeUndefined();
  });
});

describe("createOttoCompaction", () => {
  it("does nothing below the threshold", async () => {
    const { compaction, calls } = setup();
    const messageList = longChat();

    compaction.recordUsage(
      { usage: { inputTokens: 80_000, outputTokens: 500 }, messageList } as never,
      threadId,
      MODEL,
    );
    await compaction.compactIfNeeded({ messageList, stepNumber: 0, state: {} }, thread, MODEL);

    expect(calls).toHaveLength(0);
    expect(messageList.get.all.db()).toHaveLength(13);
  });

  it("compacts once near the window with the last request and an instruction", async () => {
    const { compaction, calls, lastParams, persistMessages, finishCompaction } = setup();
    const messageList = longChat();

    compaction.recordUsage(
      { usage: { inputTokens: 95_000, outputTokens: 1_000 }, messageList } as never,
      threadId,
      MODEL,
    );
    await compaction.compactIfNeeded({ messageList, stepNumber: 0, state: {} }, thread, MODEL);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.tools).toEqual(lastParams.tools);
    expect(calls[0]?.toolChoice).toEqual(lastParams.toolChoice);
    expect(calls[0]?.prompt.slice(0, -1)).toEqual(lastParams.prompt);
    expect(calls[0]?.prompt.at(-1)).toMatchObject({
      role: "user",
      providerOptions: { otto: { compaction: true } },
    });

    const checkpoint = persistMessages.mock.calls[0]![0][0]!;
    expect(checkpoint.role).toBe("assistant");
    expect(checkpoint.content.metadata?.[OTTO_CHECKPOINT]).toMatchObject({
      firstKeptMessageId: "user-5",
      model: MODEL,
    });
    expect(finishCompaction).toHaveBeenCalledWith({
      callId: "compaction-call",
      usage: {
        inputTokens: 96_000,
        cachedInputTokens: 95_000,
        cacheCreationTokens: 0,
        outputTokens: 900,
      },
    });

    const sent = messageList.get.all.db();
    expect(sent.map(({ id, role }) => [id, role])).toEqual([
      [checkpoint.id, "user"],
      ["user-5", "user"],
      ["assistant-5", "assistant"],
      ["question", "user"],
    ]);
    expect(messageList.get.input.db().map(({ id }) => id)).toEqual(["question"]);

    // The next turn's projection of the stored chat matches what this request sent.
    const stored = [...longChat().get.remembered.db(), checkpoint];
    expect(projectHistory(stored).map(({ id }) => id)).toEqual([
      checkpoint.id,
      "user-5",
      "assistant-5",
    ]);

    // The measure starts again from the estimate, so the next request does not compact.
    await compaction.compactIfNeeded({ messageList, stepNumber: 1, state: {} }, thread, MODEL);
    expect(calls).toHaveLength(1);
  });

  it("keeps the current turn and compacts what came before it mid-turn", async () => {
    const { compaction, persistMessages } = setup();
    const messageList = longChat();

    compaction.recordUsage(
      { usage: { inputTokens: 99_000, outputTokens: 1_000 }, messageList } as never,
      threadId,
      MODEL,
    );
    messageList.add(message("reply", "assistant", words(14_000), 101), "response");
    await compaction.compactIfNeeded({ messageList, stepNumber: 3, state: {} }, thread, MODEL);

    const checkpoint = persistMessages.mock.calls[0]![0][0]!;
    expect(checkpoint.content.metadata?.[OTTO_CHECKPOINT]).toMatchObject({
      firstKeptMessageId: "question",
    });
    expect(messageList.get.all.db().map(({ id }) => id)).toEqual([
      checkpoint.id,
      "question",
      "reply",
    ]);
  });

  it("compacts below the threshold once the provider rejected the request as too long", async () => {
    const { compaction, calls } = setup();
    const messageList = longChat();

    const overflow = Object.assign(new Error("Bad Request"), {
      responseBody: '{"error":{"code":"context_length_exceeded"}}',
    });

    expect(isContextOverflow(overflow)).toBe(true);
    expect(isContextOverflow(new Error("Rate limit reached"))).toBe(false);
    expect(
      await compaction.compactIfNeeded(
        { messageList, stepNumber: 0, state: {} },
        thread,
        MODEL,
        true,
      ),
    ).toBe(true);
    expect(calls).toHaveLength(1);
    expect(messageList.get.all.db()).toHaveLength(4);
  });

  it("keeps history as it is when the checkpoint is incomplete, and does not retry that run", async () => {
    const { compaction, calls, persistMessages, warn, finishCompaction } = setup(
      "## Goal and acceptance\nShip it.",
    );

    const messageList = longChat();
    const state = {};

    compaction.recordUsage(
      { usage: { inputTokens: 99_000, outputTokens: 1_000 }, messageList } as never,
      threadId,
      MODEL,
    );
    await compaction.compactIfNeeded({ messageList, stepNumber: 0, state }, thread, MODEL);
    await compaction.compactIfNeeded({ messageList, stepNumber: 1, state }, thread, MODEL);

    expect(calls).toHaveLength(1);
    expect(persistMessages).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    expect(finishCompaction).toHaveBeenCalledWith(
      expect.objectContaining({ callId: "compaction-call", usage: expect.anything() }),
    );
    expect(messageList.get.all.db()).toHaveLength(13);
  });
});
