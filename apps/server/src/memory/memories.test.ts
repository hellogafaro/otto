import {
  AuthSessionId,
  BotId,
  GroupId,
  MEMORY_APPROVAL_REQUESTED_ACTIVITY,
  ProjectId,
  ThreadId,
} from "@otto/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { describe } from "vite-plus/test";

import { ServerConfig } from "../config.ts";
import { OrchestrationEngineService } from "../orchestration/services/orchestration-engine.ts";
import { SqlitePersistenceMemory } from "../persistence/layers/sqlite.ts";
import { createMemoryAccess } from "../provider/layers/agent-controller/memory-access.ts";
import { Memories, MemoriesLive, type MemoryChat } from "./memories.ts";
import { createMemoryUpdateHandler } from "./memory-update-tool.ts";

const icon = AuthSessionId.make("person-icon");

const ana = AuthSessionId.make("person-ana");

const juno = BotId.make("bot-juno");

const people = [
  { id: icon, name: "Icon Gafaro" },
  { id: ana, name: "Ana Lopez" },
];

const chat = (overrides: Partial<MemoryChat>): MemoryChat => ({
  threadId: ThreadId.make("thread-dm"),
  botId: juno,
  groupId: null,
  groupName: "",
  projectId: null,
  projectTitle: "",
  audiencePersonId: null,
  people,
  ...overrides,
});

const iconDm = chat({ threadId: ThreadId.make("thread-icon"), audiencePersonId: icon });

const anaDm = chat({ threadId: ThreadId.make("thread-ana"), audiencePersonId: ana });

const group = chat({
  threadId: ThreadId.make("thread-group"),
  groupId: GroupId.make("group-qa"),
  groupName: "QA",
  projectId: ProjectId.make("project-otto"),
  projectTitle: "Otto",
});

const dispatched: Array<{ readonly type: string; readonly activity?: { readonly kind: string } }> =
  [];

const TestLayer = MemoriesLive.pipe(
  Layer.provide(
    Layer.mock(OrchestrationEngineService)({
      dispatch: (command) =>
        Effect.sync(() => {
          dispatched.push(command as (typeof dispatched)[number]);

          return { sequence: dispatched.length };
        }),
    }),
  ),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "otto-memories-test-" })),
  Layer.provide(NodeServices.layer),
);

const add = (
  target: MemoryChat,
  authorPersonId: AuthSessionId | null,
  scope: "person" | "bot" | "group" | "project" | "workspace",
  text: string,
) =>
  Effect.flatMap(Effect.service(Memories), (memories) =>
    memories.applyChanges({
      chat: target,
      authorPersonId,
      changes: [{ action: "add", id: null, scope, text }],
    }),
  );

const render = (target: MemoryChat) =>
  Effect.flatMap(Effect.service(Memories), (memories) => memories.render(target));

const failure = <A, E extends { readonly message: string }, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => error.message),
  );

describe("Memories", () => {
  it.effect("renders a person's facts only in chats that person alone can read", () =>
    Effect.gen(function* () {
      yield* add(iconDm, icon, "person", "Likes durian.");
      yield* add(iconDm, icon, "bot", "Answers in short paragraphs.");

      const iconBlock = yield* render(iconDm);
      expect(iconBlock).toContain('<person name="Icon Gafaro">');
      expect(iconBlock).toContain("Likes durian.");

      for (const other of [anaDm, group]) {
        const block = yield* render(other);
        expect(block).not.toContain("durian");
        expect(block).not.toContain("<person");
        expect(block).toContain("Answers in short paragraphs.");
      }
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("keeps facts about people out of bot memory", () =>
    Effect.gen(function* () {
      const message = yield* failure(add(group, icon, "bot", "Ana has a dentist on Friday."));
      expect(message).toContain("scope person");
      expect(yield* render(group)).toBe("");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("ignores an exact repeat and rejects a near-duplicate with the existing id", () =>
    Effect.gen(function* () {
      const [saved] = yield* add(group, icon, "group", "Standup is at 9:30 on weekdays.");
      const [repeat] = yield* add(group, ana, "group", "standup is at 9:30 on weekdays.");
      expect(repeat).toEqual({ id: saved!.id, status: "unchanged" });

      const message = yield* failure(
        add(group, ana, "group", "Standup is at 9:30 on weekdays now."),
      );

      expect(message).toContain(saved!.id);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("rejects a change that would overflow its scope", () =>
    Effect.gen(function* () {
      const fact = (index: number) =>
        Array.from({ length: 30 }, (_, word) => `w${index}x${word}`).join(" ") + ".";

      let used = 0;

      for (let index = 0; used + fact(index).length <= 1_500; index += 1) {
        yield* add(iconDm, icon, "person", fact(index));
        used += fact(index).length;
      }

      const message = yield* failure(add(iconDm, icon, "person", fact(99)));
      expect(message).toContain("The person memory is full");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("holds project changes for approval and applies them once", () =>
    Effect.gen(function* () {
      dispatched.length = 0;
      const memories = yield* Memories;
      const [proposal] = yield* add(group, icon, "project", "Releases ship on Thursdays.");
      expect(proposal?.status).toBe("pending_approval");
      expect(yield* render(group)).not.toContain("Thursdays");
      expect(dispatched.map((command) => command.activity?.kind)).toEqual([
        MEMORY_APPROVAL_REQUESTED_ACTIVITY,
      ]);

      const row = yield* memories.get(proposal!.id);
      const decide = memories.decide({ personId: ana, row, decision: "approve" });
      expect(yield* decide).toBe(true);
      expect(yield* decide).toBe(false);
      expect(yield* render(group)).toContain('<project name="Otto">');
      expect(yield* render(group)).toContain("Releases ship on Thursdays.");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("turns memory off in context and in the tool while Memory is off", () =>
    Effect.gen(function* () {
      const memories = yield* Memories;
      yield* add(iconDm, icon, "person", "Likes durian.");

      const access = createMemoryAccess({
        runPromise: Effect.runPromise,
        memories: Option.some(memories),
        memoryEnabled: () => Effect.succeed(false),
        memoryTurns: new Map([[String(iconDm.threadId), { chat: iconDm, authorPersonId: icon }]]),
      });

      expect(yield* Effect.promise(() => access.memoryContext(iconDm))).toBe("");

      const handler = createMemoryUpdateHandler({
        turn: () => ({ chat: iconDm, authorPersonId: icon }),
        enabled: async () => false,
        memories,
        run: Effect.runPromise,
      });

      const call = handler({
        threadId: String(iconDm.threadId),
        toolId: "memory_update",
        toolCallId: "memory-off",
        input: { changes: [{ action: "add", id: null, scope: "person", text: "Hates durian." }] },
        approvalMode: "require-grant",
      });

      yield* Effect.promise(() => expect(call).rejects.toThrow("turned off"));
    }).pipe(Effect.provide(TestLayer)),
  );
});
