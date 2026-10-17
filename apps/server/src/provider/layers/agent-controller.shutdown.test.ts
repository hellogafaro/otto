import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { describe, expect } from "vite-plus/test";
import { type AgentControllerLiveOptions } from "./agent-controller.ts";
import { makeBridge, makeLayer } from "./test-support/agent-controller-layers.ts";
import { mastraHarnessFixture } from "./test-support/agent-controller-harness.ts";

describe("AgentControllerLive", () => {
  it.effect("waits for the Mastra harness to shut down before closing the controller scope", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();
    const destroyStarted = Promise.withResolvers<void>();
    const destroyReleased = Promise.withResolvers<void>();

    const factory: NonNullable<AgentControllerLiveOptions["makeMastraHarness"]> = (options) =>
      Effect.acquireRelease(mastra.factory(options), () =>
        Effect.promise(async () => {
          destroyStarted.resolve();
          await destroyReleased.promise;
        }),
      );

    return Effect.gen(function* () {
      const scope = yield* Scope.make("sequential");
      yield* Layer.buildWithScope(makeLayer(bridge.service, factory), scope);
      let scopeClosed = false;

      const closeScope = yield* Scope.close(scope, Exit.void).pipe(
        Effect.tap(() => Effect.sync(() => (scopeClosed = true))),
        Effect.forkScoped,
      );

      yield* Effect.promise(() => destroyStarted.promise);
      yield* Effect.yieldNow;
      expect(scopeClosed).toBe(false);

      destroyReleased.resolve();
      yield* Fiber.join(closeScope);
      expect(scopeClosed).toBe(true);
    });
  });
});
