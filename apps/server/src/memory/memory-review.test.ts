import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AuthSessionId,
  BotId,
  CommandId,
  EventId,
  MessageId,
  type ModelSelection,
  type OrchestrationEvent,
  type OrchestrationMessage,
  type OrchestrationProjectShell,
  ProviderDriverKind,
  ProviderInstanceId,
  TurnId,
} from "@otto/contracts";
import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { describe } from "vite-plus/test";

import { ServerConfig } from "../config.ts";
import { OrchestrationEngineService } from "../orchestration/services/orchestration-engine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/services/projection-snapshot-query.ts";
import { makeBot, makeBotThread } from "../orchestration/test-support/bot-delete-fixtures.ts";
import { SqlitePersistenceMemory } from "../persistence/layers/sqlite.ts";
import { AgentController } from "../provider/services/agent-controller.ts";
import { ServerSettingsService } from "../server-settings.ts";
import { type MemoryReviewInput, TextGeneration } from "../text-generation/text-generation.ts";
import { Memories, MemoriesLive, personMemory, TEAM_MEMORY } from "./memories.ts";
import { MemoryReviewLive } from "./memory-review.ts";

const juno = BotId.make("bot-juno");

const ana = AuthSessionId.make("person-ana");

const chat = { ...makeBotThread(juno), visibility: "organization" as const };

const reviewModel: ModelSelection = {
  instanceId: ProviderInstanceId.make("claude-main"),
  model: "review-model",
};

const message = (
  id: string,
  role: OrchestrationMessage["role"],
  text: string,
  createdAt: string,
): OrchestrationMessage => ({
  id: MessageId.make(id),
  role,
  text,
  turnId: TurnId.make("turn-1"),
  ...(role === "user" ? { authorDisplayName: "Ana" } : { respondingBotId: juno }),
  streaming: false,
  createdAt,
  updatedAt: createdAt,
});

const harness = ({ memoryEnabled = true, privateChat = false } = {}) =>
  Effect.gen(function* () {
    const events = yield* PubSub.unbounded<OrchestrationEvent>();
    const reviews: MemoryReviewInput[] = [];
    let messages: OrchestrationMessage[] = [];

    const dependencies = Layer.mergeAll(
      Layer.mock(OrchestrationEngineService)({ streamDomainEvents: Stream.fromPubSub(events) }),
      Layer.mock(ProjectionSnapshotQuery)({
        getThreadDetailById: () =>
          Effect.succeed(
            Option.some({
              ...chat,
              ...(privateChat ? { visibility: "user" as const, createdBy: ana } : {}),
              messages,
            }),
          ),
        getProjectShellById: () =>
          // SAFETY: The review reads only the project's title.
          Effect.succeed(
            Option.some({
              id: chat.projectId,
              title: "Lora Boutique",
            } as OrchestrationProjectShell),
          ),
        getBotById: () => Effect.succeed(Option.some({ ...makeBot({ id: juno }), name: "Juno" })),
      }),
      Layer.mock(TextGeneration)({
        generateMemoryReview: (input) =>
          Effect.sync(() => {
            reviews.push(input);

            return {
              changes: [
                {
                  action: "add" as const,
                  id: null,
                  text: "Lora invoices are in EUR.",
                  projectOnly: true,
                },
              ],
            };
          }),
      }),
      Layer.mock(AgentController)({
        resolveEngine: () =>
          Effect.succeed({
            modelSelection: reviewModel,
            routing: {
              instanceId: reviewModel.instanceId,
              driverKind: ProviderDriverKind.make("claudeAgent"),
              displayName: undefined,
              enabled: true,
              continuationIdentity: {
                driverKind: ProviderDriverKind.make("claudeAgent"),
                continuationKey: "claudeAgent:instance:claude-main",
              },
            },
            capabilities: { sessionModelSwitch: "in-session" },
            mode: "default",
          }),
      }),
      ServerSettingsService.layerTest({ memory: { enabled: memoryEnabled } }),
    );

    const memoriesLayer = MemoriesLive.pipe(
      Layer.provideMerge(SqlitePersistenceMemory),
      Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "otto-memory-review-test-" })),
      Layer.provide(NodeServices.layer),
    );

    const context = yield* Layer.build(
      MemoryReviewLive.pipe(Layer.provideMerge(memoriesLayer), Layer.provide(dependencies)),
    );

    const memories = Context.get(context, Memories);

    yield* Effect.yieldNow;

    const send = (next: OrchestrationMessage) =>
      Effect.gen(function* () {
        messages = [...messages, next];

        yield* PubSub.publish(events, {
          sequence: messages.length,
          eventId: EventId.make(`event-${next.id}`),
          aggregateKind: "thread",
          aggregateId: chat.id,
          occurredAt: next.createdAt,
          commandId: CommandId.make(`command-${next.id}`),
          causationEventId: null,
          correlationId: null,
          metadata: {},
          type: "thread.message-sent",
          payload: {
            threadId: chat.id,
            messageId: next.id,
            role: next.role,
            text: next.text,
            turnId: next.turnId,
            streaming: false,
            createdAt: next.createdAt,
            updatedAt: next.updatedAt,
          },
          // SAFETY: The payload is a thread.message-sent payload.
        } as OrchestrationEvent);

        yield* Effect.yieldNow;
      });

    return { reviews, send, memories };
  });

