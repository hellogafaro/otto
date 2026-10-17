import type { Memory } from "@mastra/memory";
import * as DateTime from "effect/DateTime";

import { type OttoMastraHarness } from "./otto-harness-types.ts";

/** Stores a turn another provider ran in the chat's Mastra thread. */
export function createPersistExternalTurn(memory: Memory) {
  return async (input: Parameters<NonNullable<OttoMastraHarness["persistExternalTurn"]>>[0]) => {
    const existingThread = await memory.getThreadById({
      threadId: input.threadId,
      resourceId: input.threadId,
    });

    if (!existingThread) {
      await memory.createThread({ threadId: input.threadId, resourceId: input.threadId });
    }

    const createdAt = DateTime.toDate(DateTime.makeUnsafe(input.createdAt));
    await memory.persistMessages([
      ...input.userMessages.map((message) => ({
        id: `${input.turnId}:user:${message.id}`,
        role: "user" as const,
        content: { format: 2 as const, parts: [{ type: "text" as const, text: message.text }] },
        createdAt,
        threadId: input.threadId,
        resourceId: input.threadId,
      })),
      {
        id: `${input.turnId}:assistant`,
        role: "assistant",
        content: { format: 2, parts: [{ type: "text", text: input.assistant }] },
        createdAt,
        threadId: input.threadId,
        resourceId: input.threadId,
      },
    ]);
  };
}
