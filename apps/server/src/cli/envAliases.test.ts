import { describe, expect, it } from "@effect/vitest";
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { aliasedEnv, readAliasedEnv } from "./envAliases.ts";

const readPort = (env: Record<string, string>) =>
  aliasedEnv(Config.port, "PORT")
    .parse(ConfigProvider.fromEnv({ env }))
    .pipe(Effect.map(Option.getOrUndefined));

describe("aliasedEnv", () => {
  it.effect("reads the OTTO_ name", () =>
    Effect.gen(function* () {
      expect(yield* readPort({ OTTO_PORT: "4100" })).toBe(4100);
    }),
  );

  it.effect("falls back to the legacy OTTO_LEGACY_ name", () =>
    Effect.gen(function* () {
      expect(yield* readPort({ OTTO_LEGACY_PORT: "4200" })).toBe(4200);
    }),
  );

  it.effect("prefers the OTTO_ name when both are set", () =>
    Effect.gen(function* () {
      expect(yield* readPort({ OTTO_PORT: "4100", OTTO_LEGACY_PORT: "4200" })).toBe(4100);
    }),
  );

  it.effect("reports a missing value as none", () =>
    Effect.gen(function* () {
      expect(yield* readPort({})).toBeUndefined();
    }),
  );
});

describe("readAliasedEnv", () => {
  it("prefers OTTO_ and falls back to OTTO_LEGACY_", () => {
    expect(readAliasedEnv({ OTTO_HOME: "/a", OTTO_LEGACY_HOME: "/b" }, "HOME")).toBe("/a");
    expect(readAliasedEnv({ OTTO_LEGACY_HOME: "/b" }, "HOME")).toBe("/b");
    expect(readAliasedEnv({ OTTO_HOME: "  ", OTTO_LEGACY_HOME: "/b" }, "HOME")).toBe("/b");
    expect(readAliasedEnv({}, "HOME")).toBeUndefined();
  });
});
