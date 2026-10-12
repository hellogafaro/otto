import * as NodeOS from "node:os";
import * as Path from "effect/Path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { assert } from "vite-plus/test";

import { hydratePosixHome, resolveBaseDir } from "./os-jank.ts";

it("hydrates HOME for minimal service environments from the user account", () => {
  const env: NodeJS.ProcessEnv = {};

  hydratePosixHome(env);

  assert.equal(env.HOME, NodeOS.userInfo().homedir);
});

it("hydrates HOME independently of a blank process HOME", () => {
  const originalHome = process.env.HOME;
  const env: NodeJS.ProcessEnv = { HOME: " " };

  try {
    process.env.HOME = " ";
    hydratePosixHome(env);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }

  assert.equal(env.HOME, NodeOS.userInfo().homedir);
});

it("preserves an explicitly configured HOME", () => {
  const env: NodeJS.ProcessEnv = { HOME: "/custom/home" };

  hydratePosixHome(env, () => {
    throw new Error("HOME lookup should not run");
  });

  assert.equal(env.HOME, "/custom/home");
});

it.effect("defaults the product home to ~/.otto instead of Otto Legacy's ~/.ottoLegacy", () =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const baseDir = yield* resolveBaseDir(undefined);
    assert.equal(baseDir, path.join(NodeOS.homedir(), ".otto"));
  }).pipe(Effect.provide(NodeServices.layer)),
);
