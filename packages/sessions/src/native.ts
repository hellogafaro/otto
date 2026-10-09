import type { MastraDBMessage } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { PostgresStore } from "@mastra/pg";
import { DomainError, required } from "@otto/shared";

export interface NativeSessionStorage {
  storage: PostgresStore;
  memory: Memory;
  close(): Promise<void>;
}

export async function openNativeStorage(input: {
  connectionString: string;
}): Promise<NativeSessionStorage> {
  const storage = new PostgresStore({
    id: "otto-native",
    connectionString: input.connectionString,
    schemaName: "mastra",
  });
  try {
    await storage.init();
    const memory = new Memory({
      storage,
      options: {
        lastMessages: 100,
        semanticRecall: false,
        workingMemory: { enabled: false },
        generateTitle: false,
      },
    });
    return {
      storage,
      memory,
      async close() {
        await memory.settled();
        await storage.close();
      },
    };
  } catch (error) {
    await storage.close();
    throw error;
  }
}

export async function saveNativeMessage(
  native: NativeSessionStorage,
  input: {
    workspaceId: string;
    threadId: string;
    messageId: string;
    role: "user" | "assistant";
    body: string;
    createdAt: Date;
  },
): Promise<MastraDBMessage> {
  if (Buffer.byteLength(input.body) > 100000)
    throw new DomainError("invalid", "Message size limit");
  const store = required(await native.storage.getStore("memory"));
  const thread = await store.getThreadById({ threadId: input.threadId });
  if (thread && thread.resourceId !== input.workspaceId)
    throw new DomainError("forbidden");
  if (!thread)
    await store.saveThread({
      thread: {
        id: input.threadId,
        resourceId: input.workspaceId,
        title: "Chat",
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      },
    });
  const prior = (
    await store.listMessagesById({ messageIds: [input.messageId] })
  ).messages[0];
  if (prior) {
    if (
      prior.threadId !== input.threadId ||
      prior.resourceId !== input.workspaceId ||
      prior.role !== input.role ||
      prior.content.parts.length !== 1 ||
      prior.content.parts[0]?.type !== "text" ||
      prior.content.parts[0].text !== input.body
    )
      throw new DomainError("conflict", "Native message identity changed");
    return prior;
  }
  return required(
    (
      await store.saveMessages({
        messages: [
          {
            id: input.messageId,
            threadId: input.threadId,
            resourceId: input.workspaceId,
            role: input.role,
            createdAt: input.createdAt,
            content: { format: 2, parts: [{ type: "text", text: input.body }] },
          },
        ],
      })
    ).messages[0],
  );
}

export async function readNativeMessages(
  native: NativeSessionStorage,
  input: { workspaceId: string; threadId: string; messageIds: string[] },
): Promise<MastraDBMessage[]> {
  if (input.messageIds.length > 100)
    throw new DomainError("invalid", "Message page limit");
  if (!input.messageIds.length) return [];
  const store = required(await native.storage.getStore("memory"));
  const thread = required(
    (await store.getThreadById({
      threadId: input.threadId,
      resourceId: input.workspaceId,
    })) ?? undefined,
  );
  if (thread.resourceId !== input.workspaceId)
    throw new DomainError("forbidden");
  const { messages } = await store.listMessagesById({
    messageIds: input.messageIds,
  });
  if (
    messages.some(
      (message) =>
        message.threadId !== input.threadId ||
        message.resourceId !== input.workspaceId,
    )
  )
    throw new DomainError("forbidden");
  const byId = new Map(messages.map((message) => [message.id, message]));
  return input.messageIds.map((id) => required(byId.get(id)));
}
