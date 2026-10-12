import { standardCommand } from "./test-support/standard-command.ts";
import * as Predicate from "effect/Predicate";
import * as NodeServices from "@effect/platform-node/NodeServices";

import * as NodeFS from "node:fs";

import * as NodeOS from "node:os";

import * as NodePath from "node:path";

import {
  HostProcessEnvironment,
  HostProcessPlatform,
  HostProcessWorkingDirectory,
} from "@otto/shared/hostProcess";

import { assert, describe, it } from "@effect/vitest";

import * as ConfigProvider from "effect/ConfigProvider";

import * as Effect from "effect/Effect";

import * as Layer from "effect/Layer";

import * as Path from "effect/Path";

import * as PlatformError from "effect/PlatformError";

import * as Sink from "effect/Sink";

import * as Stream from "effect/Stream";

import { ChildProcessSpawner } from "effect/unstable/process";

import {
  createDevRunnerEnv,
  findFirstAvailableOffset,
  runDevRunnerWithInput,
} from "./dev-runner.ts";

import {
  emptyConfigLayer,
  netServiceLayer,
  mockProcess,
  devServerInput,
} from "./test-support/dev-runner.ts";

it.layer(NodeServices.layer)("dev-runner", (it) => {
  describe("findFirstAvailableOffset", () => {
    it.effect("returns the starting offset when required ports are available", () =>
      Effect.gen(function* () {
        const offset = yield* findFirstAvailableOffset({
          startOffset: 0,
          requireServerPort: true,
          requireWebPort: true,
          checkPortAvailability: () => Effect.succeed(true),
        });

        assert.equal(offset, 0);
      }),
    );

    it.effect("advances until all required ports are available", () =>
      Effect.gen(function* () {
        const taken = new Set([13773, 5733, 13774, 5734]);

        const offset = yield* findFirstAvailableOffset({
          startOffset: 0,
          requireServerPort: true,
          requireWebPort: true,
          checkPortAvailability: (port) => Effect.succeed(!taken.has(port)),
        });

        assert.equal(offset, 2);
      }),
    );

    it.effect("skips browser-blocked web ports before probing availability", () =>
      Effect.gen(function* () {
        const probed: Array<{ port: number; role: string | undefined }> = [];

        const offset = yield* findFirstAvailableOffset({
          // 5733 + 833 = 6566, which browsers block as sane-port.
          startOffset: 833,
          requireServerPort: true,
          requireWebPort: true,
          checkPortAvailability: (port, role) => {
            probed.push({ port, role });

            return Effect.succeed(true);
          },
        });

        assert.equal(offset, 834);
        assert.deepStrictEqual(probed, [
          { port: 14_607, role: "server" },
          { port: 6567, role: "web" },
        ]);
      }),
    );

    it.effect("does not reject a server-only offset because its unused web port is blocked", () =>
      Effect.gen(function* () {
        const offset = yield* findFirstAvailableOffset({
          startOffset: 833,
          requireServerPort: true,
          requireWebPort: false,
          checkPortAvailability: () => Effect.succeed(true),
        });

        assert.equal(offset, 833);
      }),
    );

    it.effect("allows offsets where the non-required server port exceeds max", () =>
      Effect.gen(function* () {
        const offset = yield* findFirstAvailableOffset({
          startOffset: 59_802,
          requireServerPort: false,
          requireWebPort: true,
          checkPortAvailability: () => Effect.succeed(true),
        });

        assert.equal(offset, 59_802);
      }),
    );

    it.effect("reports the exhausted range and required port set", () =>
      Effect.gen(function* () {
        const error = yield* findFirstAvailableOffset({
          startOffset: 51_763,
          requireServerPort: true,
          requireWebPort: false,
          checkPortAvailability: () => Effect.succeed(true),
        }).pipe(Effect.flip);

        if (!Predicate.isTagged(error, "DevRunnerPortExhaustedError")) {
          assert.fail(`Unexpected error: ${String(error)}`);
        }

        assert.equal(error.startOffset, 51_763);
        assert.equal(error.requireServerPort, true);
        assert.equal(error.requireWebPort, false);
        assert.equal(error.baseServerPort, 13_773);
        assert.equal(error.baseWebPort, 5_733);
        assert.equal(error.maximumPort, 65_535);
        assert.ok(!("cause" in error));
      }),
    );
  });

  describe("runDevRunnerWithInput", () => {
    it.effect("preserves invalid configuration as the exact cause", () =>
      Effect.gen(function* () {
        const error = yield* runDevRunnerWithInput({ ...devServerInput, dryRun: true }).pipe(
          Effect.provide(
            Layer.merge(
              netServiceLayer,
              ConfigProvider.layer(
                ConfigProvider.fromEnv({ env: { OTTO_LEGACY_PORT_OFFSET: "not-an-integer" } }),
              ),
            ),
          ),
          Effect.flip,
        );

        if (!Predicate.isTagged(error, "DevRunnerConfigurationError")) {
          assert.fail(`Unexpected error: ${String(error)}`);
        }

        assert.deepStrictEqual(error.configKeys, [
          "OTTO_LEGACY_PORT_OFFSET",
          "OTTO_LEGACY_DEV_INSTANCE",
        ]);
        assert.ok(error.cause !== undefined);
        assert.ok(!error.message.includes(String((error.cause as Error).message)));
      }),
    );

    it.effect("preserves process spawn context and the exact platform cause", () => {
      const cause = PlatformError.systemError({
        _tag: "NotFound",
        module: "ChildProcess",
        method: "spawn",
        description: "vp was not found",
      });

      const spawnerLayer = Layer.succeed(
        ChildProcessSpawner.ChildProcessSpawner,
        ChildProcessSpawner.make(() => Effect.fail(cause)),
      );

      return Effect.gen(function* () {
        const error = yield* runDevRunnerWithInput(devServerInput).pipe(
          Effect.provide(Layer.mergeAll(emptyConfigLayer, netServiceLayer, spawnerLayer)),
          Effect.provideService(HostProcessPlatform, "linux"),
          Effect.flip,
        );

        if (!Predicate.isTagged(error, "DevRunnerProcessError")) {
          assert.fail(`Unexpected error: ${String(error)}`);
        }

        assert.equal(error.operation, "spawn");
        assert.equal(error.mode, "dev:server");
        assert.equal(error.executable, "vp");
        assert.equal(error.argumentCount, 5);
        assert.equal(error.shell, false);
        assert.equal(error.cause, cause);
        assert.ok(!error.message.includes(cause.message));
        assert.notProperty(error, "args");
        assert.notInclude(error.message, "secret-token-value");
      });
    });

    // `tailscale serve` config outlives the process, so a dry run that shared
    // would replace and then tear down whatever mapping the port already had.
    // Base-dir precedence (--home-dir > worktree .otto > ambient OTTO_LEGACY_HOME)
    // lives in runDevRunnerWithInput; the env builder must not consult the
    // ambient variable on its own, or it would silently outrank the worktree
    // default and land dev state on the user's real database.
    it.effect("ignores an ambient OTTO_LEGACY_HOME when no home is resolved", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev",
          baseEnv: { OTTO_LEGACY_HOME: "/home/user/.ottoLegacy" },
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
      }),
    );

    // Sharing dev:desktop would publish a URL whose renderer dials the
    // visitor's own loopback, and would clobber the VITE_DEV_SERVER_URL that
    // Electron loads from. It must decline, not half-work.
    it.effect("declines to share for dev:desktop and still starts the stack", () => {
      let spawnCount = 0;

      const spawnerLayer = Layer.succeed(
        ChildProcessSpawner.ChildProcessSpawner,
        ChildProcessSpawner.make(() => {
          spawnCount += 1;

          return Effect.succeed(mockProcess(0));
        }),
      );

      return Effect.gen(function* () {
        yield* runDevRunnerWithInput({
          ...devServerInput,
          mode: "dev:desktop",
          port: undefined,
          share: true,
        }).pipe(
          Effect.provide(Layer.mergeAll(emptyConfigLayer, netServiceLayer, spawnerLayer)),
          Effect.provideService(HostProcessPlatform, "linux"),
        );

        assert.equal(spawnCount, 1);
      });
    });

    // Single-origin browser dev proxies the backend at localhost, so a backend
    // bound only to a specific interface breaks every proxied request in a way
    // that looks like a broken server. Reject the combination up front.
    it.effect("rejects a specific non-loopback --host for browser dev modes", () => {
      const spawnerLayer = Layer.succeed(
        ChildProcessSpawner.ChildProcessSpawner,
        ChildProcessSpawner.make(() => Effect.succeed(mockProcess(0))),
      );

      return Effect.gen(function* () {
        const error = yield* runDevRunnerWithInput({
          ...devServerInput,
          mode: "dev",
          port: undefined,
          host: "192.168.1.10",
        }).pipe(
          Effect.provide(Layer.mergeAll(emptyConfigLayer, netServiceLayer, spawnerLayer)),
          Effect.provideService(HostProcessPlatform, "linux"),
          Effect.flip,
        );

        if (!Predicate.isTagged(error, "DevRunnerHostNotProxiableError")) {
          assert.fail(`Unexpected error: ${String(error)}`);
        }

        assert.equal(error.mode, "dev");
        assert.equal(error.host, "192.168.1.10");
        assert.include(error.message, "0.0.0.0");
        assert.include(error.message, "--share");
      });
    });

    // Wildcards keep loopback answering, so the proxy target stays valid and
    // the combination must keep working — it is the documented way to serve a
    // LAN interface and the browser proxy at once.
    it.effect("still spawns the stack for a wildcard --host in dev mode", () => {
      let spawnCount = 0;

      const spawnerLayer = Layer.succeed(
        ChildProcessSpawner.ChildProcessSpawner,
        ChildProcessSpawner.make(() => {
          spawnCount += 1;

          return Effect.succeed(mockProcess(0));
        }),
      );

      return Effect.gen(function* () {
        yield* runDevRunnerWithInput({
          ...devServerInput,
          mode: "dev",
          port: undefined,
          host: "0.0.0.0",
        }).pipe(
          Effect.provide(Layer.mergeAll(emptyConfigLayer, netServiceLayer, spawnerLayer)),
          Effect.provideService(HostProcessPlatform, "linux"),
        );

        assert.equal(spawnCount, 1);
      });
    });

    // dev:server does not proxy — the client talks to the backend directly —
    // so a specific interface bind stays legitimate there.
    it.effect("keeps a specific --host working for dev:server", () => {
      let spawnCount = 0;

      const spawnerLayer = Layer.succeed(
        ChildProcessSpawner.ChildProcessSpawner,
        ChildProcessSpawner.make(() => {
          spawnCount += 1;

          return Effect.succeed(mockProcess(0));
        }),
      );

      return Effect.gen(function* () {
        yield* runDevRunnerWithInput({
          ...devServerInput,
          host: "192.168.1.10",
        }).pipe(
          Effect.provide(Layer.mergeAll(emptyConfigLayer, netServiceLayer, spawnerLayer)),
          Effect.provideService(HostProcessPlatform, "linux"),
        );

        assert.equal(spawnCount, 1);
      });
    });

    // A shared origin means a remote browser, where unbundled dev's
    // per-module waterfall pays a tailnet round trip per import level. The
    // runner defaults bundled dev on for the spawned stack, but only
    // defaults: an explicit OTTO_LEGACY_BUNDLED_DEV (even "0") must pass through.
    describe("--share bundled dev default", () => {
      const shareSpawnedEnv = (input: { readonly ambientBundledDev: string | undefined }) =>
        Effect.gen(function* () {
          let captured: Record<string, string | undefined> | undefined;

          const spawnerLayer = Layer.succeed(
            ChildProcessSpawner.ChildProcessSpawner,
            ChildProcessSpawner.make((command) => {
              const spawned = standardCommand(command);

              if (spawned.command === "vp") {
                captured = spawned.options?.env;

                return Effect.succeed(mockProcess(0));
              }

              // tailscale: answer `status --json` with a valid tailnet name,
              // succeed the `serve`/`off` calls.
              return Effect.succeed(
                ChildProcessSpawner.makeHandle({
                  pid: ChildProcessSpawner.ProcessId(2),
                  exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
                  isRunning: Effect.succeed(false),
                  kill: () => Effect.void,
                  unref: Effect.succeed(Effect.void),
                  stdin: Sink.drain,
                  stdout: spawned.args.includes("status")
                    ? Stream.make(
                        new TextEncoder().encode(
                          JSON.stringify({ Self: { DNSName: "host.example.ts.net." } }),
                        ),
                      )
                    : Stream.empty,
                  stderr: Stream.empty,
                  all: Stream.empty,
                  getInputFd: () => Sink.drain,
                  getOutputFd: () => Stream.empty,
                }),
              );
            }),
          );

          yield* runDevRunnerWithInput({
            ...devServerInput,
            mode: "dev",
            port: undefined,
            share: true,
          }).pipe(
            Effect.provide(Layer.mergeAll(emptyConfigLayer, netServiceLayer, spawnerLayer)),
            Effect.provideService(HostProcessPlatform, "linux"),
            Effect.provideService(
              HostProcessEnvironment,
              input.ambientBundledDev === undefined
                ? {}
                : { OTTO_LEGACY_BUNDLED_DEV: input.ambientBundledDev },
            ),
          );

          return captured;
        });

      it.effect("defaults OTTO_LEGACY_BUNDLED_DEV=1 for a shared run", () =>
        Effect.gen(function* () {
          const env = yield* shareSpawnedEnv({ ambientBundledDev: undefined });
          assert.equal(env?.OTTO_LEGACY_BUNDLED_DEV, "1");
        }),
      );

      it.effect("keeps an explicit OTTO_LEGACY_BUNDLED_DEV=0 opt-out", () =>
        Effect.gen(function* () {
          const env = yield* shareSpawnedEnv({ ambientBundledDev: "0" });
          assert.equal(env?.OTTO_LEGACY_BUNDLED_DEV, "0");
        }),
      );

      it.effect("leaves OTTO_LEGACY_BUNDLED_DEV unset without --share", () =>
        Effect.gen(function* () {
          let captured: Record<string, string | undefined> | undefined;

          const spawnerLayer = Layer.succeed(
            ChildProcessSpawner.ChildProcessSpawner,
            ChildProcessSpawner.make((command) => {
              captured = (
                command as {
                  readonly options?: { readonly env?: Record<string, string | undefined> };
                }
              ).options?.env;

              return Effect.succeed(mockProcess(0));
            }),
          );

          yield* runDevRunnerWithInput({
            ...devServerInput,
            mode: "dev",
            port: undefined,
          }).pipe(
            Effect.provide(Layer.mergeAll(emptyConfigLayer, netServiceLayer, spawnerLayer)),
            Effect.provideService(HostProcessPlatform, "linux"),
            Effect.provideService(HostProcessEnvironment, {}),
          );

          assert.equal(captured?.OTTO_LEGACY_BUNDLED_DEV, undefined);
        }),
      );
    });

    it.effect("spawns nothing when --dry-run is combined with --share", () => {
      let spawnCount = 0;

      const spawnerLayer = Layer.succeed(
        ChildProcessSpawner.ChildProcessSpawner,
        ChildProcessSpawner.make(() => {
          spawnCount += 1;

          return Effect.succeed(mockProcess(0));
        }),
      );

      return Effect.gen(function* () {
        yield* runDevRunnerWithInput({
          ...devServerInput,
          mode: "dev",
          port: undefined,
          dryRun: true,
          share: true,
        }).pipe(
          Effect.provide(Layer.mergeAll(emptyConfigLayer, netServiceLayer, spawnerLayer)),
          Effect.provideService(HostProcessPlatform, "linux"),
        );

        assert.equal(spawnCount, 0);
      });
    });

    it.effect("reports non-zero exits without manufacturing a cause", () => {
      const spawnerLayer = Layer.succeed(
        ChildProcessSpawner.ChildProcessSpawner,
        ChildProcessSpawner.make(() => Effect.succeed(mockProcess(17))),
      );

      return Effect.gen(function* () {
        const error = yield* runDevRunnerWithInput(devServerInput).pipe(
          Effect.provide(Layer.mergeAll(emptyConfigLayer, netServiceLayer, spawnerLayer)),
          Effect.provideService(HostProcessPlatform, "linux"),
          Effect.flip,
        );

        if (!Predicate.isTagged(error, "DevRunnerProcessExitError")) {
          assert.fail(`Unexpected error: ${String(error)}`);
        }

        assert.equal(error.mode, "dev:server");
        assert.equal(error.executable, "vp");
        assert.equal(error.argumentCount, 5);
        assert.equal(error.shell, false);
        assert.equal(error.exitCode, 17);
        assert.ok(!("cause" in error));
        assert.notProperty(error, "args");
        assert.notInclude(error.message, "secret-token-value");
      });
    });

    it.effect("preserves wait-for-exit failures as the exact cause", () => {
      const cause = PlatformError.systemError({
        _tag: "Unknown",
        module: "ChildProcess",
        method: "exitCode",
        description: "process status became unavailable",
      });

      const spawnerLayer = Layer.succeed(
        ChildProcessSpawner.ChildProcessSpawner,
        ChildProcessSpawner.make(() => Effect.succeed(mockProcess(cause))),
      );

      return Effect.gen(function* () {
        const error = yield* runDevRunnerWithInput(devServerInput).pipe(
          Effect.provide(Layer.mergeAll(emptyConfigLayer, netServiceLayer, spawnerLayer)),
          Effect.provideService(HostProcessPlatform, "linux"),
          Effect.flip,
        );

        if (!Predicate.isTagged(error, "DevRunnerProcessError")) {
          assert.fail(`Unexpected error: ${String(error)}`);
        }

        assert.equal(error.operation, "wait-for-exit");
        assert.equal(error.mode, "dev:server");
        assert.equal(error.executable, "vp");
        assert.equal(error.argumentCount, 5);
        assert.equal(error.shell, false);
        assert.equal(error.cause, cause);
        assert.ok(!error.message.includes(cause.message));
        assert.notProperty(error, "args");
        assert.notInclude(error.message, "secret-token-value");
      });
    });

    describe("ottoLegacy home precedence", () => {
      const makeWorktree = Effect.acquireRelease(
        Effect.sync(() => {
          const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "ottoLegacy-devrunner-"));
          NodeFS.writeFileSync(
            NodePath.join(root, ".git"),
            "gitdir: /elsewhere/.git/worktrees/x\n",
          );

          return root;
        }),
        (root) => Effect.sync(() => NodeFS.rmSync(root, { recursive: true, force: true })),
      );

      const spawnedHome = (input: {
        readonly ottoLegacyHome: string | undefined;
        readonly cwd: string;
        readonly ambientHome: string | undefined;
      }) =>
        Effect.gen(function* () {
          let captured: Record<string, string | undefined> | undefined;

          const spawnerLayer = Layer.succeed(
            ChildProcessSpawner.ChildProcessSpawner,
            ChildProcessSpawner.make((command) => {
              captured = (
                command as {
                  readonly options?: { readonly env?: Record<string, string | undefined> };
                }
              ).options?.env;

              return Effect.succeed(mockProcess(0));
            }),
          );

          yield* runDevRunnerWithInput({
            ...devServerInput,
            ottoLegacyHome: input.ottoLegacyHome,
          }).pipe(
            Effect.provide(Layer.mergeAll(emptyConfigLayer, netServiceLayer, spawnerLayer)),
            Effect.provideService(HostProcessPlatform, "linux"),
            Effect.provideService(HostProcessWorkingDirectory, input.cwd),
            Effect.provideService(
              HostProcessEnvironment,
              input.ambientHome === undefined ? {} : { OTTO_LEGACY_HOME: input.ambientHome },
            ),
          );

          return captured?.OTTO_LEGACY_HOME;
        });

      it.effect("prefers an explicit --home-dir over the worktree default", () =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const root = yield* makeWorktree;

          const home = yield* spawnedHome({
            ottoLegacyHome: "/tmp/explicit-home",
            cwd: root,
            ambientHome: "/home/user/.ottoLegacy",
          });

          assert.equal(home, path.resolve("/tmp/explicit-home"));
        }).pipe(Effect.scoped),
      );

      it.effect("treats a blank --home-dir as unset rather than as a selection", () =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const root = yield* makeWorktree;

          const home = yield* spawnedHome({
            ottoLegacyHome: "   ",
            cwd: root,
            ambientHome: "/home/user/.ottoLegacy",
          });

          assert.equal(home, path.join(path.resolve(root), ".otto"));
        }).pipe(Effect.scoped),
      );

      it.effect("prefers the worktree .otto over an ambient OTTO_LEGACY_HOME", () =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const root = yield* makeWorktree;

          const home = yield* spawnedHome({
            ottoLegacyHome: undefined,
            cwd: root,
            ambientHome: "/home/user/.ottoLegacy",
          });

          assert.equal(home, path.join(path.resolve(root), ".otto"));
        }).pipe(Effect.scoped),
      );

      it.effect("falls back to an ambient OTTO_LEGACY_HOME outside a worktree", () =>
        Effect.gen(function* () {
          const path = yield* Path.Path;

          const home = yield* spawnedHome({
            ottoLegacyHome: undefined,
            cwd: NodeOS.tmpdir(),
            ambientHome: "/home/user/.ottoLegacy",
          });

          assert.equal(home, path.resolve("/home/user/.ottoLegacy"));
        }),
      );

      it.effect("leaves the home implicit with no worktree and no ambient value", () =>
        Effect.gen(function* () {
          const home = yield* spawnedHome({
            ottoLegacyHome: undefined,
            cwd: NodeOS.tmpdir(),
            ambientHome: undefined,
          });

          assert.equal(home, undefined);
        }),
      );
    });
  });
});
