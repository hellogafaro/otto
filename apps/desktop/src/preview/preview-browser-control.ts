import * as Schema from "effect/Schema";
import * as Predicate from "effect/Predicate";
import type { DesktopPreviewColorScheme, DesktopPreviewRecordingFrame } from "@otto/contracts";

import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import type * as Fiber from "effect/Fiber";

import * as Option from "effect/Option";

import * as Ref from "effect/Ref";

import * as Semaphore from "effect/Semaphore";
import * as Scope from "effect/Scope";
import * as SynchronizedRef from "effect/SynchronizedRef";

import {
  PreviewAutomationDevToolsOpenError,
  PreviewAutomationDebuggerAttachedError,
  type PreviewManagerError,
} from "./preview-errors.ts";
import type { createPreviewState } from "./preview-state.ts";
import {
  type PreviewTabState,
  type RecordingFrameListener,
  type FrameCaptureSession,
  type BrowserControlSession,
} from "./preview-model.ts";

const decodeDebuggerParams = Schema.decodeUnknownOption(
  Schema.Record(Schema.String, Schema.Union([Schema.Json, Schema.Undefined])),
);

export const createPreviewBrowserControl = ({
  currentIso,
  replaceMap,
  controlSessionsRef,
  parentScope,
  attemptPromise,
  tabIdForWebContents,
  frameCaptureSessionsRef,
  recordingFrameListenersRef,
  deliverEvent,
  runFork,
  attempt,
  tabsRef,
}: {
  readonly currentIso: ReturnType<typeof createPreviewState>["currentIso"];
  readonly replaceMap: ReturnType<typeof createPreviewState>["replaceMap"];
  readonly controlSessionsRef: SynchronizedRef.SynchronizedRef<
    ReadonlyMap<number, BrowserControlSession>
  >;
  readonly parentScope: Scope.Scope;
  readonly attemptPromise: ReturnType<typeof createPreviewState>["attemptPromise"];
  readonly tabIdForWebContents: ReturnType<typeof createPreviewState>["tabIdForWebContents"];
  readonly frameCaptureSessionsRef: SynchronizedRef.SynchronizedRef<
    ReadonlyMap<string, FrameCaptureSession>
  >;
  readonly recordingFrameListenersRef: Ref.Ref<ReadonlySet<RecordingFrameListener>>;
  readonly deliverEvent: ReturnType<typeof createPreviewState>["deliverEvent"];
  readonly runFork: <A, E>(
    effect: Effect.Effect<A, E, never>,
    options?: Effect.RunOptions | undefined,
  ) => Fiber.Fiber<A, E>;
  readonly attempt: ReturnType<typeof createPreviewState>["attempt"];
  readonly tabsRef: SynchronizedRef.SynchronizedRef<ReadonlyMap<string, PreviewTabState>>;
}) => {
  const detachControlSession = Effect.fn("PreviewManager.detachControlSession")(function* (
    webContentsId: number,
  ) {
    const control = yield* SynchronizedRef.modify(controlSessionsRef, (sessions) => [
      sessions.get(webContentsId),
      replaceMap(sessions, (copy) => {
        copy.delete(webContentsId);
      }),
    ]);

    if (control) yield* Scope.close(control.scope, Exit.void).pipe(Effect.ignore);
  });

  const ensureControlSession = Effect.fn("PreviewManager.ensureControlSession")(function* (
    wc: Electron.WebContents,
  ) {
    return yield* SynchronizedRef.modifyEffect(
      controlSessionsRef,
      (
        sessions,
      ): Effect.Effect<
        readonly [BrowserControlSession, ReadonlyMap<number, BrowserControlSession>],
        PreviewManagerError
      > => {
        const existing = sessions.get(wc.id);

        if (existing) return Effect.succeed([existing, sessions] as const);

        if (wc.isDevToolsOpened()) {
          return Effect.fail(
            new PreviewAutomationDevToolsOpenError({
              webContentsId: wc.id,
            }),
          );
        }

        if (wc.debugger.isAttached()) {
          return Effect.fail(
            new PreviewAutomationDebuggerAttachedError({
              webContentsId: wc.id,
            }),
          );
        }

        const createControlSession = Effect.fn("PreviewManager.createControlSession")(function* () {
          const semaphore = yield* Semaphore.make(1);
          const scope = yield* Scope.fork(parentScope, "sequential");
          const wcDebugger = wc.debugger;

          const handleDebuggerMessage = Effect.fnUntraced(function* (
            method: string,
            params: Record<string, Schema.Json | undefined>,
          ) {
            if (method === "Page.screencastFrame") {
              const sessionId = params["sessionId"];

              if (Predicate.isNumber(sessionId)) {
                yield* attemptPromise(
                  {
                    operation: "ackScreencastFrame",
                    webContentsId: wc.id,
                  },
                  () => wcDebugger.sendCommand("Page.screencastFrameAck", { sessionId }),
                ).pipe(Effect.ignore);
              }

              const tabId = yield* tabIdForWebContents(wc.id);

              const metadata = Predicate.isObject(params["metadata"]) ? params["metadata"] : {};

              if (tabId && Predicate.isString(params["data"])) {
                const captureSession = (yield* SynchronizedRef.get(frameCaptureSessionsRef)).get(
                  tabId,
                );

                if (captureSession?.consumers.has("recording")) {
                  const receivedAt = yield* currentIso;
                  const listeners = yield* Ref.get(recordingFrameListenersRef);

                  const frame: DesktopPreviewRecordingFrame = {
                    tabId,
                    data: params["data"],
                    width: Predicate.isNumber(metadata["deviceWidth"])
                      ? metadata["deviceWidth"]
                      : 0,
                    height: Predicate.isNumber(metadata["deviceHeight"])
                      ? metadata["deviceHeight"]
                      : 0,
                    receivedAt,
                  };

                  yield* Effect.forEach(
                    listeners,
                    (listener) =>
                      deliverEvent("recording-frame", frame.tabId, () => listener(frame)),
                    { discard: true },
                  );
                }
              }
            }
          });

          const onMessage: BrowserControlSession["onMessage"] = (_event, method, params) => {
            const parsed = decodeDebuggerParams(params);

            if (Option.isSome(parsed)) runFork(handleDebuggerMessage(method, parsed.value));
          };

          yield* Scope.addFinalizer(
            scope,
            attempt({ operation: "detachControlSession", webContentsId: wc.id }, () => {
              wcDebugger.off("message", onMessage);

              if (wcDebugger.isAttached()) wcDebugger.detach();
            }).pipe(Effect.ignore),
          );

          const control: BrowserControlSession = {
            webContentsId: wc.id,
            debugger: wcDebugger,
            semaphore,
            scope,
            onMessage,
          };

          const initialize = Effect.fn("PreviewManager.initializeControlSession")(function* () {
            yield* attempt({ operation: "attachDebuggerListeners", webContentsId: wc.id }, () => {
              wcDebugger.on("message", onMessage);
              wcDebugger.attach("1.3");
            });
            yield* Effect.all(
              ["Runtime.enable", "Accessibility.enable", "Network.enable", "Log.enable"].map(
                (method) =>
                  attemptPromise(
                    { operation: `initializeDebugger.${method}`, webContentsId: wc.id },
                    () => wcDebugger.sendCommand(method),
                  ),
              ),
              { concurrency: "unbounded", discard: true },
            );

            return [
              control,
              replaceMap(sessions, (copy) => {
                copy.set(wc.id, control);
              }),
            ] as const;
          });

          return yield* initialize().pipe(
            Effect.onError(() => Scope.close(scope, Exit.void).pipe(Effect.ignore)),
          );
        });

        return createControlSession();
      },
    );
  });

  // Emulated media lives on the CDP debugger session, not the WebContents, so
  // it is lost whenever the session detaches (webview swap, DevTools
  // open/close) and must be re-applied after every (re)attach.
  const applyColorScheme = Effect.fn("PreviewManager.applyColorScheme")(function* (
    tabId: string,
    wc: Electron.WebContents,
    colorScheme: DesktopPreviewColorScheme,
  ) {
    const control = yield* ensureControlSession(wc);
    yield* attemptPromise({ operation: "applyColorScheme", tabId, webContentsId: wc.id }, () =>
      control.debugger.sendCommand("Emulation.setEmulatedMedia", {
        features: [
          {
            name: "prefers-color-scheme",
            // An empty value clears the override so the page follows the OS.
            value: colorScheme === "system" ? "" : colorScheme,
          },
        ],
      }),
    );
  });

  // Re-establish the control session after a detach, restoring any
  // color-scheme override the tab carries. The scheme is read after the
  // session attaches so a concurrent setColorScheme is not overwritten with
  // a stale snapshot.
  const restoreControlSession = (tabId: string, wc: Electron.WebContents) =>
    Effect.gen(function* () {
      const beforeAttach = (yield* SynchronizedRef.get(tabsRef)).get(tabId);

      if (beforeAttach?.webContentsId !== wc.id) return;
      const control = yield* ensureControlSession(wc);
      const afterAttach = (yield* SynchronizedRef.get(tabsRef)).get(tabId);

      if (afterAttach?.webContentsId !== wc.id) {
        yield* detachControlSession(wc.id);

        return;
      }

      if (afterAttach.colorScheme !== "system") {
        yield* attemptPromise({ operation: "applyColorScheme", tabId, webContentsId: wc.id }, () =>
          control.debugger.sendCommand("Emulation.setEmulatedMedia", {
            features: [
              {
                name: "prefers-color-scheme",
                value: afterAttach.colorScheme,
              },
            ],
          }),
        );
      }
    }).pipe(Effect.ignore);

  return { detachControlSession, applyColorScheme, restoreControlSession };
};
