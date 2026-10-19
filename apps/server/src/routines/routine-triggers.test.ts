import { assert, it } from "@effect/vitest";
import type { RoutineAppTrigger } from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import {
  ComposioService,
  type ComposioServiceShape,
  type ComposioTriggerRecord,
} from "../composio/composio-service.ts";
import { ServerConfig } from "../config.ts";
import { OrchestrationEngineService } from "../orchestration/services/orchestration-engine.ts";
import { RoutineRepository, type RoutineRepositoryShape } from "./repository.ts";
import { RoutineTriggers, RoutineTriggersLive } from "./routine-triggers.ts";
import { RoutineRuntime, type RoutineRuntimeShape } from "./runtime.ts";
import { routine } from "./test-utils/runtime-live.ts";
import { RoutineRuntimeAdapter, type Routine, type RoutineRuntimeAdapterShape } from "./types.ts";

const gmail: RoutineAppTrigger = {
  type: "app",
  app: "gmail",
  event: "GMAIL_NEW_GMAIL_MESSAGE",
  title: "New Gmail message",
  connectionId: "gmail-ana",
  config: { labelIds: ["INBOX"] },
  triggerId: null,
};

const unused = () => Effect.die("unused");

/** Routines, Composio's triggers and what the routines runtime was asked to do, all in memory. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const harness = (
  initial: ReadonlyArray<Routine>,
  composioTriggers: Array<Mutable<ComposioTriggerRecord>> = [],
  publicOrigin: string | null = "https://otto.example.com",
) => {
  let routines = [...initial];
  const log: string[] = [];

  const composio = ComposioService.of({
    isConfigured: Effect.succeed(true),
    getStatus: unused,
    searchToolkits: unused,
    getToolkit: unused,
    getAuthSetup: unused,
    createAuthConfig: unused,
    authorize: unused,
    disconnect: unused,
    updateConnection: unused,
    connectedToolkits: unused,
    resolveRuntimeMcpServer: unused,
    prepareTrigger: unused,
    checkTriggerAccount: unused,
    listTriggers: Effect.sync(() => composioTriggers.map((trigger) => ({ ...trigger }))),
    createTrigger: (trigger) =>
      Effect.sync(() => {
        const id = `trigger-${composioTriggers.length + 1}`;
        composioTriggers.push({
          id,
          connectionId: trigger.connectionId,
          event: trigger.event,
          enabled: true,
        });
        log.push(`create:${id}`);

        return id;
      }),
    setTriggerEnabled: (triggerId, enabled) =>
      Effect.sync(() => {
        const trigger = composioTriggers.find((candidate) => candidate.id === triggerId)!;
        trigger.enabled = enabled;
        log.push(`${enabled ? "enable" : "disable"}:${triggerId}`);
      }),
    deleteTrigger: (triggerId) =>
      Effect.sync(() => {
        composioTriggers.splice(
          composioTriggers.findIndex((candidate) => candidate.id === triggerId),
          1,
        );
        log.push(`delete:${triggerId}`);
      }),
    subscribeWebhook: (url) => Effect.sync(() => void log.push(`subscribe:${url}`)),
    verifyWebhook: (input) =>
      Effect.succeed(
        input.signature === "v1,good"
          ? { triggerId: JSON.parse(input.body).triggerId, data: { subject: "Invoice" } }
          : null,
      ),
  } satisfies ComposioServiceShape);

  const repository = {
    listAll: Effect.sync(() => routines),
  } satisfies Partial<RoutineRepositoryShape>;

  const runtime = {
    runEvent: (routineId, event) =>
      Effect.sync(
        () => void log.push(`run:${routineId}:${event.id}:${JSON.stringify(event.data)}`),
      ),
  } satisfies Pick<RoutineRuntimeShape, "runEvent">;

  const adapter = {
    openFailureIncident: (value, failure) =>
      Effect.sync(() => void log.push(`incident:${value.id}:${failure.reason}`)),
    resolveFailureIncident: (routineId) =>
      Effect.sync(() => void log.push(`incident-resolved:${routineId}`)),
  } satisfies Pick<RoutineRuntimeAdapterShape, "openFailureIncident" | "resolveFailureIncident">;

  const engine = OrchestrationEngineService.of({
    dispatch: (command) =>
      Effect.sync(() => {
        if (command.type !== "routine.trigger.bind") throw new Error(command.type);
        log.push(`bind:${command.routineId}:${command.triggerId}`);
        routines = routines.map((candidate) =>
          candidate.id === command.routineId && candidate.trigger?.type === "app"
            ? { ...candidate, trigger: { ...candidate.trigger, triggerId: command.triggerId } }
            : candidate,
        );

        return { sequence: 1 };
      }),
    readEvents: () => Stream.empty,
    readThreadEvents: () => Stream.empty,
    getThreadReplayStats: unused,
    streamDomainEvents: Stream.empty,
    subscribeDomainEvents: Effect.succeed(Stream.empty),
    latestSequence: Effect.succeed(0),
  });

  // The trigger service reads only the server's public address from its config.
  const config = Layer.succeed(ServerConfig, {
    publicOrigin: publicOrigin ?? undefined,
  } as ServerConfig["Service"]);

  const layer = RoutineTriggersLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(ComposioService, composio),
        Layer.succeed(RoutineRepository, repository as never),
        Layer.succeed(RoutineRuntime, runtime as never),
        Layer.succeed(RoutineRuntimeAdapter, adapter as never),
        Layer.succeed(OrchestrationEngineService, engine),
        config,
      ),
    ),
  );

  return { log, composioTriggers, routines: () => routines, layer };
};

const sync = Effect.gen(function* () {
  yield* (yield* RoutineTriggers).sync;
});

it.effect("creates an enabled app routine's trigger and records its id on the routine", () => {
  const test = harness([routine({ trigger: gmail, nextRunAt: null })]);

  return Effect.gen(function* () {
    yield* sync;
    yield* sync;

    assert.deepStrictEqual(test.log, ["create:trigger-1", "bind:routine-1:trigger-1"]);
    assert.deepStrictEqual(test.routines()[0]?.trigger, { ...gmail, triggerId: "trigger-1" });
  }).pipe(Effect.provide(test.layer));
});

it.effect("turns a paused routine's trigger off and back on when it resumes", () => {
  const bound = { ...gmail, triggerId: "trigger-1" };

  const existing = [
    { id: "trigger-1", connectionId: "gmail-ana", event: gmail.event, enabled: true },
  ];

  const paused = harness(
    [routine({ trigger: bound, enabled: false, lifecycle: "paused" })],
    existing,
  );

  const resumed = harness([routine({ trigger: bound })], existing);

  return Effect.gen(function* () {
    yield* sync.pipe(Effect.provide(paused.layer));
    yield* sync.pipe(Effect.provide(resumed.layer));

    assert.deepStrictEqual(paused.log, ["disable:trigger-1"]);
    assert.deepStrictEqual(resumed.log, ["enable:trigger-1"]);
  });
});

it.effect("replaces a trigger for another event and deletes triggers no routine uses", () => {
  const test = harness(
    [routine({ trigger: { ...gmail, event: "GMAIL_NEW_LABEL", triggerId: "trigger-1" } })],
    [
      { id: "trigger-1", connectionId: "gmail-ana", event: gmail.event, enabled: true },
      { id: "trigger-2", connectionId: "gmail-ana", event: gmail.event, enabled: true },
    ],
  );

  return Effect.gen(function* () {
    yield* sync;

    assert.deepStrictEqual(test.log, [
      "create:trigger-3",
      "bind:routine-1:trigger-3",
      "delete:trigger-1",
      "delete:trigger-2",
    ]);
  }).pipe(Effect.provide(test.layer));
});

it.effect("keeps app routines off without a public https address and says why", () => {
  const test = harness([routine({ trigger: gmail })], [], null);

  return Effect.gen(function* () {
    yield* sync;

    assert.deepStrictEqual(test.log, [
      "incident:routine-1:App events need OTTO_PUBLIC_URL set to this server's https address.",
    ]);
  }).pipe(Effect.provide(test.layer));
});

it.effect("points Composio at the webhook on start", () => {
  const test = harness([]);

  return Effect.scoped(
    Effect.gen(function* () {
      yield* (yield* RoutineTriggers).start;
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;

      assert.deepStrictEqual(test.log, ["subscribe:https://otto.example.com/webhooks/composio"]);
    }),
  ).pipe(Effect.provide(test.layer));
});

const delivery = (triggerId: string, signature = "v1,good") =>
  new Request("https://otto.example.com/webhooks/composio", {
    method: "POST",
    headers: {
      "webhook-id": "msg_1",
      "webhook-timestamp": "1760000000",
      "webhook-signature": signature,
    },
    body: JSON.stringify({ triggerId }),
  });

it.effect("runs the routine an app event is for, keyed by the delivery id", () => {
  const test = harness([
    routine({ trigger: { ...gmail, triggerId: "trigger-1" } }),
    routine({
      id: "routine-2" as Routine["id"],
      trigger: { ...gmail, triggerId: "trigger-2" },
      enabled: false,
      lifecycle: "paused",
    }),
  ]);

  return Effect.gen(function* () {
    const triggers = yield* RoutineTriggers;

    const forged = yield* triggers.receive(delivery("trigger-1", "v1,forged"));

    const unsigned = yield* triggers.receive(
      new Request("https://otto.example.com/webhooks/composio", { method: "POST", body: "{}" }),
    );

    const unknown = yield* triggers.receive(delivery("trigger-9"));
    const paused = yield* triggers.receive(delivery("trigger-2"));
    const live = yield* triggers.receive(delivery("trigger-1"));

    assert.deepStrictEqual(
      [forged.status, unsigned.status, unknown.status, paused.status, live.status],
      [401, 401, 200, 200, 200],
    );
    assert.deepStrictEqual(test.log, ['run:routine-1:msg_1:{"subject":"Invoice"}']);
  }).pipe(Effect.provide(test.layer));
});
