import { partialSdkFixture } from "./test-support/partial-sdk-fixture.ts";
import { describe } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { AuthStorage } from "@mastra/code-sdk/auth/storage";
import { MessageList } from "@mastra/core/agent";
import { RequestContext } from "@mastra/core/request-context";
import { Memory } from "@mastra/memory";
import { ObservationalMemory } from "@mastra/memory/processors";
import * as DateTime from "effect/DateTime";
import { it } from "@effect/vitest";
import { assert, expect, vi } from "vite-plus/test";
import {
  OttoPassiveObservationalMemoryProcessor,
  createOttoMastraMemory,
} from "./otto-mastra-harness.ts";
import { OTTO_RECENT_TURN_LIMIT, OTTO_REPLY_BOT_NAME } from "./recent-conversation.ts";

const groupBot = (botName: string) => {
  const requestContext = new RequestContext();
  requestContext.set("controller", { state: { botName, groupContext: "Group: Mates." } });

  return requestContext;
};

const stored = (id: string, role: "user" | "assistant", text: string, author?: string) => ({
  id,
  role,
  createdAt: DateTime.toDate(DateTime.makeUnsafe("2026-08-31T20:00:00.000Z")),
  content: {
    format: 2 as const,
    parts: [{ type: "text" as const, text }],
    ...(author ? { metadata: { [OTTO_REPLY_BOT_NAME]: author } } : {}),
  },
  threadId: "thread-group",
  resourceId: "thread-group",
});

