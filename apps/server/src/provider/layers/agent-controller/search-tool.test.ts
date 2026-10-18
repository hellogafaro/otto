import { AuthSessionId, BotId, GroupId, MessageId, ThreadId } from "@otto/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ProjectionThreadMessageRepositoryLive } from "../../../persistence/layers/projection-thread-messages.ts";
import { SqlitePersistenceMemory } from "../../../persistence/layers/sqlite.ts";
import { ProjectionThreadMessageRepository } from "../../../persistence/services/projection-thread-messages.ts";
import { createSessionSearch } from "./search-tool.ts";

const nova = BotId.make("bot-nova");

const ana = AuthSessionId.make("person-ana");

const ben = AuthSessionId.make("person-ben");

const createdAt = "2026-03-01T10:00:00.000Z";

const group = (id: string) => ({
  id: GroupId.make(id),
  members: [
    { kind: "person" as const, personId: ana, role: "member" as const },
    { kind: "person" as const, personId: ben, role: "member" as const },
    { kind: "bot" as const, botId: nova, role: "member" as const },
  ],
});

const chat = (
  id: string,
  fields: {
    readonly groupId?: GroupId;
    readonly botId?: BotId;
    readonly createdBy?: AuthSessionId;
    readonly visibility?: "user" | "organization";
  },
) => ({
  id: ThreadId.make(id),
  title: id,
  parentThreadId: null,
  ...fields,
});

const routine = (
  id: string,
  fields: { readonly botId?: BotId; readonly visibility?: "user" | "organization" },
) => ({
  id,
  botId: nova,
  job: `${id} launch report`,
  procedure: "Summarize the launch.",
  schedule: { kind: "daily", time: "09:00" },
  enabled: true,
  lifecycle: "enabled",
  nextRunAt: null,
  createdBy: ana,
  visibility: "organization",
  deletedAt: null,
  updatedAt: createdAt,
  ...fields,
});

const snapshot = {
  groups: [group("group-here"), group("group-team")],
  bots: [{ id: nova, name: "Nova" }],
  threads: [
    chat("group-chat", { groupId: GroupId.make("group-here") }),
    chat("team-chat", { groupId: GroupId.make("group-team") }),
    chat("ana-private", { botId: nova, createdBy: ana, visibility: "user" }),
    chat("ana-open", { botId: nova, createdBy: ana, visibility: "organization" }),
    chat("other-bot", { botId: BotId.make("bot-other"), createdBy: ana }),
  ],
  routines: [
    routine("shared", {}),
    routine("private", { visibility: "user" }),
    routine("other", { botId: BotId.make("bot-other") }),
  ],
};

/** Nova's search from one chat, over a real message table holding "launch" in every chat. */
const searchFrom = (
  threadId: string,
  request: Parameters<ReturnType<typeof createSessionSearch>>[0],
) =>
  Effect.gen(function* () {
    const messages = yield* ProjectionThreadMessageRepository;

    for (const thread of snapshot.threads) {
      yield* messages.upsert({
        messageId: MessageId.make(`message-${thread.id}`),
        threadId: thread.id,
        turnId: null,
        role: "user",
        authorDisplayName: "Ana",
        text: `The launch moved, said ${thread.id}`,
        isStreaming: false,
        createdAt,
        updatedAt: createdAt,
      });
    }

    const search = createSessionSearch(
      {
        runPromise: Effect.runPromise,
        // SAFETY: Search reads only these shell snapshot fields.
        projectionSnapshotQuery: Option.some({
          getShellSnapshot: () => Effect.succeed(snapshot),
        } as never),
        // SAFETY: Search reads only the routine list.
        routineRepository: Option.some({ listAll: Effect.succeed(snapshot.routines) } as never),
        projectionMessages: Option.some(messages),
        sessions: new Map(),
      },
      { threadId: ThreadId.make(threadId), botId: nova },
    );

    return yield* Effect.promise(() => search(request));
  }).pipe(
    Effect.provide(
      ProjectionThreadMessageRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    ),
  );

const ids = (result: Awaited<ReturnType<ReturnType<typeof createSessionSearch>>>) =>
  "results" in result ? result.results.map((hit) => `${hit.type}:${hit.id}`).toSorted() : result;

it.effect("finds only what the bot and everyone in a group chat may see", () =>
  Effect.gen(function* () {
    const found = yield* searchFrom("group-chat", { query: "launch" });

    assert.deepEqual(ids(found), [
      "message:message-ana-open",
      "message:message-team-chat",
      "routine:shared",
    ]);
  }),
);

it.effect("finds a person's private chats and routines in their own DM", () =>
  Effect.gen(function* () {
    const found = yield* searchFrom("ana-open", { query: "launch" });

    assert.deepEqual(ids(found), [
      "message:message-ana-private",
      "message:message-group-chat",
      "message:message-team-chat",
      "routine:private",
      "routine:shared",
    ]);
  }),
);

it.effect("names the fix for a call it cannot answer", () =>
  Effect.gen(function* () {
    assert.deepEqual(yield* searchFrom("group-chat", {}), {
      error: "Pass a query, a type, or both.",
    });

    assert.deepEqual(yield* searchFrom("group-chat", { type: "message", due: "today" }), {
      error: "status, assignee, projectId and due only apply to type task.",
    });
  }),
);
