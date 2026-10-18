import * as NodeCrypto from "node:crypto";

import { CommandId, type OrchestrationEvent, type RoutineAppTrigger } from "@otto/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { readBoundedWebhookBody, WEBHOOK_TOO_LARGE } from "../channels/channel-webhooks.ts";
import { ComposioService } from "../composio/composio-service.ts";
import { ServerConfig } from "../config.ts";
import { OrchestrationEngineService } from "../orchestration/services/orchestration-engine.ts";
import { RoutineRepository } from "./repository.ts";
import { RoutineRuntime } from "./runtime.ts";
import { RoutineRuntimeAdapter, type Routine } from "./types.ts";

/** Where Composio delivers app events for this server. */
export const COMPOSIO_WEBHOOK_PATH = "/webhooks/composio";

/** Routine changes that can change which app triggers should exist or be on. */
const TRIGGER_EVENTS = new Set<OrchestrationEvent["type"]>([
  "routine.approved",
  "routine.drafted",
  "routine.enabled",
  "routine.paused",
  "routine.updated",
  "routine.deleted",
]);

export interface RoutineTriggersShape {
  /** Points Composio at this server, brings app triggers in line with routines, and follows changes. */
  readonly start: Effect.Effect<void, never, Scope.Scope>;
  /**
   * Makes Composio's triggers match the routines: an enabled app routine's trigger exists and is
   * on, a paused one's is off, and a trigger no routine uses is deleted.
   */
  readonly sync: Effect.Effect<void, never>;
  /** Answers one Composio webhook delivery. */
  readonly receive: (request: Request) => Effect.Effect<Response, never>;
}

export class RoutineTriggers extends Context.Service<RoutineTriggers, RoutineTriggersShape>()(
  "@otto/server/routines/routine-triggers/RoutineTriggers",
) {}

const appTrigger = (routine: Routine): RoutineAppTrigger | undefined =>
  routine.lifecycle !== "deleted" && routine.trigger?.type === "app" ? routine.trigger : undefined;

