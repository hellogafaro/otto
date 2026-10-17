import * as Predicate from "effect/Predicate";
import { AuthSessionId, BotId, MessageId, ThreadId, TurnId } from "@otto/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ProjectionThreadMessageRepository } from "../services/projection-thread-messages.ts";
import { ProjectionThreadMessageRepositoryLive } from "./projection-thread-messages.ts";
import { SqlitePersistenceMemory } from "./sqlite.ts";

const layer = it.layer(
  ProjectionThreadMessageRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("ProjectionThreadMessageRepository", (it) => {
  it.effect("preserves streamed text when an empty message completes the stream", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadMessageRepository;
      const threadId = ThreadId.make("thread-streaming-completion");
      const messageId = MessageId.make("message-streaming-completion");
      const createdAt = "2026-09-01T17:00:00.000Z";

      yield* repository.appendStreaming({
        messageId,
        threadId,
        turnId: null,
        role: "assistant",
        text: "one",
        createdAt,
        updatedAt: createdAt,
      });
      yield* repository.appendStreaming({
        messageId,
        threadId,
        turnId: null,
        role: "assistant",
        text: " two",
        createdAt,
        updatedAt: "2026-09-01T17:00:01.000Z",
      });
      yield* repository.appendStreaming({
        messageId,
        threadId,
        turnId: null,
        role: "assistant",
        text: " three",
        createdAt,
        updatedAt: "2026-09-01T17:00:02.000Z",
      });

      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "assistant",
        text: "",
        isStreaming: false,
        createdAt,
        updatedAt: "2026-09-01T17:00:03.000Z",
      });

      const result = yield* repository.getByMessageId({ messageId });
      assert.equal(result._tag, "Some");

      if (Predicate.isTagged(result, "Some")) {
        assert.equal(result.value.text, "one two three");
        assert.isFalse(result.value.isStreaming);
        assert.equal(result.value.updatedAt, "2026-09-01T17:00:03.000Z");
      }
    }),
  );

  it.effect("allows empty text to replace a completed message", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadMessageRepository;
      const threadId = ThreadId.make("thread-empty-completed-message");
      const messageId = MessageId.make("message-empty-completed-message");
      const createdAt = "2026-09-01T17:10:00.000Z";

      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "assistant",
        text: "replace me",
        isStreaming: false,
        createdAt,
        updatedAt: createdAt,
      });
      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "assistant",
        text: "",
        isStreaming: false,
        createdAt,
        updatedAt: "2026-09-01T17:10:01.000Z",
      });

      const result = yield* repository.getByMessageId({ messageId });
      assert.equal(result._tag, "Some");

      if (Predicate.isTagged(result, "Some")) {
        assert.equal(result.value.text, "");
      }
    }),
  );

  it.effect("appends streaming text without replacing Otto message metadata", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadMessageRepository;
      const threadId = ThreadId.make("thread-streaming-append");
      const messageId = MessageId.make("message-streaming-append");
      const respondingBotId = BotId.make("bot-streaming-append");
      const createdAt = "2026-09-01T18:00:00.000Z";

      const channelOrigin = {
        provider: "telegram" as const,
        externalThreadId: "telegram-chat-streaming",
        externalSenderId: "telegram-user-streaming",
      };

      const attachments = [
        {
          type: "image" as const,
          id: "streaming-attachment-1",
          name: "streaming.png",
          mimeType: "image/png",
          sizeBytes: 5,
        },
      ];

      yield* repository.appendStreaming({
        messageId,
        threadId,
        turnId: null,
        respondingBotId,
        channelOrigin,
        role: "assistant",
        text: "hello",
        attachments,
        createdAt,
        updatedAt: createdAt,
      });

      const initial = yield* repository.getByMessageId({ messageId });
      assert.equal(initial._tag, "Some");

      if (Predicate.isTagged(initial, "Some")) {
        yield* repository.upsert({
          ...initial.value,
          reactions: [{ botId: respondingBotId, emoji: "eyes" }],
        });
      }

      const updatedAt = "2026-09-01T18:00:01.000Z";
      yield* repository.appendStreaming({
        messageId,
        threadId,
        turnId: null,
        role: "assistant",
        text: " world",
        createdAt: updatedAt,
        updatedAt,
      });

      const result = yield* repository.getByMessageId({ messageId });
      assert.equal(result._tag, "Some");

      if (Predicate.isTagged(result, "Some")) {
        assert.equal(result.value.text, "hello world");
        assert.equal(result.value.respondingBotId, respondingBotId);
        assert.deepEqual(result.value.channelOrigin, channelOrigin);
        assert.deepEqual(result.value.attachments, attachments);
        assert.deepEqual(result.value.reactions, [{ botId: respondingBotId, emoji: "eyes" }]);
        assert.isTrue(result.value.isStreaming);
        assert.equal(result.value.createdAt, createdAt);
        assert.equal(result.value.updatedAt, updatedAt);
      }
    }),
  );

  it.effect("preserves existing attachments when upsert omits attachments", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadMessageRepository;
      const threadId = ThreadId.make("thread-preserve-attachments");
      const messageId = MessageId.make("message-preserve-attachments");
      const createdAt = "2026-02-28T19:00:00.000Z";
      const updatedAt = "2026-02-28T19:00:01.000Z";

      const persistedAttachments = [
        {
          type: "image" as const,
          id: "thread-preserve-attachments-att-1",
          name: "example.png",
          mimeType: "image/png",
          sizeBytes: 5,
        },
      ];

      const channelOrigin = {
        provider: "telegram" as const,
        externalThreadId: "telegram-chat-1",
        externalSenderId: "telegram-user-7",
      };

      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "user",
        text: "initial",
        attachments: persistedAttachments,
        channelOrigin,
        isStreaming: false,
        createdAt,
        updatedAt,
      });

      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "user",
        text: "updated",
        isStreaming: false,
        createdAt,
        updatedAt: "2026-02-28T19:00:02.000Z",
      });

      const rows = yield* repository.listByThreadId({ threadId });
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.text, "updated");
      assert.deepEqual(rows[0]?.attachments, persistedAttachments);
      assert.deepEqual(rows[0]?.channelOrigin, channelOrigin);

      const rowById = yield* repository.getByMessageId({ messageId });
      assert.equal(rowById._tag, "Some");

      if (Predicate.isTagged(rowById, "Some")) {
        assert.equal(rowById.value.text, "updated");
        assert.deepEqual(rowById.value.attachments, persistedAttachments);
        assert.deepEqual(rowById.value.channelOrigin, channelOrigin);
      }
    }),
  );

  it.effect("allows explicit attachment clearing with an empty array", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadMessageRepository;
      const threadId = ThreadId.make("thread-clear-attachments");
      const messageId = MessageId.make("message-clear-attachments");
      const createdAt = "2026-02-28T19:10:00.000Z";

      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "assistant",
        text: "with attachment",
        channelOrigin: null,
        attachments: [
          {
            type: "image",
            id: "thread-clear-attachments-att-1",
            name: "example.png",
            mimeType: "image/png",
            sizeBytes: 5,
          },
        ],
        isStreaming: false,
        createdAt,
        updatedAt: "2026-02-28T19:10:01.000Z",
      });

      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "assistant",
        text: "cleared",
        attachments: [],
        isStreaming: false,
        createdAt,
        updatedAt: "2026-02-28T19:10:02.000Z",
      });

      const rows = yield* repository.listByThreadId({ threadId });
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.text, "cleared");
      assert.deepEqual(rows[0]?.attachments, []);
      assert.equal(rows[0]?.channelOrigin, null);
    }),
  );

  it.effect("finds the latest user-message time within one thread", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadMessageRepository;
      const threadId = ThreadId.make("thread-latest-user-message");
      assert.isNull(yield* repository.getLatestUserMessageAt({ threadId }));

      const messages = [
        { role: "user", createdAt: "2026-02-28T19:05:02.000Z" },
        { role: "user", createdAt: "2026-02-28T19:05:01.000Z" },
        { role: "assistant", createdAt: "2026-02-28T19:05:03.000Z" },
        { role: "system", createdAt: "2026-02-28T19:05:04.000Z" },
      ] as const;

      for (const [index, message] of messages.entries()) {
        yield* repository.upsert({
          messageId: MessageId.make(`latest-user-message-${index}`),
          threadId,
          turnId: null,
          ...message,
          text: "Message body",
          isStreaming: false,
          updatedAt: "2026-02-28T19:06:00.000Z",
        });
      }

      yield* repository.upsert({
        messageId: MessageId.make("latest-user-message-other-thread"),
        threadId: ThreadId.make("thread-latest-user-message-other"),
        turnId: null,
        role: "user",
        text: "Other thread",
        isStreaming: false,
        createdAt: "2026-02-28T19:05:05.000Z",
        updatedAt: "2026-02-28T19:05:05.000Z",
      });

      assert.strictEqual(
        yield* repository.getLatestUserMessageAt({ threadId }),
        "2026-02-28T19:05:02.000Z",
      );
      yield* repository.deleteByThreadId({ threadId });
      assert.isNull(yield* repository.getLatestUserMessageAt({ threadId }));
    }),
  );

  it.effect("searches finished messages in the given chats, newest first", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadMessageRepository;
      const seen = ThreadId.make("thread-search-seen");
      const hidden = ThreadId.make("thread-search-hidden");

      const messages = [
        { id: "search-old", threadId: seen, text: "Launch on Friday", streaming: false },
        { id: "search-new", threadId: seen, text: "launch moved to 50% Monday", streaming: false },
        { id: "search-streaming", threadId: seen, text: "launch draft", streaming: true },
        { id: "search-hidden", threadId: hidden, text: "launch secret", streaming: false },
        { id: "search-percent", threadId: seen, text: "Up 50 points", streaming: false },
      ];

      for (const [index, message] of messages.entries()) {
        const createdAt = `2026-03-01T10:00:0${index}.000Z`;

        yield* repository.upsert({
          messageId: MessageId.make(message.id),
          threadId: message.threadId,
          turnId: null,
          role: "user",
          text: message.text,
          isStreaming: message.streaming,
          createdAt,
          updatedAt: createdAt,
        });
      }

      const ids = (rows: ReadonlyArray<{ readonly messageId: string }>) =>
        rows.map((row) => row.messageId);

      assert.deepEqual(
        ids(yield* repository.search({ threadIds: [seen], terms: ["LAUNCH"], limit: 10 })),
        ["search-new", "search-old"],
      );

      assert.deepEqual(
        ids(yield* repository.search({ threadIds: [seen], terms: ["50%"], limit: 10 })),
        ["search-new"],
      );

      assert.deepEqual(ids(yield* repository.search({ threadIds: [seen], terms: [], limit: 1 })), [
        "search-percent",
      ]);

      assert.deepEqual(yield* repository.search({ threadIds: [], terms: [], limit: 10 }), []);
    }),
  );

  it.effect("checks assistant turn state without hydrating message text", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadMessageRepository;
      const threadId = ThreadId.make("thread-assistant-turn-state");
      const turnId = TurnId.make("turn-assistant-state");
      const createdAt = "2026-03-01T00:00:00.000Z";

      yield* repository.upsert({
        messageId: MessageId.make("message-assistant-turn-state"),
        threadId,
        turnId,
        role: "assistant",
        text: "large text that the existence query must not select",
        isStreaming: false,
        createdAt,
        updatedAt: createdAt,
      });

      assert.equal(
        yield* repository.hasAssistantMessageForTurn({
          threadId,
          turnId,
          streamingOnly: false,
        }),
        true,
      );
      assert.equal(
        yield* repository.hasAssistantMessageForTurn({
          threadId,
          turnId,
          streamingOnly: true,
        }),
        false,
      );
    }),
  );
  it.effect("finds the chats and authors of messages that carry an attachment", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadMessageRepository;
      const threadId = ThreadId.make("thread-attachment-owner");
      const createdAt = "2026-10-17T10:00:00.000Z";

      const attachment = (id: string) => ({
        type: "file" as const,
        id,
        name: "notes.txt",
        mimeType: "text/plain" as const,
        sizeBytes: 3,
      });

      yield* repository.upsert({
        messageId: MessageId.make("message-attachment-owner"),
        threadId,
        turnId: null,
        authorPersonId: AuthSessionId.make("person-attachment-owner"),
        role: "user",
        text: "see attached",
        attachments: [
          attachment("thread-attachment-owner-1"),
          attachment("thread-attachment-owner-2"),
        ],
        isStreaming: false,
        createdAt,
        updatedAt: createdAt,
      });
      yield* repository.upsert({
        messageId: MessageId.make("message-attachment-bot"),
        threadId,
        turnId: null,
        role: "assistant",
        text: "here it is",
        attachments: [attachment("thread-attachment-owner-10")],
        isStreaming: false,
        createdAt,
        updatedAt: createdAt,
      });

      assert.deepStrictEqual(
        yield* repository.listAttachmentMessages({ attachmentId: "thread-attachment-owner-1" }),
        [{ threadId, authorPersonId: AuthSessionId.make("person-attachment-owner") }],
      );
      assert.deepStrictEqual(
        yield* repository.listAttachmentMessages({ attachmentId: "thread-attachment-owner-10" }),
        [{ threadId, authorPersonId: null }],
      );
      assert.deepStrictEqual(
        yield* repository.listAttachmentMessages({ attachmentId: "thread-attachment-owner" }),
        [],
      );
    }),
  );
});
