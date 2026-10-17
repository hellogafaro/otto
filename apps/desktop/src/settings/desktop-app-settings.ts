import { type DesktopServerExposureMode, type DesktopUpdateChannel } from "@otto/contracts";

import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as SynchronizedRef from "effect/SynchronizedRef";
import * as DesktopEnvironment from "../app/desktop-environment.ts";

import {
  type DesktopSettings,
  type DesktopWindowBounds,
  type DesktopSettingsChange,
  settingsChange,
  setMainWindowBounds,
  setServerExposureMode,
  setServerUrl,
  setTailscaleServe,
  setUpdateChannel,
  setWslBackendEnabled,
  setWslDistro,
  setWslOnly,
  applyWslWindowsFallback,
  DEFAULT_DESKTOP_SETTINGS,
} from "./desktop-settings-document.ts";
import {
  DesktopSettingsWriteError,
  writeSettings,
  readSettings,
} from "./desktop-settings-persistence.ts";

export type { DesktopSettings } from "./desktop-settings-document.ts";

export type { DesktopSettingsChange } from "./desktop-settings-document.ts";

export { DEFAULT_TAILSCALE_SERVE_PORT } from "./desktop-settings-document.ts";

export { DesktopWindowBoundsSchema } from "./desktop-settings-document.ts";

export type { DesktopWindowBounds } from "./desktop-settings-document.ts";

export { DEFAULT_MAIN_WINDOW_SIZE } from "./desktop-settings-document.ts";

export { DEFAULT_DESKTOP_SETTINGS } from "./desktop-settings-document.ts";

export { resolveDefaultDesktopSettings } from "./desktop-settings-document.ts";

export { normalizeMainWindowBounds, normalizeServerUrl } from "./desktop-settings-document.ts";

export { DesktopSettingsWriteError } from "./desktop-settings-persistence.ts";

export class DesktopAppSettings extends Context.Service<
  DesktopAppSettings,
  {
    readonly load: Effect.Effect<DesktopSettings>;
    readonly get: Effect.Effect<DesktopSettings>;
    readonly setMainWindowBounds: (
      bounds: DesktopWindowBounds,
      isMaximized: boolean,
    ) => Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError>;
    readonly setServerExposureMode: (
      mode: DesktopServerExposureMode,
    ) => Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError>;
    readonly setServerUrl: (
      serverUrl: string | null,
    ) => Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError>;
    readonly setTailscaleServe: (input: {
      readonly enabled: boolean;
      readonly port: Option.Option<number>;
    }) => Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError>;
    readonly setUpdateChannel: (
      channel: DesktopUpdateChannel,
    ) => Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError>;
    readonly setWslBackendEnabled: (
      enabled: boolean,
    ) => Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError>;
    readonly setWslDistro: (
      distro: string | null,
    ) => Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError>;
    readonly setWslOnly: (
      enabled: boolean,
    ) => Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError>;
    readonly applyWslWindowsFallback: Effect.Effect<
      DesktopSettingsChange,
      DesktopSettingsWriteError
    >;
    readonly applyWslWindowsFallbackInMemory: Effect.Effect<DesktopSettingsChange>;
  }
