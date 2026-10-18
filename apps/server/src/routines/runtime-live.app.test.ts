import { assert, it } from "@effect/vitest";
import { RoutineRunId } from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";

import { harness, routine } from "./test-utils/runtime-live.ts";
import { RoutineRuntime } from "./runtime.ts";

const gmail = {
  type: "app" as const,
  app: "gmail",
  event: "GMAIL_NEW_GMAIL_MESSAGE",
  title: "New Gmail message",
  connectionId: "connection-1",
  config: {},
  triggerId: "trigger-1",
};

const appRoutine = (overrides: Parameters<typeof routine>[0] = {}) =>
  routine({ trigger: gmail, nextRunAt: null, ...overrides });

const event = { id: "msg_1", data: { subject: "Invoice" } };

it.effect("runs an app routine once per app event, however often Composio retries it", () => {
  const test = harness(appRoutine());

  return Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-08-31T20:00:00.000Z"));
    const runtime = yield* RoutineRuntime;

    yield* runtime.runEvent(appRoutine().id, event);
    yield* runtime.runEvent(appRoutine().id, event);

    assert.deepStrictEqual(test.events, ["claimed:app:null", "queued", "turn:msg_1", "dispatched"]);
  }).pipe(Effect.provide(test.layer));
});

it.effect("ignores app events for a paused or scheduled routine", () => {
  const paused = harness(appRoutine({ enabled: false, lifecycle: "paused" }));
  const scheduled = harness(routine());

  return Effect.gen(function* () {
    yield* Effect.gen(function* () {
      yield* (yield* RoutineRuntime).runEvent(appRoutine().id, event);
    }).pipe(Effect.provide(paused.layer));
    yield* Effect.gen(function* () {
      yield* (yield* RoutineRuntime).runEvent(routine().id, event);
    }).pipe(Effect.provide(scheduled.layer));

    assert.deepStrictEqual(paused.events, []);
    assert.deepStrictEqual(scheduled.events, []);
  });
});

it.effect("leaves an app event for a busy chat claimed, without starting it", () => {
  const test = harness(appRoutine(), [], null, true);

  return Effect.gen(function* () {
    yield* (yield* RoutineRuntime).runEvent(appRoutine().id, event);

    assert.deepStrictEqual(test.events, ["claimed:app:null"]);
  }).pipe(Effect.provide(test.layer));
});

const waiting = {
  runId: RoutineRunId.make("routine:routine-1:app:msg_1"),
  routineId: appRoutine().id,
  trigger: "app" as const,
  scheduledFor: null,
  claimedAt: "2026-08-31T20:00:00.000Z",
  status: "claimed" as const,
  event,
};

it.effect("starts a waiting app event with its data once the chat is free", () => {
  const test = harness(appRoutine(), [waiting], null, false, undefined, "queued");

  return Effect.gen(function* () {
    yield* (yield* RoutineRuntime).recover;

    assert.deepStrictEqual(test.events, ["queued", "turn:msg_1", "dispatched"]);
  }).pipe(Effect.provide(test.layer));
});

it.effect("keeps a waiting app event while the chat stays busy", () => {
  const test = harness(appRoutine(), [waiting], null, true, undefined, "queued");

  return Effect.gen(function* () {
    yield* (yield* RoutineRuntime).recover;

    assert.deepStrictEqual(test.events, []);
  }).pipe(Effect.provide(test.layer));
});

it.effect("drops a waiting app event once its routine is paused", () => {
  const test = harness(
    appRoutine({ enabled: false, lifecycle: "paused" }),
    [waiting],
    null,
    false,
    undefined,
    "queued",
  );

  return Effect.gen(function* () {
    yield* (yield* RoutineRuntime).recover;

    assert.deepStrictEqual(test.events, ["claim-settled"]);
    assert.deepStrictEqual(test.settledStatuses, ["canceled"]);
  }).pipe(Effect.provide(test.layer));
});
