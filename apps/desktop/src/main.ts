for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code !== "EPIPE") throw err;
  });
}

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeOS from "node:os";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as Electron from "electron";

import * as NetService from "@otto/shared/Net";
import { HostProcessArchitecture, HostProcessPlatform } from "@otto/shared/hostProcess";
import { resolveRemoteOttoLegacyCliPackageSpec } from "@otto/ssh/command";
import type { RemoteOttoLegacyRunnerOptions } from "@otto/ssh/tunnel";
import serverPackageJson from "../../server/package.json" with { type: "json" };

import * as DesktopIpc from "./ipc/desktop-ipc.ts";
import * as ElectronApp from "./electron/electron-app.ts";
import * as ElectronDialog from "./electron/electron-dialog.ts";
import * as ElectronMenu from "./electron/electron-menu.ts";
import * as ElectronPowerMonitor from "./electron/electron-power-monitor.ts";
import * as ElectronProtocol from "./electron/electron-protocol.ts";
import * as ElectronSafeStorage from "./electron/electron-safe-storage.ts";
import * as ElectronShell from "./electron/electron-shell.ts";
import * as ElectronTheme from "./electron/electron-theme.ts";
import * as ElectronUpdater from "./electron/electron-updater.ts";
import * as ElectronWindow from "./electron/electron-window.ts";
import * as DesktopApp from "./app/desktop-app.ts";
import * as DesktopAppIdentity from "./app/desktop-app-identity.ts";
import * as DesktopConnectionCatalogStore from "./app/desktop-connection-catalog-store.ts";
import * as DesktopApplicationMenu from "./window/desktop-application-menu.ts";
import * as DesktopAssets from "./app/desktop-assets.ts";
import * as DesktopBackendConfiguration from "./backend/desktop-backend-configuration.ts";
import * as DesktopBackendPool from "./backend/desktop-backend-pool.ts";
import * as DesktopLocalEnvironmentAuth from "./backend/desktop-local-environment-auth.ts";
import * as DesktopNetworkInterfaces from "./backend/desktop-network-interfaces.ts";
import * as DesktopEnvironment from "./app/desktop-environment.ts";
import * as DesktopLifecycle from "./app/desktop-lifecycle.ts";
import * as DesktopLinuxUrlHandler from "./app/desktop-linux-url-handler.ts";
import * as DesktopShutdown from "./app/desktop-shutdown.ts";
import * as DesktopObservability from "./app/desktop-observability.ts";
import * as DesktopServerExposure from "./backend/desktop-server-exposure.ts";
import * as DesktopClientSettings from "./settings/desktop-client-settings.ts";
import * as DesktopSavedEnvironments from "./settings/desktop-saved-environments.ts";
import * as DesktopAppSettings from "./settings/desktop-app-settings.ts";
import * as DesktopPreReadyPlatform from "./app/desktop-pre-ready-platform.ts";
import * as DesktopShellEnvironment from "./shell/desktop-shell-environment.ts";
import * as DesktopSshEnvironment from "./ssh/desktop-ssh-environment.ts";
import * as DesktopSshPasswordPrompts from "./ssh/desktop-ssh-password-prompts.ts";
import * as DesktopState from "./app/desktop-state.ts";
import * as DesktopTelemetryPublisher from "./telemetry/desktop-telemetry-publisher.ts";
import * as DesktopUpdates from "./updates/desktop-updates.ts";
import * as BrowserSession from "./preview/browser-session.ts";
import * as PreviewManager from "./preview/manager.ts";
import * as DesktopWindow from "./window/desktop-window.ts";
import * as DesktopWslBackend from "./wsl/desktop-wsl-backend.ts";
import * as DesktopWslEnvironment from "./wsl/desktop-wsl-environment.ts";
import * as DesktopWslServerTree from "./wsl/desktop-wsl-server-tree.ts";

const desktopEnvironmentLayer = Layer.unwrap(
  Effect.gen(function* () {
    const metadata = yield* Effect.service(ElectronApp.ElectronApp).pipe(
      Effect.flatMap((app) => app.metadata),
    );

    const platform = yield* HostProcessPlatform;
    const processArch = yield* HostProcessArchitecture;

    return DesktopEnvironment.layer({
      dirname: __dirname,
      homeDirectory: NodeOS.homedir(),
      platform,
      processArch,
      ...metadata,
    });
  }),
);