describe("OttoMastraHarness", () => {
  it("restores a bounded recent message window after reopening", async () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-message-store-"));

    const options = {
      authStorage: new AuthStorage(NodePath.join(directory, "auth.json")),
      memoryDbPath: NodePath.join(directory, "observational-memory.sqlite"),
    };

    try {
      const first = await createOttoMastraMemory(options);
      await first.memory.createThread({
        threadId: "thread-history",
        resourceId: "thread-history",
      });

      const messages = Array.from({ length: (OTTO_RECENT_TURN_LIMIT + 2) * 2 }, (_, index) => ({
        id: `message-${index}`,
        role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
        createdAt: DateTime.toDate(
          DateTime.add(DateTime.makeUnsafe("2026-08-30T20:00:00.000Z"), { minutes: index }),
        ),
        content: { format: 2 as const, parts: [{ type: "text" as const, text: `Turn ${index}` }] },
        threadId: "thread-history",
        resourceId: "thread-history",
      }));

      await first.memory.persistMessages(messages);
      await first.close();

      const reopened = await createOttoMastraMemory(options);

      const engine = partialSdkFixture<ObservationalMemory>({
        getThreadContext: vi.fn(() => ({
          threadId: "thread-history",
          resourceId: "thread-history",
        })),
        loadUnobservedMessages: vi.fn(async () => []),
        getOrCreateRecord: vi.fn(async () => ({ activeObservations: "Older observations." })),
        buildContextSystemMessages: vi.fn(async () => ["Older context from observations."]),
      });

      const processor = new OttoPassiveObservationalMemoryProcessor(engine, reopened.memory);

      const messageList = new MessageList({
        threadId: "thread-history",
        resourceId: "thread-history",
      });

      messageList.add(
        {
          id: "current-message",
          role: "user",
          createdAt: DateTime.toDate(DateTime.makeUnsafe("2026-08-31T20:00:00.000Z")),
          content: { format: 2, parts: [{ type: "text", text: "What did we discuss?" }] },
          threadId: "thread-history",
          resourceId: "thread-history",
        },
        "input",
      );

      await processor.processInputStep({ stepNumber: 0, messageList } as never);

      const recalled = messageList.get.remembered.db();
      assert.equal(recalled.length, OTTO_RECENT_TURN_LIMIT * 2);
      assert.deepEqual(
        recalled.map((message) => message.id),
        messages.slice(-OTTO_RECENT_TURN_LIMIT * 2).map((message) => message.id),
      );
      assert.deepEqual(
        messageList.getSystemMessages("observational-memory").map((message) => message.content),
        ["Older context from observations."],
      );
      assert.equal(messageList.get.input.db()[0]?.id, "current-message");
      await reopened.close();
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("adds older observational context beside the recent message window", async () => {
    const engine = partialSdkFixture<ObservationalMemory>({
      getThreadContext: vi.fn(() => ({ threadId: "thread-context", resourceId: "thread-context" })),
      loadUnobservedMessages: vi.fn(async () => []),
      getOrCreateRecord: vi.fn(async () => ({
        activeObservations: "The user prefers short replies.",
      })),
      buildContextSystemMessages: vi.fn(async () => ["Older context: short replies."]),
    });

    const processor = new OttoPassiveObservationalMemoryProcessor(
      engine,
      partialSdkFixture<Memory>({
        recall: vi.fn(async () => ({ messages: [] })),
        persistMessages: vi.fn(async () => undefined),
      }),
    );

    const messageList = new MessageList({
      threadId: "thread-context",
      resourceId: "thread-context",
    });

    messageList.add(
      {
        id: "recent-message",
        role: "user",
        createdAt: DateTime.toDate(DateTime.makeUnsafe("2026-08-31T20:00:00.000Z")),
        content: { format: 2, parts: [{ type: "text", text: "Use the context you remember." }] },
        threadId: "thread-context",
        resourceId: "thread-context",
      },
      "input",
    );

    await processor.processInputStep({ stepNumber: 0, messageList } as never);

    assert.deepEqual(
      messageList.getSystemMessages("observational-memory").map((message) => message.content),
      ["Older context: short replies."],
    );
    assert.lengthOf(messageList.get.input.db(), 1);
    assert.equal(messageList.get.input.db()[0]?.id, "recent-message");
  });

  it("persists only messages created by the current turn", async () => {
    const persistMessages = vi.fn(async () => undefined);

    const engine = partialSdkFixture<ObservationalMemory>({
      getThreadContext: vi.fn(() => ({ threadId: "thread-passive", resourceId: "thread-passive" })),
      loadUnobservedMessages: vi.fn(async () => []),
      getOrCreateRecord: vi.fn(async () => ({ activeObservations: "" })),
      buildContextSystemMessages: vi.fn(async () => []),
    });

    const processor = new OttoPassiveObservationalMemoryProcessor(
      engine,
      partialSdkFixture<Memory>({
        persistMessages,
      }),
    );

    const messageList = new MessageList({
      threadId: "thread-passive",
      resourceId: "thread-passive",
    });

    messageList.add(
      {
        id: "user-history",
        role: "user",
        createdAt: DateTime.toDate(DateTime.makeUnsafe("2026-08-30T20:00:00.000Z")),
        content: { format: 2, parts: [{ type: "text", text: "Earlier turn." }] },
        threadId: "thread-passive",
        resourceId: "thread-passive",
      },
      "memory",
    );

    for (const message of [
      {
        id: "user-current",
        role: "user" as const,
        text: "Only this turn.",
        source: "input" as const,
      },
      {
        id: "assistant-current",
        role: "assistant" as const,
        text: "Current reply.",
        source: "response" as const,
      },
    ]) {
      messageList.add(
        {
          id: message.id,
          role: message.role,
          createdAt: DateTime.toDate(DateTime.makeUnsafe("2026-08-31T20:00:00.000Z")),
          content: { format: 2, parts: [{ type: "text", text: message.text }] },
          threadId: "thread-passive",
          resourceId: "thread-passive",
        },
        message.source,
      );
    }

    await processor.processOutputResult({ messageList } as never);

    expect(persistMessages).toHaveBeenCalledOnce();
    expect(persistMessages).toHaveBeenCalledWith([
      expect.objectContaining({ id: "user-current" }),
      expect.objectContaining({ id: "assistant-current" }),
    ]);
  });

  it("names the bot that wrote each reply", async () => {
    const persistMessages = vi.fn(async () => undefined);

    const processor = new OttoPassiveObservationalMemoryProcessor(
      partialSdkFixture<ObservationalMemory>({}),
      partialSdkFixture<Memory>({ persistMessages }),
    );

    const messageList = new MessageList({ threadId: "thread-group", resourceId: "thread-group" });
    messageList.add(stored("person", "user", "Ana: hi"), "input");
    messageList.add(stored("reply", "assistant", "Hi Ana."), "response");

    await processor.processOutputResult({ messageList, requestContext: groupBot("Ivy") } as never);

    expect(persistMessages).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "person",
        content: expect.not.objectContaining({ metadata: expect.anything() }),
      }),
      expect.objectContaining({
        id: "reply",
        content: expect.objectContaining({ metadata: { [OTTO_REPLY_BOT_NAME]: "Ivy" } }),
      }),
    ]);
  });

  it("shows another group bot's reply, or an unnamed older one, as not its own", async () => {
    const processor = new OttoPassiveObservationalMemoryProcessor(
      partialSdkFixture<ObservationalMemory>({
        getThreadContext: vi.fn(() => ({ threadId: "thread-group", resourceId: "thread-group" })),
        loadUnobservedMessages: vi.fn(async () => []),
        getOrCreateRecord: vi.fn(async () => ({ activeObservations: "" })),
        buildContextSystemMessages: vi.fn(async () => []),
      }),
      partialSdkFixture<Memory>({
        recall: vi.fn(async () => ({
          messages: [
            stored("person", "user", "Ana: say hi"),
            stored("axo", "assistant", "Hi, I'm Axo.", "Axo"),
            stored("ivy", "assistant", "Hi, I'm Ivy.", "Ivy"),
            stored("older", "assistant", "Hello."),
          ],
        })),
      }),
    );

    const messageList = new MessageList({ threadId: "thread-group", resourceId: "thread-group" });
    messageList.add(stored("current", "user", "Ana: who are you?"), "input");

    await processor.processInputStep({
      stepNumber: 0,
      messageList,
      requestContext: groupBot("Ivy"),
    } as never);

    expect(
      messageList.get.remembered
        .db()
        .map((message) => [
          message.id,
          message.role,
          message.content.parts.map((part) => (part.type === "text" ? part.text : part.type)),
        ]),
    ).toEqual([
      ["person", "user", ["Ana: say hi"]],
      ["axo", "user", ["Axo: Hi, I'm Axo."]],
      ["ivy", "assistant", ["Hi, I'm Ivy."]],
      ["older", "user", ["A bot: Hello."]],
    ]);
  });
});
