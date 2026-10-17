import { partialSdkFixture } from "./test-support/partial-sdk-fixture.ts";
import { describe } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { MessageList } from "@mastra/core/agent";
import { RequestContext } from "@mastra/core/request-context";
import { Memory } from "@mastra/memory";
import * as DateTime from "effect/DateTime";
import { it } from "@effect/vitest";
import { assert, expect, vi } from "vite-plus/test";
import { OttoHistoryProcessor, createOttoMastraMemory } from "./otto-mastra-harness.ts";
import { createOttoCompaction } from "./mastra/otto-compaction.ts";
import { OTTO_REPLY_BOT_NAME } from "./chat-history.ts";
import { groupTurnNote } from "../orchestration/group-responder.ts";

const chat = (
  threadId: string,
  state: { readonly botName?: string; readonly groupContext?: string } = {},
) => {
  const requestContext = new RequestContext();
  requestContext.set("MastraMemory", { thread: { id: threadId }, resourceId: threadId });
  requestContext.set("controller", { state, resourceId: threadId });

  return requestContext;
};

const groupBot = (botName: string) =>
  chat("thread-group", { botName, groupContext: "Group: Mates." });

const historyProcessor = (memory: Memory) =>
  new OttoHistoryProcessor(memory, createOttoCompaction({ memory, warn: () => undefined }));

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
  it("sends the whole stored history after reopening", async () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-message-store-"));
    const options = { memoryDbPath: NodePath.join(directory, "messages.sqlite") };

    try {
      const first = await createOttoMastraMemory(options);
      await first.memory.createThread({
        threadId: "thread-history",
        resourceId: "thread-history",
      });

      const messages = Array.from({ length: 128 }, (_, index) => ({
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

      await reopened.processor.processInputStep({
        stepNumber: 0,
        messageList,
        state: {},
        requestContext: chat("thread-history"),
      } as never);

      assert.deepEqual(
        messageList.get.remembered.db().map((message) => message.id),
        messages.map((message) => message.id),
      );
      assert.equal(messageList.get.input.db()[0]?.id, "current-message");
      await reopened.close();
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("persists only messages created by the current turn", async () => {
    const persistMessages = vi.fn(async () => undefined);

    const processor = historyProcessor(partialSdkFixture<Memory>({ persistMessages }));

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

    const processor = historyProcessor(partialSdkFixture<Memory>({ persistMessages }));

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

  it("does not store a group turn that was only its hidden note", async () => {
    const persistMessages = vi.fn(async () => undefined);

    const processor = historyProcessor(partialSdkFixture<Memory>({ persistMessages }));

    const messageList = new MessageList({ threadId: "thread-group", resourceId: "thread-group" });
    messageList.add(stored("note", "user", groupTurnNote("fallback")), "input");
    messageList.add(stored("reply", "assistant", "Here is the plan."), "response");

    await processor.processOutputResult({ messageList, requestContext: groupBot("Ivy") } as never);

    expect(persistMessages).toHaveBeenCalledWith([expect.objectContaining({ id: "reply" })]);
  });

  it("shows another group bot's reply, or an unnamed older one, as not its own", async () => {
    const processor = historyProcessor(
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
      state: {},
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
