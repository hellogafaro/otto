import { DesktopHostTelemetryMessage } from "@otto/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ElectronApp from "../electron/electron-app.ts";
import * as ElectronPowerMonitor from "../electron/electron-power-monitor.ts";
import * as DesktopTelemetryPublisher from "./desktop-telemetry-publisher.ts";

const electronAppLayer = Layer.succeed(ElectronApp.ElectronApp, {
  metadata: Effect.die("unexpected metadata read"),
  name: Effect.succeed("Otto Legacy"),
  systemLocale: Effect.succeed("en-US"),
  whenReady: Effect.void,
  quit: Effect.void,
  requestSingleInstanceLock: Effect.succeed(true),
  exit: () => Effect.void,
  relaunch: () => Effect.void,
  setPath: () => Effect.void,
  setName: () => Effect.void,
  setAboutPanelOptions: () => Effect.void,
  setAppUserModelId: () => Effect.void,
  isDefaultProtocolClient: () => Effect.succeed(false),
  setAsDefaultProtocolClient: () => Effect.succeed(true),
  setDesktopName: () => Effect.void,
  setDockIcon: () => Effect.void,
  appendCommandLineSwitch: () => Effect.void,
  removeCommandLineSwitch: () => Effect.void,
  onBeforeQuitForUpdate: () => Effect.void,
  on: () => Effect.void,
} satisfies ElectronApp.ElectronApp["Service"]);