const resolveDesktopSshCliRunner = (
  environment: DesktopEnvironment.DesktopEnvironment["Service"],
  settings: DesktopAppSettings.DesktopSettings,
): RemoteOttoLegacyRunnerOptions => {
  const devRemoteEntryPath = Option.getOrUndefined(environment.devRemoteOttoLegacyServerEntryPath);

  if (environment.isDevelopment && devRemoteEntryPath !== undefined) {
    return {
      nodeScriptPath: devRemoteEntryPath,
      nodeEngineRange: serverPackageJson.engines.node,
    };
  }

  return {
    ...(serverPackageJson.private
      ? {}
      : {
          packageSpec: resolveRemoteOttoLegacyCliPackageSpec({
            appVersion: environment.appVersion,
            updateChannel: settings.updateChannel,
            isDevelopment: environment.isDevelopment,
          }),
        }),
    nodeEngineRange: serverPackageJson.engines.node,
  };
};

const desktopSshEnvironmentLayer = Layer.unwrap(
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const settings = yield* DesktopAppSettings.DesktopAppSettings;

    return DesktopSshEnvironment.layer({
      resolveCliRunner: settings.get.pipe(
        Effect.map((currentSettings) => resolveDesktopSshCliRunner(environment, currentSettings)),
      ),
    });
  }),
);

const electronLayer = Layer.mergeAll(
  ElectronApp.layer,
  ElectronDialog.layer,
  ElectronMenu.layer,
  ElectronPowerMonitor.layer,
  ElectronProtocol.layer,
  ElectronSafeStorage.layer,
  ElectronShell.layer,
  ElectronTheme.layer,
  ElectronUpdater.layer,
  ElectronWindow.layer,
  DesktopIpc.layer(Electron.ipcMain),
);

const desktopFoundationLayer = Layer.mergeAll(
  DesktopState.layer,
  DesktopShutdown.layer,
  DesktopAppSettings.layer,
  DesktopClientSettings.layer,
  DesktopConnectionCatalogStore.layer.pipe(Layer.provideMerge(DesktopSavedEnvironments.layer)),
  DesktopAssets.layer,
  DesktopObservability.layer,
).pipe(Layer.provideMerge(desktopEnvironmentLayer));

const desktopSshLayer = desktopSshEnvironmentLayer.pipe(
  Layer.provideMerge(DesktopSshPasswordPrompts.layer()),
);

const desktopServerExposureLayer = DesktopServerExposure.layer.pipe(
  Layer.provideMerge(DesktopNetworkInterfaces.layer),
  Layer.provideMerge(desktopFoundationLayer),
);

const desktopPreviewLayer = PreviewManager.layer.pipe(
  Layer.provideMerge(BrowserSession.layer),
  Layer.provideMerge(desktopFoundationLayer),
);

const desktopWindowLayer = DesktopWindow.layer.pipe(
  Layer.provideMerge(desktopServerExposureLayer),
  Layer.provideMerge(desktopPreviewLayer),
);

// Pool layer instantiates the backend factory once for the Windows
// primary instance and exposes it via pool.primary. Consumers go through
// the pool now; the legacy DesktopBackendManager service is gone. The
// WSL second instance gets registered later in the migration. See
// desktop-backend-pool.ts header for the full rollout plan.
const desktopBackendLayer = DesktopBackendPool.layer.pipe(
  Layer.provideMerge(DesktopAppIdentity.layer),
  Layer.provideMerge(DesktopBackendConfiguration.layer),
  Layer.provideMerge(DesktopWslEnvironment.layer),
  Layer.provideMerge(DesktopWslServerTree.layer),
  Layer.provideMerge(DesktopTelemetryPublisher.layer),
  Layer.provideMerge(desktopWindowLayer),
);

// WSL orchestrator hangs off the backend layer because it needs the
// pool + configuration + serverExposure; it pulls NetService and the
// foundation services through the same provideMerge chain.
const desktopWslBackendLayer = DesktopWslBackend.layer.pipe(
  Layer.provideMerge(desktopBackendLayer),
);

const desktopLocalEnvironmentAuthLayer = DesktopLocalEnvironmentAuth.layer.pipe(
  Layer.provideMerge(desktopBackendLayer),
);

const desktopApplicationLayer = Layer.mergeAll(
  DesktopLifecycle.layer,
  DesktopApplicationMenu.layer,
  DesktopLinuxUrlHandler.layer,
  DesktopShellEnvironment.layer,
  desktopSshLayer,
).pipe(
  Layer.provideMerge(DesktopUpdates.layer),
  Layer.provideMerge(desktopWslBackendLayer),
  Layer.provideMerge(desktopLocalEnvironmentAuthLayer),
);

const desktopApplicationRuntimeLayer = desktopApplicationLayer.pipe(
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(NodeHttpClient.layerUndici),
  Layer.provideMerge(NetService.layer),
  Layer.provideMerge(electronLayer),
);

const desktopRuntimeLayer = desktopApplicationRuntimeLayer.pipe(
  Layer.provideMerge(DesktopPreReadyPlatform.layer),
);

DesktopApp.program.pipe(
  Effect.ensuring(DesktopShutdown.acknowledgeShutdown),
  Effect.provide(desktopRuntimeLayer),
  NodeRuntime.runMain,
);
