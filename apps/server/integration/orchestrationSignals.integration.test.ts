import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import {
  withHarness,
  seedProjectAndThread,
  runtimeBase,
  THREAD_ID,
  FIXTURE_TURN_ID,
  startTurn,
  observeAfterProviderDrain,
} from "./test-support/OrchestrationScenario.ts";

it.live("adds a message sent while the bot works to its running turn", () =>
  withHarness((harness) =>
    Effect.gen(function* () {
      yield* seedProjectAndThread(harness);
      const keepWorking = yield* Deferred.make<void>();

      yield* harness.adapterHarness!.queueTurnResponseForNextSession({
        events: [
          {
            type: "turn.started",
            ...runtimeBase("evt-signal-1", "2026-02-24T10:03:00.000Z"),
            threadId: THREAD_ID,
            turnId: FIXTURE_TURN_ID,
          },
          {
            type: "message.delta",
            ...runtimeBase("evt-signal-2", "2026-02-24T10:03:00.100Z"),
            threadId: THREAD_ID,
            turnId: FIXTURE_TURN_ID,
            delta: "Okay, I will wait.",
          },
        ],
        mutateWorkspace: () => Deferred.await(keepWorking),
      });

      yield* startTurn({
        harness,
        commandId: "cmd-turn-start-plan",
        messageId: "msg-user-plan",
        text: "Plan a trip to Barcelona",
      });

      const running = yield* harness.waitForThread(
        THREAD_ID,
        (entry) => entry.session?.status === "running" && entry.session.activeTurnId !== null,
      );

      yield* startTurn({
        harness,
        commandId: "cmd-turn-start-wait",
        messageId: "msg-user-wait",
        text: "Wait a minute",
      });

      const signals = yield* observeAfterProviderDrain(
        harness,
        () => harness.mastraHarness!.getSignals(THREAD_ID),
        (entries) => entries.length === 1,
        "the running turn received the message as a signal",
      );

      assert.deepEqual(signals[0], { type: "user", contents: "Wait a minute" });

      const stillRunning = yield* harness.waitForThread(THREAD_ID, (entry) =>
        entry.messages.some((message) => message.id === "msg-user-wait"),
      );

      assert.equal(stillRunning.session?.status, "running");
      assert.equal(stillRunning.session?.activeTurnId, running.session?.activeTurnId);

      yield* Deferred.succeed(keepWorking, undefined);

      const settled = yield* harness.waitForThread(
        THREAD_ID,
        (entry) => entry.session?.status === "ready" && entry.latestTurn?.state === "completed",
      );

      assert.equal(settled.latestTurn?.turnId, running.session?.activeTurnId);
      assert.deepEqual(
        settled.messages.filter((message) => message.role === "user").map((message) => message.id),
        ["msg-user-plan", "msg-user-wait"],
      );
      assert.equal(settled.messages.filter((message) => message.role === "assistant").length, 1);
      assert.equal(harness.mastraHarness!.getStartCount(), 1);
    }),
  ),
);
