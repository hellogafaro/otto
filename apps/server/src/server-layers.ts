import * as Layer from "effect/Layer";
import * as BackgroundPolicy from "./background/background-policy.ts";
import { ChannelRuntime } from "./channels/channel-runtime.ts";
import * as HostPowerMonitor from "./background/host-power-monitor.ts";
import * as ExternalLauncher from "./process/external-launcher.ts";
import { layerConfig as SqlitePersistenceLayerLive } from "./persistence/layers/sqlite.ts";
import * as ServerLifecycleEvents from "./server-lifecycle-events.ts";
import { ProviderSessionDirectoryLive } from "./provider/layers/provider-session-directory.ts";
import * as ProviderSessionRuntime from "./persistence/provider-session-runtime.ts";
import { ProviderAdapterRegistryLive } from "./provider/layers/provider-adapter-registry.ts";
import * as ModelCatalog from "./provider/model-catalog.ts";
import * as ProviderEventLoggers from "./provider/layers/provider-event-loggers.ts";
import { AgentControllerLive } from "./provider/layers/agent-controller.ts";
import { LegacyProviderBridgeLive } from "./provider/layers/legacy-provider-bridge.ts";
import { ProviderServiceLive } from "./provider/layers/provider-service.ts";
import { ProviderSessionReaperLive } from "./provider/layers/provider-session-reaper.ts";
import * as OpenCodeRuntime from "./provider/opencode-runtime.ts";
import * as CheckpointDiffQuery from "./checkpointing/checkpoint-diff-query.ts";
import * as CheckpointStore from "./checkpointing/checkpoint-store.ts";
import * as TextGeneration from "./text-generation/text-generation.ts";
import * as ProviderUsageHistory from "./usage/provider-usage-history.ts";
import { ProviderInstanceRegistryHydrationLive } from "./provider/layers/provider-instance-registry-hydration.ts";
import * as McpSessionRegistry from "./mcp/mcp-session-registry.ts";
import * as PreviewManager from "./preview/manager.ts";
import * as PortScanner from "./preview/port-scanner.ts";
import * as ProcessRunner from "./process-runner.ts";
import * as Keybindings from "./keybindings.ts";
import { OrchestrationReactorLive } from "./orchestration/layers/orchestration-reactor.ts";
import { RuntimeReceiptBusLive } from "./orchestration/layers/runtime-receipt-bus.ts";
import { ProviderRuntimeIngestionLive } from "./orchestration/layers/provider-runtime-ingestion.ts";
import { ProviderCommandReactorLive } from "./orchestration/layers/provider-command-reactor.ts";
import { CheckpointReactorLive } from "./orchestration/layers/checkpoint-reactor.ts";
import { ThreadDeletionReactorLive } from "./orchestration/layers/thread-deletion-reactor.ts";
import { GroupRoundReactorLive } from "./orchestration/layers/group-round-reactor.ts";
import { ProviderRegistryLive } from "./provider/layers/provider-registry.ts";
import * as ServerSettings from "./server-settings.ts";
import * as RepositoryIdentityResolver from "./project/repository-identity-resolver.ts";
import * as WorkspaceEntries from "./workspace/workspace-entries.ts";
import * as WorkspaceFileSystem from "./workspace/workspace-file-system.ts";
import * as WorkspacePaths from "./workspace/workspace-paths.ts";
import * as GitVcsDriver from "./vcs/git-vcs-driver.ts";
import * as VcsDriverRegistry from "./vcs/vcs-driver-registry.ts";
import * as VcsProjectConfig from "./vcs/vcs-project-config.ts";
import * as GitWorkflowService from "./git/git-workflow-service.ts";
import { ObservabilityLive } from "./observability/layers/observability.ts";
import * as ServerEnvironment from "./environment/server-environment.ts";
import * as RemoteOpenTargets from "./environment/remote-open-targets.ts";
import * as ServerSecretStore from "./auth/server-secret-store.ts";
import * as EnvironmentAuth from "./auth/environment-auth.ts";
import * as Composio from "./composio/composio-service.ts";
import * as ProcessDiagnostics from "./diagnostics/process-diagnostics.ts";
import * as ProcessResourceMonitor from "./diagnostics/process-resource-monitor.ts";
import * as TraceDiagnostics from "./diagnostics/trace-diagnostics.ts";
import * as DesktopTelemetryReceiver from "./resource-telemetry/desktop-telemetry-receiver.ts";
import * as NativeTelemetryClient from "./resource-telemetry/native-telemetry-client.ts";
import * as ResourceAttribution from "./resource-telemetry/resource-attribution.ts";
import * as ResourceMonitorBinary from "./resource-telemetry/resource-monitor-binary.ts";
import * as ResourceTelemetry from "./resource-telemetry/resource-telemetry.ts";
import * as UsageService from "./usage/usage-service.ts";
import { EntityMemoryRepositoryLive } from "./memory/layers/entity-memory-repository.ts";
import { MemoryRevisionWriteLockLive } from "./memory/services/memory-revision-write-lock.ts";
import { OrchestrationLayerLive } from "./orchestration/runtime-layer.ts";
import * as NetService from "@otto/shared/Net";
import { RoutineLayerLive } from "./routines/layer.ts";
import * as ImageGenerationRuntime from "./image-generation/image-generation-runtime.ts";
import * as LibraryToolRuntime from "./library/library-tool-runtime.ts";
import * as TaskToolRuntime from "./tasks/task-tool-runtime.ts";
import { RoutineDraftDispatcherLive } from "./routines/routine-draft-dispatcher.ts";
import { MemoryApprovalsLive } from "./memory/memory-approvals.ts";

