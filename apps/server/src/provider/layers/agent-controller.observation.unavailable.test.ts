import {
  DEFAULT_SERVER_SETTINGS,
  BotId,
  ProviderDriverKind,
  TurnId,
  type ServerSettings,
} from "@otto/contracts";
import { it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { assert, describe, expect } from "vite-plus/test";
import { ServerSettingsService } from "../../server-settings.ts";
import { Memories, type MemoryChat } from "../../memory/memories.ts";
import { AgentController } from "../services/agent-controller.ts";
import * as OrchestrationEngine from "../../orchestration/services/orchestration-engine.ts";
import {
  codexThreadId,
  codexInstanceId,
  codexSelection,
} from "./test-support/agent-controller-fixtures.ts";
import {
  makeBridge,
  makeLayer,
  provideController,
  resolveCodex,
} from "./test-support/agent-controller-layers.ts";
import { mastraHarnessFixture } from "./test-support/agent-controller-harness.ts";

describe("AgentControllerLive", () => {
  it.effect("rejects conversation memory calls when the harness has no memory", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();

    return provideController(
      Effect.gen(function* () {
        const controller = yield* AgentController;

        const readError = yield* controller.readConversationMemory!(codexThreadId).pipe(
          Effect.flip,
        );

        const clearError = yield* controller.clearConversationMemory!(codexThreadId).pipe(
          Effect.flip,
        );

        assert.deepInclude(readError, {
          _tag: "AgentControllerRuntimeError",
          operation: "memory.read",
        });
        assert.deepInclude(clearError, {
          _tag: "AgentControllerRuntimeError",
          operation: "memory.clear",
        });
      }),
      bridge.service,
      mastra.factory,
    );
  });
});

describe("AgentControllerLive", () => {
  it.effect("drops a Mastra admission interrupted while the memory settings read is held", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();

    const memoryChat = {
      threadId: codexThreadId,
      botId: BotId.make("bot-mastra-admit-gate"),
      groupId: null,
      groupName: "",
      projectId: null,
      projectTitle: "",
      audiencePersonId: null,
      people: [],
    } satisfies MemoryChat;

    const memorySettings: ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      memory: { ...DEFAULT_SERVER_SETTINGS.memory, enabled: true },
    };

    const sessionInput = {
      threadId: codexThreadId,
      provider: ProviderDriverKind.make("codex"),
      providerInstanceId: codexInstanceId,
      modelSelection: codexSelection,
      runtimeMode: "full-access" as const,
      botId: memoryChat.botId,
    };

    const gate = Deferred.makeUnsafe<void>();
    const reached = Deferred.makeUnsafe<void>();
    let holdNextGetSettings = false;

    const gatedSettingsLayer = Layer.succeed(ServerSettingsService, {
      start: Effect.void,
      ready: Effect.void,
      getSettings: Effect.suspend(() =>
        holdNextGetSettings
          ? Effect.sync(() => {
              Deferred.doneUnsafe(reached, Effect.void);
            }).pipe(Effect.andThen(Deferred.await(gate)), Effect.as(memorySettings))
          : Effect.succeed(memorySettings),
      ),
      updateSettings: () => Effect.die("not used"),
      streamChanges: Stream.empty,
      subscribeChanges: Effect.succeed(Stream.empty),
    });

    return Effect.gen(function* () {
      const controller = yield* AgentController;
      yield* resolveCodex(controller);
      yield* controller.startSession(codexThreadId, sessionInput);
      holdNextGetSettings = true;
      yield* controller.sendTurn({ threadId: codexThreadId, input: "Interrupt me.", memoryChat });
      yield* Deferred.await(reached);

      // Collect turn.started events for the rest of the test so we can prove
      // the cancelled admission never begins a turn.
      const startedEvents: TurnId[] = [];

      const startedFiber = yield* controller.streamEvents.pipe(
        Stream.filter((event) => event.type === "turn.started"),
        Stream.runForEach((event) =>
          Effect.sync(() => {
            if (event.turnId) startedEvents.push(event.turnId);
          }),
        ),
        Effect.forkChild({ startImmediately: true }),
      );

      yield* Effect.yieldNow;
      yield* controller.interruptTurn({ threadId: codexThreadId });

      const next = yield* controller.sendTurn({
        threadId: codexThreadId,
        input: "Replacement turn.",
        memoryChat,
      });

      // Admission of the replacement is queued behind the held settings read.
      assert.equal(mastra.sendMessage.mock.calls.length, 0);

      Deferred.doneUnsafe(gate, Effect.void);
      yield* Effect.promise(() => mastra.waitForSendMessageCount(1));
      mastra.finishSend();
      yield* Effect.yieldNow;

      // The interrupted admission must never reach sendMessage or displace the
      // replacement turn's state.
      assert.equal(mastra.sendMessage.mock.calls.length, 1);
      expect(mastra.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Replacement turn."),
        }),
      );
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(startedFiber);
      assert.deepEqual(startedEvents, [next.turnId] as TurnId[]);
    }).pipe(
      Effect.provide(
        makeLayer(
          bridge.service,
          mastra.factory,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          gatedSettingsLayer,
        ).pipe(Layer.provide(Layer.mock(Memories)({ render: () => Effect.succeed("") }))),
      ),
      Effect.orDie,
    );
  });
});

describe("AgentControllerLive", () => {
  it.effect("dispatches a thread activity when an observation is dropped", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();

    const dispatched: Array<{
      readonly type: string;
      readonly commandId?: string;
      readonly activity?: unknown;
    }> = [];

    return provideController(
      Effect.gen(function* () {
        const controller = yield* AgentController;
        yield* resolveCodex(controller);
        yield* controller.startSession(codexThreadId, {
          threadId: codexThreadId,
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: codexInstanceId,
          modelSelection: codexSelection,
          runtimeMode: "full-access",
        });
        const options = mastra.harnessOptions[0]!;
        yield* Effect.promise(() =>
          Promise.resolve(
            options.onObservationDropped!({
              observationId: "observation-dropped-row",
              threadId: String(codexThreadId),
              turnId: "turn-dropped",
              resourceId: String(codexThreadId),
              modelId: "openai/gpt-5.6-sol",
              attempts: 3,
              error: new Error("observer down"),
            }),
          ),
        );
        assert.equal(dispatched.length, 1);
        const command = dispatched[0]!;
        assert.equal(command.type, "thread.activity.append");

        const activity = command.activity as {
          readonly kind: string;
          readonly tone: string;
          readonly turnId: string;
          readonly payload: { readonly attempts: number };
        };

        assert.equal(activity.kind, "memory.observation.dropped");
        assert.equal(activity.tone, "error");
        assert.equal(activity.turnId, "turn-dropped");
        assert.equal(activity.payload.attempts, 3);
        assert.equal(command.commandId, "server:observation-dropped:observation-dropped-row");
      }),
      bridge.service,
      mastra.factory,
    ).pipe(
      Effect.provideService(
        OrchestrationEngine.OrchestrationEngineService,
        OrchestrationEngine.OrchestrationEngineService.of({
          readEvents: () => Stream.empty,
          readThreadEvents: () => Stream.empty,
          getThreadReplayStats: () => Effect.die("unused"),
          dispatch: (command) =>
            Effect.sync(() => {
              dispatched.push(command);

              return { sequence: 1 };
            }),
          streamDomainEvents: Stream.empty,
          subscribeDomainEvents: Effect.succeed(Stream.empty),
          latestSequence: Effect.succeed(0),
        }),
      ),
    );
  });
});