>()("@otto/desktop/settings/desktop-app-settings/DesktopAppSettings") {}

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const settingsRef = yield* SynchronizedRef.make(environment.defaultDesktopSettings);

  const updateInMemory = (update: (settings: DesktopSettings) => DesktopSettings) =>
    SynchronizedRef.modify(settingsRef, (settings) => {
      const nextSettings = update(settings);

      return [settingsChange(nextSettings, nextSettings !== settings), nextSettings] as const;
    });

  const persist = (
    update: (settings: DesktopSettings) => DesktopSettings,
  ): Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError> =>
    SynchronizedRef.modifyEffect(settingsRef, (settings) => {
      const nextSettings = update(settings);

      if (nextSettings === settings) {
        return Effect.succeed([settingsChange(settings, false), settings] as const);
      }

      return crypto.randomUUIDv4.pipe(
        Effect.map((uuid) => uuid.replace(/-/g, "")),
        Effect.mapError(
          (cause) =>
            new DesktopSettingsWriteError({
              operation: "create-temporary-file-name",
              path: environment.desktopSettingsPath,
              cause,
            }),
        ),
        Effect.flatMap((suffix) =>
          writeSettings({
            fileSystem,
            path,
            settingsPath: environment.desktopSettingsPath,
            settings: nextSettings,
            defaultSettings: environment.defaultDesktopSettings,
            suffix,
          }),
        ),
        Effect.as([settingsChange(nextSettings, true), nextSettings] as const),
      );
    });

  return DesktopAppSettings.of({
    get: SynchronizedRef.get(settingsRef),
    load: Effect.gen(function* () {
      const settings = yield* readSettings(
        fileSystem,
        environment.desktopSettingsPath,
        environment.appVersion,
      );

      return yield* SynchronizedRef.setAndGet(settingsRef, settings);
    }).pipe(Effect.withSpan("desktop.settings.load")),
    setMainWindowBounds: (bounds, isMaximized) =>
      persist((settings) => setMainWindowBounds(settings, bounds, isMaximized)).pipe(
        Effect.withSpan("desktop.settings.setMainWindowBounds", {
          attributes: {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            isMaximized,
          },
        }),
      ),
    setServerExposureMode: (mode) =>
      persist((settings) => setServerExposureMode(settings, mode)).pipe(
        Effect.withSpan("desktop.settings.setServerExposureMode", { attributes: { mode } }),
      ),
    setServerUrl: (serverUrl) =>
      persist((settings) => setServerUrl(settings, serverUrl)).pipe(
        Effect.withSpan("desktop.settings.setServerUrl", { attributes: { serverUrl } }),
      ),
    setTailscaleServe: (input) =>
      persist((settings) => setTailscaleServe(settings, input)).pipe(
        Effect.withSpan("desktop.settings.setTailscaleServe", { attributes: input }),
      ),
    setUpdateChannel: (channel) =>
      persist((settings) => setUpdateChannel(settings, channel)).pipe(
        Effect.withSpan("desktop.settings.setUpdateChannel", { attributes: { channel } }),
      ),
    setWslBackendEnabled: (enabled) =>
      persist((settings) => setWslBackendEnabled(settings, enabled)).pipe(
        Effect.withSpan("desktop.settings.setWslBackendEnabled", { attributes: { enabled } }),
      ),
    setWslDistro: (distro) =>
      persist((settings) => setWslDistro(settings, distro)).pipe(
        Effect.withSpan("desktop.settings.setWslDistro", {
          attributes: { distro: distro ?? null },
        }),
      ),
    setWslOnly: (enabled) =>
      persist((settings) => setWslOnly(settings, enabled)).pipe(
        Effect.withSpan("desktop.settings.setWslOnly", { attributes: { enabled } }),
      ),
    applyWslWindowsFallback: persist(applyWslWindowsFallback).pipe(
      Effect.withSpan("desktop.settings.applyWslWindowsFallback"),
    ),
    applyWslWindowsFallbackInMemory: updateInMemory(applyWslWindowsFallback).pipe(
      Effect.withSpan("desktop.settings.applyWslWindowsFallbackInMemory"),
    ),
  });
});

export const layer = Layer.effect(DesktopAppSettings, make);

export const layerTest = (initialSettings: DesktopSettings = DEFAULT_DESKTOP_SETTINGS) =>
  Layer.effect(
    DesktopAppSettings,
    Effect.gen(function* () {
      const settingsRef = yield* SynchronizedRef.make(initialSettings);

      const update = (f: (settings: DesktopSettings) => DesktopSettings) =>
        SynchronizedRef.modify(settingsRef, (settings) => {
          const nextSettings = f(settings);

          return [
            {
              settings: nextSettings,
              changed: nextSettings !== settings,
            },
            nextSettings,
          ] as const;
        });

      return DesktopAppSettings.of({
        get: SynchronizedRef.get(settingsRef),
        load: SynchronizedRef.get(settingsRef),
        setMainWindowBounds: (bounds, isMaximized) =>
          update((settings) => setMainWindowBounds(settings, bounds, isMaximized)),
        setServerExposureMode: (mode) =>
          update((settings) => setServerExposureMode(settings, mode)),
        setServerUrl: (serverUrl) => update((settings) => setServerUrl(settings, serverUrl)),
        setTailscaleServe: (input) => update((settings) => setTailscaleServe(settings, input)),
        setUpdateChannel: (channel) => update((settings) => setUpdateChannel(settings, channel)),
        setWslBackendEnabled: (enabled) =>
          update((settings) => setWslBackendEnabled(settings, enabled)),
        setWslDistro: (distro) => update((settings) => setWslDistro(settings, distro)),
        setWslOnly: (enabled) => update((settings) => setWslOnly(settings, enabled)),
        applyWslWindowsFallback: update(applyWslWindowsFallback),
        applyWslWindowsFallbackInMemory: update(applyWslWindowsFallback),
      });
    }),
  );