export const ResourceAttributionLayerLive = ResourceAttribution.layer;

export const ApplicationObservabilityLive = ObservabilityLive.pipe(
  Layer.provideMerge(ResourceAttributionLayerLive),
);

export const ServerSettingsLayerLive = ServerSettings.layer.pipe(
  Layer.provide(ServerSecretStore.layer),
  Layer.provideMerge(SqlitePersistenceLayerLive),
);

export const NativeTelemetryLayerLive = NativeTelemetryClient.layer.pipe(
  Layer.provide(ResourceMonitorBinary.layer),
);

export const DesktopTelemetryReceiverLayerLive = DesktopTelemetryReceiver.layer.pipe(
  Layer.provideMerge(ServerSettingsLayerLive),
);

export const ResourceTelemetryLayerLive = ResourceTelemetry.layer.pipe(
  Layer.provideMerge(NativeTelemetryLayerLive),
  Layer.provideMerge(DesktopTelemetryReceiverLayerLive),
);

export const HostPowerMonitorLayerLive = HostPowerMonitor.layer.pipe(
  Layer.provide(DesktopTelemetryReceiverLayerLive),
);

export const BackgroundLayerLive = BackgroundPolicy.layer.pipe(
  Layer.provide(HostPowerMonitorLayerLive),
  Layer.provideMerge(ServerSettingsLayerLive),
);

export const ProviderUsageHistoryLayerLive = ProviderUsageHistory.layer.pipe(
  Layer.provide(SqlitePersistenceLayerLive),
);

export const UsageLayerLive = UsageService.layer.pipe(Layer.provide(ProviderUsageHistoryLayerLive));

export const ResourceDiagnosticsLayerLive = Layer.mergeAll(
  ResourceTelemetryLayerLive,
  ProcessDiagnostics.layer.pipe(Layer.provide(ResourceTelemetryLayerLive)),
  ProcessResourceMonitor.layer.pipe(Layer.provide(ResourceTelemetryLayerLive)),
);

export const ReactorLayerLive = Layer.empty.pipe(
  Layer.provideMerge(OrchestrationReactorLive),
  Layer.provideMerge(ProviderRuntimeIngestionLive),
  Layer.provideMerge(ProviderCommandReactorLive),
  Layer.provideMerge(CheckpointReactorLive),
  Layer.provideMerge(ThreadDeletionReactorLive),
  Layer.provideMerge(GroupRoundReactorLive),
  Layer.provideMerge(RuntimeReceiptBusLive),
  // Channel transports live in this runtime's scope. Ingestion, startup, commands,
  // and the webhook route all resolve the same instance.
  Layer.provideMerge(ChannelRuntime.layer),
);