describe("DesktopTelemetryPublisher", () => {
  it.effect("stops when its scope closes during an Electron telemetry sample", () =>
    Effect.gen(function* () {
      const pollStarted = yield* Deferred.make<void>();
      const blockPoll = yield* Deferred.make<void>();

      const powerLayer = Layer.succeed(
        ElectronPowerMonitor.ElectronPowerMonitor,
        ElectronPowerMonitor.ElectronPowerMonitor.of({
          isOnBatteryPower: Effect.succeed(false),
          getSystemIdleTime: Deferred.succeed(pollStarted, undefined).pipe(
            Effect.andThen(Deferred.await(blockPoll)),
            Effect.as(0),
          ),
          getSystemIdleState: () => Effect.succeed("active"),
          getCurrentThermalState: Effect.succeed("nominal"),
          onSimpleEvent: () => Effect.void,
          onThermalStateChange: () => Effect.void,
          onSpeedLimitChange: () => Effect.void,
        }),
      );

      const layer = DesktopTelemetryPublisher.layer.pipe(
        Layer.provide(Layer.mergeAll(electronAppLayer, powerLayer)),
      );

      const scope = yield* Scope.make();

      yield* Layer.buildWithScope(layer, scope);
      yield* Deferred.await(pollStarted);

      const closeFiber = yield* Scope.close(scope, Exit.void).pipe(Effect.forkDetach);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;

      assert.isDefined(closeFiber.pollUnsafe());
    }),
  );

  it.effect("publishes event-driven power state over NDJSON", () =>
    Effect.gen(function* () {
      const onBattery = yield* Ref.make(false);
      const systemIdleState = yield* Ref.make<ElectronPowerMonitor.ElectronIdleState>("active");
      let beforeSystemIdleState: Effect.Effect<void> = Effect.void;
      const simpleListeners = new Map<string, () => void>();

      let thermalListener: ((state: ElectronPowerMonitor.ElectronThermalState) => void) | null =
        null;

      let speedLimitListener: ((limit: number) => void) | null = null;

      const powerLayer = Layer.succeed(
        ElectronPowerMonitor.ElectronPowerMonitor,
        ElectronPowerMonitor.ElectronPowerMonitor.of({
          isOnBatteryPower: Ref.get(onBattery),
          getSystemIdleTime: Effect.succeed(5),
          getSystemIdleState: () =>
            beforeSystemIdleState.pipe(Effect.andThen(Ref.get(systemIdleState))),
          getCurrentThermalState: Effect.succeed("nominal"),
          onSimpleEvent: (eventName, listener) =>
            Effect.sync(() => {
              simpleListeners.set(eventName, listener);
            }),
          onThermalStateChange: (listener) =>
            Effect.sync(() => {
              thermalListener = listener;
            }),
          onSpeedLimitChange: (listener) =>
            Effect.sync(() => {
              speedLimitListener = listener;
            }),
        }),
      );

      const layer = DesktopTelemetryPublisher.layer.pipe(
        Layer.provide(Layer.mergeAll(electronAppLayer, powerLayer)),
      );

      yield* Effect.gen(function* () {
        const publisher = yield* DesktopTelemetryPublisher.DesktopTelemetryPublisher;

        const latestSequence = publisher.latest.pipe(
          Effect.map((snapshot) => Option.getOrThrow(snapshot).sequence),
        );

        const encoded = yield* publisher.encoded.pipe(Stream.take(2), Stream.runCollect);
        const decoder = new TextDecoder();

        const decodeMessage = Schema.decodeUnknownEffect(
          Schema.fromJsonString(DesktopHostTelemetryMessage),
        );

        const messages = yield* Effect.forEach(encoded, (bytes) =>
          decodeMessage(decoder.decode(bytes).trim()),
        );

        assert.equal(messages[0]?.type, "desktopTelemetryHello");
        assert.equal(messages[0]?.electronPid, process.pid);
        const initialSnapshot = messages[1];

        if (initialSnapshot?.type !== "desktopTelemetry") {
          return assert.fail("Expected the second telemetry message to be a snapshot.");
        }

        assert.equal(initialSnapshot.electronPid, process.pid);

        const batterySnapshotFiber = yield* Stream.runHead(publisher.changes).pipe(
          Effect.forkChild,
        );

        yield* Effect.yieldNow;
        simpleListeners.get("on-battery")?.();
        const batterySnapshot = Option.getOrThrow(yield* Fiber.join(batterySnapshotFiber));
        assert.equal(batterySnapshot.power.onBattery, "true");
        yield* Ref.set(onBattery, true);

        yield* TestClock.adjust(Duration.millis(29_999));
        assert.equal(yield* latestSequence, batterySnapshot.sequence);
        yield* TestClock.adjust(Duration.millis(1));
        assert.equal(yield* latestSequence, batterySnapshot.sequence + 1);
        assert.equal((yield* publisher.latest).pipe(Option.getOrThrow).power.onBattery, "true");

        yield* Ref.set(onBattery, false);
        yield* TestClock.adjust(Duration.seconds(30));
        assert.equal((yield* publisher.latest).pipe(Option.getOrThrow).power.onBattery, "false");

        const suspendedSnapshotFiber = yield* Stream.runHead(publisher.changes).pipe(
          Effect.forkChild,
        );

        yield* Effect.yieldNow;
        simpleListeners.get("suspend")?.();
        const suspendedSnapshot = Option.getOrThrow(yield* Fiber.join(suspendedSnapshotFiber));
        assert.isTrue(suspendedSnapshot.power.suspended);

        const thermalSnapshotFiber = yield* Stream.runHead(publisher.changes).pipe(
          Effect.forkChild,
        );

        yield* Effect.yieldNow;
        thermalListener?.("serious");
        const thermalSnapshot = Option.getOrThrow(yield* Fiber.join(thermalSnapshotFiber));
        assert.equal(thermalSnapshot.power.thermalState, "serious");
        assert.isTrue(thermalSnapshot.power.suspended);

        const recoveredSnapshotFiber = yield* Stream.runHead(publisher.changes).pipe(
          Effect.forkChild,
        );

        yield* TestClock.adjust(Duration.millis(119_999));
        assert.equal(yield* latestSequence, thermalSnapshot.sequence);
        yield* TestClock.adjust(Duration.millis(1));
        const recoveredSnapshot = Option.getOrThrow(yield* Fiber.join(recoveredSnapshotFiber));
        assert.isFalse(recoveredSnapshot.power.suspended);

        const speedLimitSnapshotFiber = yield* Stream.runHead(publisher.changes).pipe(
          Effect.forkChild,
        );

        yield* Effect.yieldNow;
        speedLimitListener?.(65);
        const speedLimitSnapshot = Option.getOrThrow(yield* Fiber.join(speedLimitSnapshotFiber));
        assert.equal(Option.getOrNull(speedLimitSnapshot.speedLimitPercent), 65);

        const encodedSpeedLimit = yield* publisher.encoded.pipe(Stream.take(2), Stream.runCollect);
        const decodedSpeedLimit = yield* decodeMessage(decoder.decode(encodedSpeedLimit[1]).trim());

        if (decodedSpeedLimit.type !== "desktopTelemetry") {
          return assert.fail("Expected the encoded telemetry message to be a snapshot.");
        }

        assert.equal(Option.getOrNull(decodedSpeedLimit.speedLimitPercent), 65);

        const configuredSnapshotFiber = yield* Stream.runHead(publisher.changes).pipe(
          Effect.forkChild,
        );

        yield* Effect.yieldNow;
        yield* publisher.handleControl({
          version: 1,
          type: "setHostPowerIntervals",
          activeIntervalMs: 7_000,
          idleIntervalMs: 11_000,
        });

        const configuredSequence = Option.getOrThrow(
          yield* Fiber.join(configuredSnapshotFiber),
        ).sequence;

        yield* TestClock.adjust(Duration.millis(6_999));
        assert.equal(yield* latestSequence, configuredSequence);
        yield* TestClock.adjust(Duration.millis(1));
        assert.equal(yield* latestSequence, configuredSequence + 1);

        yield* Ref.set(systemIdleState, "locked");
        yield* TestClock.adjust(Duration.seconds(7));
        const lockedSequence = yield* latestSequence;
        assert.equal((yield* publisher.latest).pipe(Option.getOrThrow).power.locked, "true");
        yield* TestClock.adjust(Duration.millis(10_999));
        assert.equal(yield* latestSequence, lockedSequence);
        yield* TestClock.adjust(Duration.millis(1));
        assert.equal(yield* latestSequence, lockedSequence + 1);

        yield* Ref.set(systemIdleState, "active");
        yield* TestClock.adjust(Duration.seconds(11));
        const unlockedSnapshot = (yield* publisher.latest).pipe(Option.getOrThrow);
        assert.equal(unlockedSnapshot.power.locked, "false");
        assert.equal(unlockedSnapshot.power.idle, "false");

        yield* TestClock.adjust(Duration.millis(6_999));
        assert.equal(yield* latestSequence, unlockedSnapshot.sequence);
        yield* TestClock.adjust(Duration.millis(1));
        assert.equal(yield* latestSequence, unlockedSnapshot.sequence + 1);

        const pollStarted = yield* Deferred.make<void>();
        const releasePoll = yield* Deferred.make<void>();
        beforeSystemIdleState = Deferred.succeed(pollStarted, undefined).pipe(
          Effect.andThen(Deferred.await(releasePoll)),
        );

        const concurrentEventSnapshotFiber = yield* Stream.runHead(publisher.changes).pipe(
          Effect.forkChild,
        );

        yield* Effect.yieldNow;
        yield* publisher.handleControl({
          version: 1,
          type: "setHostPowerIntervals",
          activeIntervalMs: 7_000,
          idleIntervalMs: 11_000,
        });
        yield* Deferred.await(pollStarted);
        simpleListeners.get("lock-screen")?.();
        thermalListener?.("critical");
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        yield* Deferred.succeed(releasePoll, undefined);

        const concurrentEventSnapshot = Option.getOrThrow(
          yield* Fiber.join(concurrentEventSnapshotFiber),
        );

        assert.equal(concurrentEventSnapshot.power.locked, "true");
        assert.equal(concurrentEventSnapshot.power.thermalState, "critical");
      }).pipe(Effect.provide(layer));
    }),
  );
});
