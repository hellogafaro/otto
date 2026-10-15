import { GrokSettings, ProviderDriverKind, type ServerProvider } from "@otto/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as BackgroundPolicy from "../../background/background-policy.ts";
import { ServerConfig } from "../../config.ts";
import { instanceUsesSavedCredential } from "../../subscription-auth/runtime.ts";
import { ServerSettingsService } from "../../server-settings.ts";
import { makeHarnessTextGeneration } from "../../text-generation/harness-text-generation.ts";
import { ProviderDriverError } from "../errors.ts";
import { makeHarnessProviderStatus } from "../harness-provider-status.ts";
import * as ModelCatalog from "../model-catalog.ts";
import { buildInitialGrokProviderSnapshot, enrichGrokSnapshot } from "../layers/grok-provider.ts";
import { discoverGrokSkills } from "./grok-skills.ts";
import { ProviderEventLoggers } from "../layers/provider-event-loggers.ts";
import { makeManagedServerProvider } from "../make-managed-server-provider.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../provider-driver.ts";
import { isCommandMissingCause, type ServerProviderDraft } from "../provider-snapshot.ts";
import { explicitProviderInstanceEnvironment } from "../provider-instance-environment.ts";
import { mergeSubscriptionInstanceEnvironment } from "../../subscription-auth/runtime.ts";
import {
  manualOnlyProviderMaintenanceCapabilities,
  staticProviderMaintenanceResolver,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "../provider-maintenance.ts";
import {
  haveProviderSnapshotSettingsChanged,
  providerSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "../provider-update-settings.ts";

const decodeGrokSettings = Schema.decodeSync(GrokSettings);

const DRIVER_KIND = ProviderDriverKind.make("grok");

const UPDATE = staticProviderMaintenanceResolver(
  manualOnlyProviderMaintenanceCapabilities({
    provider: DRIVER_KIND,
    packageName: null,
  }),
);

export type GrokDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | ModelCatalog.ModelCatalog
  | Path.Path
  | ProviderEventLoggers
  | ServerConfig
  | ServerSettingsService;

const withInstanceIdentity =
  (input: {
    readonly instanceId: ProviderInstance["instanceId"];
    readonly displayName: string | undefined;
    readonly accentColor: string | undefined;
    readonly continuationGroupKey: string;
  }) =>
  (snapshot: ServerProviderDraft): ServerProvider => ({
    ...snapshot,
    instanceId: input.instanceId,
    driver: DRIVER_KIND,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    continuation: { groupKey: input.continuationGroupKey },
  });

export const GrokDriver: ProviderDriver<GrokSettings, GrokDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Grok",
    supportsMultipleInstances: true,
  },
  configSchema: GrokSettings,
  defaultConfig: (): GrokSettings => decodeGrokSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const httpClient = yield* HttpClient.HttpClient;
      const serverSettings = yield* ServerSettingsService;
      const { secretsDir } = yield* ServerConfig;
      const processEnv = mergeSubscriptionInstanceEnvironment(environment);

      const continuationIdentity = defaultProviderContinuationIdentity({
        driverKind: DRIVER_KIND,
        instanceId,
      });

      const stampIdentity = withInstanceIdentity({
        instanceId,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });

      const effectiveConfig = { ...config, enabled } satisfies GrokSettings;

      const connection = {
        environment: processEnv,
        instanceEnvironment: explicitProviderInstanceEnvironment(environment),
        useSavedCredential: instanceUsesSavedCredential("xai", {
          driver: DRIVER_KIND,
          environment,
          config,
        }),
      };

      const maintenanceCapabilities = yield* resolveProviderMaintenanceCapabilitiesEffect(UPDATE, {
        binaryPath: effectiveConfig.binaryPath,
        env: processEnv,
      });

      const adapter = undefined;

      const textGeneration = yield* makeHarnessTextGeneration({
        secretsDir,
        driver: DRIVER_KIND,
        instanceId,
        connection,
      });

      const checkProvider = (yield* makeHarnessProviderStatus({
        secretsDir,
        provider: "xai",
        driver: DRIVER_KIND,
        instanceId,
        connection,
        draft: buildInitialGrokProviderSnapshot(effectiveConfig),
      })).checkProvider.pipe(Effect.map(stampIdentity));

      const snapshotSettings = providerSnapshotSettingsSource(effectiveConfig, serverSettings);

      const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<GrokSettings>>({
        maintenanceCapabilities,
        getSettings: snapshotSettings.getSettings,
        streamSettings: snapshotSettings.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: () => checkProvider,
        checkProvider,
        enrichSnapshot: ({ settings, snapshot: currentSnapshot, publishSnapshot }) =>
          enrichGrokSnapshot({
            snapshot: currentSnapshot,
            maintenanceCapabilities,
            enableProviderUpdateChecks: settings.enableProviderUpdateChecks,
            publishSnapshot,
            httpClient,
          }),
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build Grok snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      const snapshotForCwd = (workspaceCwd: string) =>
        !effectiveConfig.enabled
          ? snapshot.getSnapshot
          : Effect.all([
              snapshot.getSnapshot,
              discoverGrokSkills(effectiveConfig, processEnv, workspaceCwd).pipe(
                Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
                Effect.catch((error) =>
                  error.stage === "spawn" && isCommandMissingCause(error.cause)
                    ? Effect.succeed([])
                    : Effect.logWarning("Grok skill discovery failed", error).pipe(Effect.as([])),
                ),
              ),
            ]).pipe(Effect.map(([machineSnapshot, skills]) => ({ ...machineSnapshot, skills })));

      return {
        instanceId,
        driverKind: DRIVER_KIND,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        mastraConnection: connection,
        snapshot,
        snapshotForCwd,
        adapter,
        textGeneration,
      } satisfies ProviderInstance;
    }),
};