export const ProviderSessionDirectoryLayerLive = ProviderSessionDirectoryLive.pipe(
  Layer.provide(ProviderSessionRuntime.layer),
);

// `ProviderAdapterRegistryLive` is now a facade that resolves kind → adapter
// by looking up the default `ProviderInstance` per driver in the instance
// registry. Adapter construction itself moved inside each driver's
// `create()`; `ProviderEventLoggers.layer` owns the shared native/canonical
// NDJSON writers and is provided at the outer runtime layer so both
// `ProviderService` and the per-instance drivers read the same logger pair.
export const ProviderServiceLayerLive = ProviderServiceLive.pipe(
  Layer.provide(ProviderAdapterRegistryLive),
  Layer.provideMerge(ProviderSessionDirectoryLayerLive),
);

export const LegacyProviderLayerLive = LegacyProviderBridgeLive.pipe(
  Layer.provide(ProviderServiceLayerLive),
);

export const PersistenceLayerLive = Layer.empty.pipe(
  Layer.provideMerge(SqlitePersistenceLayerLive),
);

export const McpSessionRegistryLayerLive = McpSessionRegistry.layer;

export const RuntimeMemoryRepositoriesLive = EntityMemoryRepositoryLive.pipe(
  Layer.provide(MemoryRevisionWriteLockLive),
);

export const RuntimeMemoryRepositoriesWithPersistenceLive = RuntimeMemoryRepositoriesLive.pipe(
  Layer.provideMerge(PersistenceLayerLive),
);

export const MemoryApprovalsLayerLive = MemoryApprovalsLive.pipe(
  Layer.provide(OrchestrationLayerLive),
  Layer.provide(RuntimeMemoryRepositoriesWithPersistenceLive),
);

export const ProviderLayerLive = AgentControllerLive.pipe(
  Layer.provide(LegacyProviderLayerLive),
  Layer.provide(RuntimeMemoryRepositoriesWithPersistenceLive),
  Layer.provide(MemoryApprovalsLayerLive),
  Layer.provide(RoutineDraftDispatcherLive.pipe(Layer.provide(OrchestrationLayerLive))),
);

export const VcsDriverRegistryLayerLive = VcsDriverRegistry.layer.pipe(
  Layer.provide(VcsProjectConfig.layer),
);

export const GitLayerLive = Layer.empty.pipe(
  Layer.provideMerge(GitVcsDriver.layer),
  Layer.provideMerge(TextGeneration.layer),
);

export const GitWorkflowLayerLive = GitWorkflowService.layer.pipe(
  Layer.provideMerge(VcsDriverRegistryLayerLive),
  Layer.provideMerge(GitLayerLive),
);

export const VcsLayerLive = Layer.empty.pipe(
  Layer.provideMerge(VcsProjectConfig.layer),
  Layer.provideMerge(VcsDriverRegistryLayerLive),
  Layer.provideMerge(GitWorkflowLayerLive),
);

export const CheckpointingLayerLive = Layer.empty.pipe(
  Layer.provideMerge(CheckpointDiffQuery.layer),
  Layer.provideMerge(CheckpointStore.layer.pipe(Layer.provide(VcsDriverRegistryLayerLive))),
);

export const PortScannerLayerLive = PortScanner.layer.pipe(Layer.provide(ProcessRunner.layer));

export const PreviewLayerLive = Layer.empty.pipe(
  Layer.provideMerge(PreviewManager.layer),
  Layer.provideMerge(PortScannerLayerLive),
);

export const WorkspaceEntriesLayerLive = WorkspaceEntries.layer.pipe(
  Layer.provide(WorkspacePaths.layer),
);

export const WorkspaceFileSystemLayerLive = WorkspaceFileSystem.layer.pipe(
  Layer.provide(WorkspacePaths.layer),
  Layer.provide(WorkspaceEntriesLayerLive),
);

export const WorkspaceLayerLive = Layer.mergeAll(
  WorkspacePaths.layer,
  WorkspaceEntriesLayerLive,
  WorkspaceFileSystemLayerLive,
);

export const ServerEnvironmentLayerLive = ServerEnvironment.layer;

export const AuthLayerLive = EnvironmentAuth.layer.pipe(
  Layer.provideMerge(PersistenceLayerLive),
  Layer.provide(ServerEnvironmentLayerLive),
  Layer.provide(ServerSecretStore.layer),
);

