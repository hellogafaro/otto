import { toolRuntimeFixture } from "./tool-runtime-fixture.ts";
import * as NodePath from "node:path";
import { AuthStorage } from "@mastra/code-sdk/auth/storage";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FiberSet from "effect/FiberSet";
import * as Scope from "effect/Scope";
import {
  makeOttoMastraHarness,
  type OttoMastraHarness,
  type OttoMastraHarnessOptions,
} from "../otto-mastra-harness.ts";

export type OpenHarness = (
  options: OttoMastraHarnessOptions,
) => Promise<OttoMastraHarness & { readonly close: () => Promise<void> }>;

export function makeOttoMastraHarnessTestSupport() {
  // Runs an async test body in the Effect test scope. `open` gives each harness a
  // child scope that `close` closes once; the test scope closes any left open.
  const harnessTest = (body: (open: OpenHarness) => Promise<void>) =>
    Effect.gen(function* () {
      const testScope = yield* Effect.scope;
      const run = yield* FiberSet.makeRuntimePromise();

      const open: OpenHarness = async (options) => {
        const scope = await run(Scope.fork(testScope));
        const harness = await run(makeOttoMastraHarness(options).pipe(Scope.provide(scope)));
        let closing: Promise<void> | undefined;

        return { ...harness, close: () => (closing ??= run(Scope.close(scope, Exit.void))) };
      };

      yield* Effect.promise(() => body(open));
    });

  const makeHarness = (
    open: OpenHarness,
    directory: string,
    options: Partial<OttoMastraHarnessOptions> = {},
  ) =>
    open({
      authStorage: new AuthStorage(NodePath.join(directory, "auth.json")),
      memoryDbPath: NodePath.join(directory, "messages.sqlite"),
      getThreadTools: () => ({}),
      toolRuntime: toolRuntimeFixture({ toolsForThread: () => [] }),
      ...options,
    });

  return { harnessTest, makeHarness };
}
