import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HostProcessArguments } from "@otto/shared/hostProcess";

import {
  detectCliRunner,
  formatCliCommand,
  resolveCliCommand,
  suggestedPackageSpec,
} from "./invocation.ts";

it.effect("does not recommend a registry package for the private source CLI", () =>
  Effect.gen(function* () {
    const command = yield* resolveCliCommand("serve").pipe(
      Effect.provideService(HostProcessArguments, [
        "node",
        "/home/test/.npm/_npx/fixture/node_modules/otto/dist/bin.mjs",
      ]),
    );

    assert.equal(command, "otto serve");
  }),
);

it("detects package runners from their cache entry paths", () => {
  assert.equal(detectCliRunner("/home/leo/.npm/_npx/abc123/node_modules/otto/dist/bin.mjs"), "npx");
  assert.equal(
    detectCliRunner(
      "C:\\Users\\leo\\AppData\\Local\\npm-cache\\_npx\\abc\\node_modules\\otto\\dist\\bin.mjs",
    ),
    "npx",
  );
  assert.equal(
    detectCliRunner("/home/leo/.cache/pnpm/dlx/abc/node_modules/otto/dist/bin.mjs"),
    "pnpm dlx",
  );
  assert.equal(
    detectCliRunner("/home/leo/.local/share/pnpm/.pnpm/dlx/abc/node_modules/otto/dist/bin.mjs"),
    "pnpm dlx",
  );
  assert.equal(
    detectCliRunner(
      "C:\\Users\\leo\\AppData\\Local\\pnpm-cache\\dlx\\abc\\node_modules\\otto\\dist\\bin.mjs",
    ),
    "pnpm dlx",
  );
  assert.equal(detectCliRunner("/home/leo/.bun/install/cache/otto@0.0.31/dist/bin.mjs"), "bunx");
  assert.equal(
    detectCliRunner("/tmp/bunx-1000-otto@latest/node_modules/otto/dist/bin.mjs"),
    "bunx",
  );
  assert.equal(
    detectCliRunner(
      "C:\\Users\\leo\\AppData\\Local\\Temp\\bunx-0-otto@latest\\node_modules\\otto\\dist\\bin.mjs",
    ),
    "bunx",
  );
});

it("treats stable installs as direct invocations", () => {
  assert.isNull(detectCliRunner("/usr/local/lib/node_modules/otto/dist/bin.mjs"));
  assert.isNull(detectCliRunner("/home/leo/Code/work/otto/apps/server/dist/bin.mjs"));
  assert.isNull(detectCliRunner("/home/leo/.otto/runtime/0.0.31/node_modules/otto/dist/bin.mjs"));
  assert.isNull(detectCliRunner(""));
});

it("suggests the stable package for every installed version", () => {
  assert.equal(suggestedPackageSpec("0.0.31-nightly.20260729"), "otto");
  assert.equal(suggestedPackageSpec("0.0.31"), "otto");
});

it("formats serve suggestions to match the launching command", () => {
  assert.equal(
    formatCliCommand({
      subcommand: "serve",
      entryPath: "/home/leo/.npm/_npx/abc/node_modules/otto/dist/bin.mjs",
      version: "0.0.31-nightly.20260729",
    }),
    "npx otto serve",
  );
  assert.equal(
    formatCliCommand({
      subcommand: "serve",
      entryPath: "/tmp/bunx-1000-otto@latest/node_modules/otto/dist/bin.mjs",
      version: "0.0.31",
    }),
    "bunx otto serve",
  );
  assert.equal(
    formatCliCommand({
      subcommand: "serve",
      entryPath: "/usr/local/lib/node_modules/otto/dist/bin.mjs",
      version: "0.0.31-nightly.20260729",
    }),
    "otto serve",
  );
});