export const ProviderRuntimeLayerLive = ProviderSessionReaperLive.pipe(
  Layer.provideMerge(ProviderSessionDirectoryLayerLive),
  Layer.provideMerge(ProviderLayerLive),
  Layer.provideMerge(MemoryApprovalsLayerLive),
  Layer.provideMerge(OrchestrationLayerLive),
);

export const RuntimeCoreDependenciesLive = ReactorLayerLive.pipe(
  // Core Services
  Layer.provideMerge(McpSessionRegistryLayerLive),
  Layer.provideMerge(ServerSettingsLayerLive),
  Layer.provideMerge(CheckpointingLayerLive),
  Layer.provideMerge(GitLayerLive),
  Layer.provideMerge(VcsLayerLive),
  Layer.provideMerge(ProviderRuntimeLayerLive),
  Layer.provideMerge(PreviewLayerLive),
  Layer.provideMerge(RuntimeMemoryRepositoriesWithPersistenceLive),
  Layer.provideMerge(Keybindings.layer),
  Layer.provideMerge(ProviderRegistryLive),
  // The instance registry is the new routing keystone — text generation,
  // adapter lookup, and runtime ingestion all resolve `ProviderInstanceId`
  // through this layer. Built-in drivers come from `BUILT_IN_DRIVERS`;
  // `providerInstances` hydration merges `settings.providers.<kind>`
  // with explicit `providerInstances` entries on boot.
  Layer.provideMerge(ProviderInstanceRegistryHydrationLive),
  // Shared native/canonical NDJSON writers used by both the per-instance
  // drivers (native stream, written from inside each `<X>Adapter`) and
  // `ProviderService` (canonical stream, written after event normalization).
  // Provided once at the runtime level so every consumer sees the same
  // logger instances.
  // `ModelCatalog.layer` holds the provider model lists, names, and legacy
  // classification, refreshed from models.dev and applied by the drivers.
  Layer.provideMerge(Layer.mergeAll(ProviderEventLoggers.layer, ModelCatalog.layer)),
  // `OpenCodeDriver.create()` yields `OpenCodeRuntime`; previously the old
  // `ProviderRegistryLive` pulled `OpenCodeRuntimeLive` in for itself, but
  // the rewritten registry reads snapshots off the instance registry and
  // no longer transitively provides it. Exposing it at the runtime level
  // keeps a single Live for all opencode consumers.
  Layer.provideMerge(OpenCodeRuntime.OpenCodeRuntimeLive),
  Layer.provideMerge(WorkspaceLayerLive),
  Layer.provideMerge(RepositoryIdentityResolver.layer),
  Layer.provideMerge(ServerEnvironmentLayerLive),
  Layer.provideMerge(AuthLayerLive),
  Layer.provideMerge(
    Layer.mergeAll(
      ServerSecretStore.layer,
      Composio.layer.pipe(Layer.provide(ServerSecretStore.layer)),
    ),
  ),
);

export const RuntimeCoreWithRoutinesLive = Layer.mergeAll(
  RuntimeCoreDependenciesLive,
  RoutineLayerLive.pipe(Layer.provide(RuntimeCoreDependenciesLive)),
  ImageGenerationRuntime.layer.pipe(Layer.provide(RuntimeCoreDependenciesLive)),
  LibraryToolRuntime.layer.pipe(Layer.provide(RuntimeCoreDependenciesLive)),
  TaskToolRuntime.layer.pipe(Layer.provide(RuntimeCoreDependenciesLive)),
);

export const RuntimeDependenciesLive = RuntimeCoreWithRoutinesLive.pipe(
  // Misc.
  Layer.provideMerge(BackgroundLayerLive),
  Layer.provideMerge(ResourceDiagnosticsLayerLive),
  Layer.provideMerge(UsageLayerLive),
  Layer.provideMerge(TraceDiagnostics.layer),
  Layer.provideMerge(ExternalLauncher.layer),
  Layer.provideMerge(RemoteOpenTargets.layer),
  Layer.provideMerge(ServerLifecycleEvents.layer),
  Layer.provide(NetService.layer),
);