describe("MemoryReview", () => {
  it.effect(
    "reviews a shared chat into the team's memory once it has been quiet for two minutes",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { reviews, send, memories } = yield* harness();

          yield* send(
            message("m1", "user", "Please bill Lora in EUR.", "2026-10-18T10:00:00.000Z"),
          );
          yield* TestClock.adjust("90 seconds");
          yield* send(message("m2", "assistant", "Noted, EUR it is.", "2026-10-18T10:01:30.000Z"));
          yield* TestClock.adjust("90 seconds");

          expect(reviews).toHaveLength(0);

          yield* TestClock.adjust("30 seconds");

          expect(reviews).toHaveLength(1);

          expect(reviews[0]).toMatchObject({
            modelSelection: reviewModel,
            memory: "",
            learner: "team",
            project: "Lora Boutique",
            transcript: "Ana: Please bill Lora in EUR.\nJuno (assistant): Noted, EUR it is.",
          });

          const lines = yield* memories.list([TEAM_MEMORY]);

          expect(lines).toMatchObject([
            { text: "Lora invoices are in EUR.", projectId: chat.projectId, threadId: chat.id },
          ]);

          yield* send(message("m3", "user", "Thanks!", "2026-10-18T10:05:00.000Z"));
          yield* TestClock.adjust("2 minutes");

          expect(reviews).toHaveLength(2);
          expect(reviews[1]?.transcript).toBe("Ana: Thanks!");
          expect(reviews[1]?.memory).toBe(`- [${lines[0]?.id}] Lora invoices are in EUR.`);
        }),
      ),
  );

  it.effect("reviews a private chat into the person's own memory, the team's read-only", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { reviews, send, memories } = yield* harness({ privateChat: true });

        const team = yield* memories.create({
          resource: TEAM_MEMORY,
          projectId: null,
          personId: ana,
          text: "Mai runs QA.",
        });

        yield* send(message("m1", "user", "I like EUR invoices.", "2026-10-18T10:00:00.000Z"));
        yield* TestClock.adjust("2 minutes");

        expect(reviews[0]).toMatchObject({
          learner: "person",
          memory: `- [${team.id}] Mai runs QA. (read-only)`,
        });

        expect((yield* memories.list([personMemory(ana)])).map(({ text }) => text)).toEqual([
          "Lora invoices are in EUR.",
        ]);
      }),
    ),
  );

  it.effect("leaves memory alone while Memory is off", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { reviews, send, memories } = yield* harness({ memoryEnabled: false });

        yield* send(message("m1", "user", "Please bill Lora in EUR.", "2026-10-18T10:00:00.000Z"));
        yield* TestClock.adjust("3 minutes");

        expect(reviews).toHaveLength(0);
        expect(yield* memories.list([TEAM_MEMORY])).toEqual([]);
      }),
    ),
  );
});
