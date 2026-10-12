import * as NodeServices from "@effect/platform-node/NodeServices";

import { assert, describe, it } from "@effect/vitest";

import * as Effect from "effect/Effect";

import * as Path from "effect/Path";

import { createDevRunnerEnv, getDevRunnerModeArgs, resolveOffset } from "./dev-runner.ts";

it.layer(NodeServices.layer)("dev-runner", (it) => {
  describe("getDevRunnerModeArgs", () => {
    it.effect("lets Vite+ honor the desktop dev task graph", () =>
      Effect.sync(() => {
        assert.deepStrictEqual(getDevRunnerModeArgs("dev:desktop"), [
          "run",
          "--filter=@otto/desktop",
          "--filter=@otto/web",
          "dev",
        ]);
      }),
    );

    it.effect("places Vite+ run flags before the task name", () =>
      Effect.sync(() => {
        assert.deepStrictEqual(getDevRunnerModeArgs("dev"), [
          "run",
          "--filter=@otto/contracts",
          "--filter=@otto/web",
          "--filter=@otto/server",
          "--parallel",
          "dev",
        ]);
      }),
    );
  });

  describe("resolveOffset", () => {
    it.effect("uses explicit OTTO_LEGACY_PORT_OFFSET when provided", () =>
      Effect.gen(function* () {
        const result = yield* resolveOffset({ portOffset: 12, devInstance: undefined });
        assert.deepStrictEqual(result, {
          offset: 12,
          source: "OTTO_LEGACY_PORT_OFFSET=12",
        });
      }),
    );

    it.effect("hashes non-numeric instance values", () =>
      Effect.gen(function* () {
        const result = yield* resolveOffset({
          portOffset: undefined,
          devInstance: "feature-branch",
        });

        assert.ok(result.offset >= 1);
        assert.ok(result.offset <= 3000);
      }),
    );

    it.effect("returns structured context for a negative port offset", () =>
      Effect.gen(function* () {
        const error = yield* resolveOffset({ portOffset: -1, devInstance: undefined }).pipe(
          Effect.flip,
        );

        assert.equal(error._tag, "DevRunnerInvalidPortOffsetError");
        assert.equal(error.configKey, "OTTO_LEGACY_PORT_OFFSET");
        assert.equal(error.portOffset, -1);
        assert.equal(error.minimum, 0);
        assert.ok(!("cause" in error));
      }),
    );
  });

  describe("createDevRunnerEnv", () => {
    it.effect("leaves the shared home implicit and disables browser auto-open", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev",
          baseEnv: {},
          serverOffset: 0,
          webOffset: 0,
          ottoLegacyHome: undefined,
          browser: undefined,
          autoBootstrapProjectFromCwd: undefined,
          logWebSocketEvents: undefined,
          host: undefined,
          port: undefined,
          devUrl: undefined,
        });

        assert.equal(env.OTTO_LEGACY_HOME, undefined);
        assert.equal(env.OTTO_LEGACY_NO_BROWSER, "1");
      }),
    );

    it.effect("allows browser auto-open to be explicitly enabled", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev",
          baseEnv: {},
          serverOffset: 0,
          webOffset: 0,
          ottoLegacyHome: undefined,
          browser: true,
          autoBootstrapProjectFromCwd: undefined,
          logWebSocketEvents: undefined,
          host: undefined,
          port: undefined,
          devUrl: undefined,
        });

        assert.equal(env.OTTO_LEGACY_NO_BROWSER, "0");
      }),
    );

    it.effect("requires the browser flag even when the environment enables auto-open", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev",
          baseEnv: { OTTO_LEGACY_NO_BROWSER: "0" },
          serverOffset: 0,
          webOffset: 0,
          ottoLegacyHome: undefined,
          browser: false,
          autoBootstrapProjectFromCwd: undefined,
          logWebSocketEvents: undefined,
          host: undefined,
          port: undefined,
          devUrl: undefined,
        });

        assert.equal(env.OTTO_LEGACY_NO_BROWSER, "1");
      }),
    );

    it.effect("supports explicit typed overrides", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;

        const env = yield* createDevRunnerEnv({
          mode: "dev:server",
          baseEnv: {},
          serverOffset: 0,
          webOffset: 0,
          ottoLegacyHome: "/tmp/custom-ottoLegacy",
          browser: false,
          autoBootstrapProjectFromCwd: false,
          logWebSocketEvents: true,
          host: "0.0.0.0",
          port: 4222,
          devUrl: new URL("http://localhost:7331"),
        });

        assert.equal(env.OTTO_LEGACY_HOME, path.resolve("/tmp/custom-ottoLegacy"));
        assert.equal(env.OTTO_LEGACY_PORT, "4222");
        assert.equal(env.VITE_HTTP_URL, "http://localhost:4222");
        assert.equal(env.VITE_WS_URL, "ws://localhost:4222");
        assert.equal(env.OTTO_LEGACY_NO_BROWSER, "1");
        assert.equal(env.OTTO_LEGACY_AUTO_BOOTSTRAP_PROJECT_FROM_CWD, "0");
        assert.equal(env.OTTO_LEGACY_LOG_WS_EVENTS, "1");
        assert.equal(env.OTTO_LEGACY_HOST, "0.0.0.0");
        assert.equal(env.VITE_DEV_SERVER_URL, "http://localhost:7331/");
      }),
    );

    it.effect("strips inherited service-launcher context", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev",
          baseEnv: {
            OTTO_LEGACY_SERVICE_LAUNCHER_CONTEXT: '{"childVersion":"9.9.9"}',
            OTTO_LEGACY_BOOT_SERVICE_UNIT: "ottoLegacy.service",
          },
          serverOffset: 0,
          webOffset: 0,
          ottoLegacyHome: undefined,
          browser: undefined,
          autoBootstrapProjectFromCwd: undefined,
          logWebSocketEvents: undefined,
          host: undefined,
          port: undefined,
          devUrl: undefined,
        });

        assert.equal(env.OTTO_LEGACY_SERVICE_LAUNCHER_CONTEXT, undefined);
        assert.equal(env.OTTO_LEGACY_BOOT_SERVICE_UNIT, undefined);
      }),
    );

    it.effect("does not force websocket logging on in dev mode when unset", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev",
          baseEnv: {
            OTTO_LEGACY_LOG_WS_EVENTS: "keep-me-out",
          },
          serverOffset: 0,
          webOffset: 0,
          ottoLegacyHome: undefined,
          browser: undefined,
          autoBootstrapProjectFromCwd: undefined,
          logWebSocketEvents: undefined,
          host: undefined,
          port: undefined,
          devUrl: undefined,
        });

        assert.equal(env.OTTO_LEGACY_MODE, "web");
        assert.equal(env.OTTO_LEGACY_LOG_WS_EVENTS, undefined);
      }),
    );

    it.effect("forwards explicit websocket logging false without coercing it away", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev",
          baseEnv: {
            OTTO_LEGACY_LOG_WS_EVENTS: "1",
          },
          serverOffset: 0,
          webOffset: 0,
          ottoLegacyHome: undefined,
          browser: undefined,
          autoBootstrapProjectFromCwd: undefined,
          logWebSocketEvents: false,
          host: undefined,
          port: undefined,
          devUrl: undefined,
        });

        assert.equal(env.OTTO_LEGACY_LOG_WS_EVENTS, "0");
      }),
    );

    it.effect("uses custom ottoLegacyHome when provided", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;

        const env = yield* createDevRunnerEnv({
          mode: "dev",
          baseEnv: {},
          serverOffset: 0,
          webOffset: 0,
          ottoLegacyHome: "/tmp/my-ottoLegacy",
          browser: undefined,
          autoBootstrapProjectFromCwd: undefined,
          logWebSocketEvents: undefined,
          host: undefined,
          port: undefined,
          devUrl: undefined,
        });

        assert.equal(env.OTTO_LEGACY_HOME, path.resolve("/tmp/my-ottoLegacy"));
      }),
    );

    it.effect("pins desktop dev to a stable backend port and websocket url", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;

        const env = yield* createDevRunnerEnv({
          mode: "dev:desktop",
          baseEnv: {
            OTTO_LEGACY_PORT: "13773",
            OTTO_LEGACY_MODE: "web",
            OTTO_LEGACY_NO_BROWSER: "0",
            OTTO_LEGACY_HOST: "0.0.0.0",
            VITE_DEV_SERVER_URL: "http://127.0.0.1:8526",
            VITE_WS_URL: "ws://localhost:13773",
          },
          serverOffset: 0,
          webOffset: 0,
          ottoLegacyHome: "/tmp/my-ottoLegacy",
          browser: true,
          autoBootstrapProjectFromCwd: undefined,
          logWebSocketEvents: undefined,
          host: "127.0.0.1",
          port: 4222,
          devUrl: undefined,
        });

        assert.equal(env.OTTO_LEGACY_HOME, path.resolve("/tmp/my-ottoLegacy"));
        assert.equal(env.PORT, "5733");
        assert.equal(env.VITE_DEV_SERVER_URL, "http://127.0.0.1:5733");
        assert.equal(env.HOST, "127.0.0.1");
        assert.equal(env.OTTO_LEGACY_PORT, "4222");
        assert.equal(env.VITE_HTTP_URL, "http://127.0.0.1:4222");
        assert.equal(env.OTTO_LEGACY_MODE, undefined);
        assert.equal(env.OTTO_LEGACY_NO_BROWSER, undefined);
        assert.equal(env.OTTO_LEGACY_HOST, undefined);
        assert.equal(env.VITE_WS_URL, "ws://127.0.0.1:4222");
      }),
    );

    it.effect("defaults dev server mode to the higher backend port range", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev",
          baseEnv: {},
          serverOffset: 0,
          webOffset: 0,
          ottoLegacyHome: undefined,
          browser: undefined,
          autoBootstrapProjectFromCwd: undefined,
          logWebSocketEvents: undefined,
          host: undefined,
          port: undefined,
          devUrl: undefined,
        });

        assert.equal(env.OTTO_LEGACY_PORT, "13773");
        assert.equal(env.PORT, "5733");
      }),
    );

    // Browser dev is single-origin: Vite proxies the backend, and the client
    // resolves it from window.location.origin. Baking a localhost URL here is
    // what breaks sharing a dev server to another device.
    for (const mode of ["dev", "dev:web"] as const) {
      it.effect(`leaves the client backend URLs unset in ${mode} mode`, () =>
        Effect.gen(function* () {
          const env = yield* createDevRunnerEnv({
            mode,
            baseEnv: {
              VITE_HTTP_URL: "http://localhost:1234",
              VITE_WS_URL: "ws://localhost:1234",
            },
            serverOffset: 0,
            webOffset: 0,
            ottoLegacyHome: undefined,
            browser: undefined,
            autoBootstrapProjectFromCwd: undefined,
            logWebSocketEvents: undefined,
            host: undefined,
            port: undefined,
            devUrl: undefined,
          });

          assert.equal(env.VITE_HTTP_URL, undefined);
          assert.equal(env.VITE_WS_URL, undefined);
          assert.equal(env.OTTO_LEGACY_PORT, "13773");
          // Deleting the keys is not sufficient — vite.config.ts merges
          // `.env`/`.env.local` underneath this env and would revive them, so
          // the intent has to be stated positively.
          assert.equal(env.OTTO_LEGACY_SINGLE_ORIGIN_DEV, "1");
        }),
      );
    }

    // Desktop pins the renderer at loopback deliberately; an ambient marker
    // must not make Vite discard those URLs.
    it.effect("clears the single-origin marker in dev:desktop mode", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev:desktop",
          baseEnv: { OTTO_LEGACY_SINGLE_ORIGIN_DEV: "1" },
          serverOffset: 0,
          webOffset: 0,
          ottoLegacyHome: undefined,
          browser: undefined,
          autoBootstrapProjectFromCwd: undefined,
          logWebSocketEvents: undefined,
          host: undefined,
          port: undefined,
          devUrl: undefined,
        });

        assert.equal(env.OTTO_LEGACY_SINGLE_ORIGIN_DEV, undefined);
        assert.equal(env.VITE_HTTP_URL, "http://127.0.0.1:13773");
      }),
    );

    it.effect("clears the single-origin marker in dev:server mode", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev:server",
          baseEnv: { OTTO_LEGACY_SINGLE_ORIGIN_DEV: "1" },
          serverOffset: 0,
          webOffset: 0,
          ottoLegacyHome: undefined,
          browser: undefined,
          autoBootstrapProjectFromCwd: undefined,
          logWebSocketEvents: undefined,
          host: undefined,
          port: undefined,
          devUrl: undefined,
        });

        assert.equal(env.OTTO_LEGACY_SINGLE_ORIGIN_DEV, undefined);
        assert.equal(env.VITE_HTTP_URL, "http://localhost:13773");
      }),
    );

    // HOST is Vite's bind address and gates the HMR pin in vite.config.ts. An
    // inherited one would survive into browser dev and point HMR at the wrong
    // interface — invisible over a shared origin, since the page still loads.
    for (const mode of ["dev", "dev:web"] as const) {
      it.effect(`drops an inherited HOST in ${mode} mode`, () =>
        Effect.gen(function* () {
          const env = yield* createDevRunnerEnv({
            mode,
            baseEnv: { HOST: "0.0.0.0" },
            serverOffset: 0,
            webOffset: 0,
            ottoLegacyHome: undefined,
            browser: undefined,
            autoBootstrapProjectFromCwd: undefined,
            logWebSocketEvents: undefined,
            host: undefined,
            port: undefined,
            devUrl: undefined,
          });

          assert.equal(env.HOST, undefined);
        }),
      );
    }

    // --host configures the *backend* (OTTO_LEGACY_HOST). It must not become Vite's
    // bind address by way of an inherited HOST that happens to agree with it.
    it.effect("drops an inherited HOST even when --host is given", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev",
          baseEnv: { HOST: "0.0.0.0" },
          serverOffset: 0,
          webOffset: 0,
          ottoLegacyHome: undefined,
          browser: undefined,
          autoBootstrapProjectFromCwd: undefined,
          logWebSocketEvents: undefined,
          host: "0.0.0.0",
          port: undefined,
          devUrl: undefined,
        });

        assert.equal(env.HOST, undefined);
        assert.equal(env.OTTO_LEGACY_HOST, "0.0.0.0");
      }),
    );

    // Desktop sets HOST itself, so the clearing must not reach it.
    it.effect("still pins HOST for dev:desktop", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev:desktop",
          baseEnv: { HOST: "0.0.0.0" },
          serverOffset: 0,
          webOffset: 0,
          ottoLegacyHome: undefined,
          browser: undefined,
          autoBootstrapProjectFromCwd: undefined,
          logWebSocketEvents: undefined,
          host: undefined,
          port: undefined,
          devUrl: undefined,
        });

        assert.equal(env.HOST, "127.0.0.1");
      }),
    );

    it.effect("keeps explicit backend URLs for the desktop renderer", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev:desktop",
          baseEnv: {},
          serverOffset: 0,
          webOffset: 0,
          ottoLegacyHome: undefined,
          browser: undefined,
          autoBootstrapProjectFromCwd: undefined,
          logWebSocketEvents: undefined,
          host: undefined,
          port: undefined,
          devUrl: undefined,
        });

        assert.equal(env.VITE_HTTP_URL, "http://127.0.0.1:13773");
        assert.equal(env.VITE_WS_URL, "ws://127.0.0.1:13773");
      }),
    );
  });
});
