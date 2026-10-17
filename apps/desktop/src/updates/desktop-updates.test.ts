import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as Predicate from "effect/Predicate";
import { assert, describe, it } from "@effect/vitest";

import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as TestClock from "effect/testing/TestClock";

import * as DesktopAppSettings from "../settings/desktop-app-settings.ts";

import * as DesktopUpdates from "./desktop-updates.ts";
import { flushCallbacks, makeHarness } from "./test-support/updates-harness.ts";

describe("DesktopUpdates", () => {
  it.effect("configures the updater and runs startup checks on the test clock", () => {
    const harness = makeHarness();

    return Effect.gen(function* () {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const updates = yield* DesktopUpdates.DesktopUpdates;
          yield* updates.configure;

          const state = yield* updates.getState;
          assert.equal(state.enabled, true);
          assert.equal(state.status, "idle");
          assert.deepEqual(harness.feedUrls(), [
            { provider: "generic", url: "http://localhost:4141" },
          ]);
          assert.equal(harness.listenerCount(), 6);
          assert.equal(harness.checkCount(), 0);

          yield* TestClock.adjust(Duration.millis(15_000));
          assert.equal(harness.checkCount(), 1);
        }),
      );

      assert.equal(harness.listenerCount(), 0);
    }).pipe(Effect.provide(Layer.merge(TestClock.layer(), harness.layer)));
  });

  it.effect("turns on a packaged build's release feed and checks on launch and every poll", () => {
    const resourcesPath = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-resources-"));

    NodeFS.writeFileSync(
      NodePath.join(resourcesPath, "app-update.yml"),
      [
        "owner: hellogafaro",
        "repo: otto",
        "provider: github",
        "releaseType: release",
        "updaterCacheDirName: otto-updater",
        "",
      ].join("\n"),
    );

    const harness = makeHarness({
      resourcesPath,
      env: { OTTO_LEGACY_DESKTOP_MOCK_UPDATES: "false" },
    });

    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;

        const state = yield* updates.getState;
        assert.equal(state.enabled, true);
        assert.equal(state.status, "idle");
        assert.deepEqual(harness.feedUrls(), []);

        yield* TestClock.adjust(Duration.seconds(15));
        assert.equal(harness.checkCount(), 1);

        yield* TestClock.adjust(Duration.minutes(4));
        assert.equal(harness.checkCount(), 2);

        yield* TestClock.adjust(Duration.minutes(4));
        assert.equal(harness.checkCount(), 3);
      }),
    ).pipe(Effect.provide(Layer.merge(TestClock.layer(), harness.layer)));
  });

  it.effect("keeps a stable build on the latest feed and ignores beta releases", () => {
    const harness = makeHarness();

    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;

        assert.equal(harness.channel(), "latest");
        assert.isFalse(harness.allowPrerelease());
        assert.isFalse(harness.allowDowngrade());

        harness.emit("update-available", { version: "1.2.4-beta.20261018.7" });
        yield* flushCallbacks;
        assert.equal((yield* updates.getState).status, "up-to-date");

        harness.emit("update-available", { version: "1.2.4" });
        yield* flushCallbacks;
        assert.equal((yield* updates.getState).availableVersion, "1.2.4");
      }),
    ).pipe(Effect.provide(Layer.merge(TestClock.layer(), harness.layer)));
  });

  it.effect("puts a beta build on the beta feed and still takes newer stable releases", () => {
    const harness = makeHarness({
      appVersion: "1.2.4-beta.20261018.7",
      env: { OTTO_LEGACY_HOME: `/tmp/otto-desktop-updates-beta-${process.pid}` },
    });

    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;

        assert.equal((yield* updates.getState).channel, "beta");
        assert.equal(harness.channel(), "beta");
        assert.isTrue(harness.allowPrerelease());
        assert.isFalse(harness.allowDowngrade());

        harness.emit("update-available", { version: "1.2.4-beta.20261019.8" });
        yield* flushCallbacks;
        assert.equal((yield* updates.getState).availableVersion, "1.2.4-beta.20261019.8");

        harness.emit("update-available", { version: "1.2.4" });
        yield* flushCallbacks;
        assert.equal((yield* updates.getState).availableVersion, "1.2.4");
      }),
    ).pipe(Effect.provide(Layer.merge(TestClock.layer(), harness.layer)));
  });

  it.effect("switches a beta install back to stable without allowing a downgrade", () => {
    const allowDowngradeDuringChecks: boolean[] = [];

    const harness = makeHarness({
      appVersion: "1.2.4-beta.20261018.7",
      env: { OTTO_LEGACY_HOME: `/tmp/otto-desktop-updates-switch-${process.pid}` },
      checkForUpdates: Effect.sync(() => {
        allowDowngradeDuringChecks.push(harness.allowDowngrade());
      }),
    });

    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;

        const state = yield* updates.setChannel("latest");

        assert.equal(state.channel, "latest");
        assert.equal(harness.channel(), "latest");
        assert.isFalse(harness.allowPrerelease());
        assert.deepEqual(allowDowngradeDuringChecks, [false]);
        assert.isFalse(harness.allowDowngrade());
      }),
    ).pipe(Effect.provide(Layer.merge(TestClock.layer(), harness.layer)));
  });

  it.effect("keeps an ad-hoc build without app-update.yml off the update feed", () => {
    const harness = makeHarness({ env: { OTTO_LEGACY_DESKTOP_MOCK_UPDATES: "false" } });

    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;

        const state = yield* updates.getState;
        const disabledReason = yield* updates.disabledReason;
        assert.equal(state.enabled, false);
        assert.equal(state.status, "disabled");
        assert.include(
          Option.getOrElse(disabledReason, () => ""),
          "no update feed",
        );

        yield* TestClock.adjust(Duration.minutes(30));
        assert.equal(harness.checkCount(), 0);
      }),
    ).pipe(Effect.provide(Layer.merge(TestClock.layer(), harness.layer)));
  });

  it.effect("checks for newer releases after an update has been downloaded", () => {
    const harness = makeHarness();

    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;

        harness.emit("update-available", {
          version: "1.2.4",
          releaseNotes: "## What's changed\n- fix: queued update",
        });
        yield* flushCallbacks;
        harness.emit("update-downloaded", { version: "1.2.4" });
        yield* flushCallbacks;

        const result = yield* updates.check("poll");
        assert.isTrue(result.checked);

        harness.emit("update-available", { version: "1.2.4" });
        yield* flushCallbacks;

        const unchangedState = yield* updates.getState;
        assert.equal(unchangedState.status, "downloaded");
        assert.equal(unchangedState.downloadedVersion, "1.2.4");
        assert.deepEqual(unchangedState.releaseNotes, [
          { version: "1.2.4", items: ["fix: queued update"] },
        ]);

        const nextResult = yield* updates.check("poll");
        assert.isTrue(nextResult.checked);

        harness.emit("update-available", { version: "1.2.5" });
        yield* flushCallbacks;

        const state = yield* updates.getState;
        assert.equal(state.status, "available");
        assert.equal(state.availableVersion, "1.2.5");
        assert.isNull(state.downloadedVersion);
      }),
    ).pipe(Effect.provide(Layer.merge(TestClock.layer(), harness.layer)));
  });

  it.effect("does not persist an unchanged update channel as a user preference", () => {
    const harness = makeHarness();

    return Effect.scoped(
      Effect.gen(function* () {
        const settings = yield* DesktopAppSettings.DesktopAppSettings;
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;

        const state = yield* updates.setChannel("latest");
        const persistedSettings = yield* settings.get;

        assert.equal(state.channel, "latest");
        assert.equal(persistedSettings.updateChannel, "latest");
        assert.equal(persistedSettings.updateChannelConfiguredByUser, false);
      }),
    ).pipe(Effect.provide(Layer.merge(TestClock.layer(), harness.layer)));
  });

  it.effect("fails channel changes with a typed error while a check is in progress", () =>
    Effect.gen(function* () {
      const checkStarted = yield* Deferred.make<void>();
      const releaseCheck = yield* Deferred.make<void>();

      const harness = makeHarness({
        checkForUpdates: Deferred.succeed(checkStarted, undefined).pipe(
          Effect.andThen(Deferred.await(releaseCheck)),
        ),
      });

      yield* Effect.scoped(
        Effect.gen(function* () {
          const updates = yield* DesktopUpdates.DesktopUpdates;
          yield* updates.configure;

          const checkFiber = yield* updates.check("manual").pipe(Effect.forkScoped);
          yield* Deferred.await(checkStarted);

          const exit = yield* Effect.exit(updates.setChannel("latest"));
          assert.equal(exit._tag, "Failure");

          if (Predicate.isTagged(exit, "Failure")) {
            const error = Cause.squash(exit.cause);
            assert.instanceOf(error, DesktopUpdates.DesktopUpdateActionInProgressError);
            assert.equal(error.action, "check");
            assert.equal(error.requestedChannel, "latest");
          }

          yield* Deferred.succeed(releaseCheck, undefined);
          yield* Fiber.join(checkFiber);
        }),
      ).pipe(Effect.provide(Layer.merge(TestClock.layer(), harness.layer)));
    }),
  );
});
