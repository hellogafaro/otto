import { EnvironmentRegistry } from "@otto/client-runtime/connection";
import { request } from "@otto/client-runtime/rpc";
import {
  type BackgroundScope,
  type ClientActivityReportInput,
  EnvironmentId,
  WS_METHODS,
} from "@otto/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { randomUUID } from "./utils";

const CLIENT_ID_STORAGE_KEY = "ottoLegacy.backgroundActivity.clientId";

const REPORT_INTERVAL_MS = 25_000;

const LEASE_TTL_MS = 45_000;

const RECENT_INTERACTION_WINDOW_MS = LEASE_TTL_MS;

const BASELINE_SCOPES: ReadonlyArray<BackgroundScope> = [{ type: "provider-status" }];

function getClientId(): string {
  try {
    const existing = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY);

    if (existing) return existing;
    const next = randomUUID();
    window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, next);

    return next;
  } catch {
    return "ephemeral-browser-client";
  }
}

function resolveClientKind(): ClientActivityReportInput["clientKind"] {
  return window.desktopBridge ? "desktop-renderer" : "web";
}

export function wasRecentlyInteracted(lastInteractionAtMs: number, observedAtMs: number): boolean {
  return (
    lastInteractionAtMs <= observedAtMs &&
    observedAtMs - lastInteractionAtMs <= RECENT_INTERACTION_WINDOW_MS
  );
}

function createActivityReport(
  environmentId: EnvironmentId,
  lastInteractionAtMs: number,
  observedAtMs: number,
): ClientActivityReportInput {
  return {
    environmentId,
    clientId: getClientId(),
    clientKind: resolveClientKind(),
    visible: document.visibilityState === "visible",
    focused: document.hasFocus(),
    recentlyInteracted: wasRecentlyInteracted(lastInteractionAtMs, observedAtMs),
    appState: document.visibilityState === "visible" ? "active" : "background",
    scopes: BASELINE_SCOPES,
    ttlMs: LEASE_TTL_MS,
    observedAt: DateTime.makeUnsafe(observedAtMs),
  };
}

export const backgroundActivityReporterLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const registry = yield* EnvironmentRegistry;
    const clock = yield* Clock.Clock;
    const reportRequests = yield* Queue.sliding<void>(1);
    const requestReport = () => Queue.offerUnsafe(reportRequests, undefined);
    let lastInteractionAtMs = clock.currentTimeMillisUnsafe();

    const recordInteraction = () => {
      const observedAtMs = clock.currentTimeMillisUnsafe();
      const wasRecent = wasRecentlyInteracted(lastInteractionAtMs, observedAtMs);
      lastInteractionAtMs = observedAtMs;

      if (!wasRecent) {
        requestReport();
      }
    };

    const passiveListenerOptions = { passive: true } as const;

    const report = Effect.gen(function* () {
      const observedAtMs = yield* Clock.currentTimeMillis;
      const entries = yield* SubscriptionRef.get(registry.entries);
      yield* Effect.forEach(
        entries.keys(),
        (environmentId) =>
          registry
            .run(
              environmentId,
              request(
                WS_METHODS.serverReportClientActivity,
                createActivityReport(environmentId, lastInteractionAtMs, observedAtMs),
              ),
            )
            .pipe(Effect.ignore),
        { concurrency: "unbounded", discard: true },
      );
    }).pipe(Effect.withSpan("web.backgroundActivity.report"));

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        document.addEventListener("visibilitychange", requestReport);
        window.addEventListener("focus", requestReport);
        window.addEventListener("blur", requestReport);
        window.addEventListener("online", requestReport);
        window.addEventListener("pointermove", recordInteraction);
        window.addEventListener("keydown", recordInteraction);
        window.addEventListener("wheel", recordInteraction, passiveListenerOptions);
        window.addEventListener("touchstart", recordInteraction, passiveListenerOptions);
      }),
      () =>
        Effect.sync(() => {
          document.removeEventListener("visibilitychange", requestReport);
          window.removeEventListener("focus", requestReport);
          window.removeEventListener("blur", requestReport);
          window.removeEventListener("online", requestReport);
          window.removeEventListener("pointermove", recordInteraction);
          window.removeEventListener("keydown", recordInteraction);
          window.removeEventListener("wheel", recordInteraction);
          window.removeEventListener("touchstart", recordInteraction);
        }),
    );

    yield* SubscriptionRef.changes(registry.entries).pipe(
      Stream.runForEach(() => Effect.sync(requestReport)),
      Effect.forkScoped,
    );
    yield* Stream.fromQueue(reportRequests).pipe(
      Stream.debounce("250 millis"),
      Stream.runForEach(() => report),
      Effect.forkScoped,
    );
    yield* Effect.sync(requestReport).pipe(
      Effect.repeat(Schedule.spaced(`${REPORT_INTERVAL_MS} millis`)),
      Effect.forkScoped,
    );
  }),
);