const make = Effect.gen(function* () {
  const composio = yield* ComposioService;
  const repository = yield* RoutineRepository;
  const runtime = yield* RoutineRuntime;
  const adapter = yield* RoutineRuntimeAdapter;
  const engine = yield* OrchestrationEngineService;
  const config = yield* ServerConfig;
  const lock = yield* Semaphore.make(1);

  // Otto: Composio only delivers to a public https address, so without one no app routine is live.
  const webhookUrl = config.publicOrigin?.startsWith("https://")
    ? `${config.publicOrigin}${COMPOSIO_WEBHOOK_PATH}`
    : undefined;

  /** Routines whose trigger setup failed, so a later success clears their inbox item. */
  const failing = new Set<string>();

  const bind = (routine: Routine, triggerId: string | null) =>
    DateTime.now.pipe(
      Effect.flatMap((now) =>
        engine.dispatch({
          type: "routine.trigger.bind",
          commandId: CommandId.make(`server:routine.trigger.bind:${NodeCrypto.randomUUID()}`),
          routineId: routine.id,
          triggerId,
          createdAt: DateTime.formatIso(now),
        }),
      ),
    );

  const syncOnce = Effect.gen(function* () {
    if (!(yield* composio.isConfigured.pipe(Effect.orElseSucceed(() => false)))) return;
    const routines = (yield* repository.listAll).filter((routine) => appTrigger(routine));

    const existing = yield* composio.listTriggers;
    const byId = new Map(existing.map((trigger) => [trigger.id, trigger]));
    const kept = new Set<string>();

    for (const routine of routines) {
      const trigger = appTrigger(routine)!;
      const current = trigger.triggerId === null ? undefined : byId.get(trigger.triggerId);

      const same =
        current !== undefined &&
        current.event === trigger.event &&
        current.connectionId === trigger.connectionId
          ? current
          : undefined;

      if (same !== undefined) kept.add(same.id);

      const result = yield* Effect.gen(function* () {
        // A paused routine keeps its trigger, off, so resuming it is quick.
        if (!routine.enabled) {
          if (same?.enabled) yield* composio.setTriggerEnabled(same.id, false);

          return;
        }

        if (webhookUrl === undefined) {
          if (trigger.triggerId !== null) yield* bind(routine, null);

          return yield* Effect.fail({
            message: "App events need OTTO_PUBLIC_URL set to this server's https address.",
          });
        }

        if (same !== undefined) {
          if (!same.enabled) yield* composio.setTriggerEnabled(same.id, true);

          return;
        }

        const triggerId = yield* composio.createTrigger(trigger);
        kept.add(triggerId);

        if (triggerId !== trigger.triggerId) yield* bind(routine, triggerId);
      }).pipe(Effect.result);

      if (Predicate.isTagged(result, "Success")) {
        if (failing.delete(routine.id)) yield* adapter.resolveFailureIncident(routine.id);
        continue;
      }

      failing.add(routine.id);
      yield* adapter.openFailureIncident(routine, {
        kind: "connector",
        reason: result.failure.message,
        nextAction: "Fix the app account or server setup, then pause and resume the routine.",
      });
    }

    for (const trigger of existing) {
      if (kept.has(trigger.id)) continue;
      yield* composio
        .deleteTrigger(trigger.id)
        .pipe(
          Effect.catch((cause) =>
            Effect.logWarning("could not delete an unused app trigger", { cause }),
          ),
        );
    }
  });

  const sync: RoutineTriggersShape["sync"] = lock
    .withPermits(1)(syncOnce)
    .pipe(Effect.catchCause((cause) => Effect.logError("app trigger sync failed", { cause })));

  const start: RoutineTriggersShape["start"] = Effect.gen(function* () {
    const subscribe =
      webhookUrl === undefined
        ? Effect.void
        : composio.isConfigured.pipe(
            Effect.flatMap((configured) =>
              configured ? composio.subscribeWebhook(webhookUrl) : Effect.void,
            ),
            Effect.catch((cause) =>
              Effect.logWarning("could not point Composio at this server", { cause }),
            ),
          );

    yield* Effect.forkScoped(subscribe.pipe(Effect.andThen(sync)));
    yield* Effect.forkScoped(
      engine.streamDomainEvents.pipe(
        Stream.filter((event) => TRIGGER_EVENTS.has(event.type)),
        Stream.runForEach(() => sync),
      ),
    );
  });

  const respond = (status: number, body: string) => new Response(body, { status });

  // Otto: A bad signature is refused; an event for no live routine is taken and dropped, so
  // Composio does not retry it; only an internal failure asks Composio to retry.
  const receive: RoutineTriggersShape["receive"] = (request) =>
    Effect.gen(function* () {
      const body = yield* Effect.promise(() => readBoundedWebhookBody(request));

      if (body === WEBHOOK_TOO_LARGE) return respond(413, "Payload Too Large");
      const id = request.headers.get("webhook-id");
      const timestamp = request.headers.get("webhook-timestamp");
      const signature = request.headers.get("webhook-signature");

      if (!id || !timestamp || !signature) return respond(401, "Unauthorized");

      const delivery = yield* composio.verifyWebhook({
        id,
        timestamp,
        signature,
        body: body.toString("utf8"),
      });

      if (delivery === null) return respond(401, "Unauthorized");

      const routine = (yield* repository.listAll).find(
        (candidate) => appTrigger(candidate)?.triggerId === delivery.triggerId,
      );

      if (routine === undefined || !routine.enabled) return respond(200, "Ignored");
      yield* runtime.runEvent(routine.id, { id, data: delivery.data });

      return respond(200, "OK");
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("app event webhook failed", { cause }).pipe(
          Effect.as(respond(500, "Webhook processing failed")),
        ),
      ),
    );

  return { start, sync, receive } satisfies RoutineTriggersShape;
});

export const RoutineTriggersLive = Layer.effect(RoutineTriggers, make);

/** Serves Composio's app event webhook for the routines in the router's context. */
export const composioWebhookRouteLayer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const triggers = yield* Effect.serviceOption(RoutineTriggers);

    const handler = Effect.gen(function* () {
      if (Option.isNone(triggers)) return HttpServerResponse.text("Not Found", { status: 404 });
      const request = yield* HttpServerRequest.HttpServerRequest;
      const webRequest = yield* HttpServerRequest.toWeb(request).pipe(Effect.option);

      if (Option.isNone(webRequest)) return HttpServerResponse.text("Bad Request", { status: 400 });

      return HttpServerResponse.fromWeb(yield* triggers.value.receive(webRequest.value));
    });

    yield* router.add("POST", COMPOSIO_WEBHOOK_PATH, handler);
  }),
);
