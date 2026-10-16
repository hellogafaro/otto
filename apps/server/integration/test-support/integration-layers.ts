import * as Schema from "effect/Schema";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CodexSettings, ProviderDriverKind } from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as CheckpointStore from "../../src/checkpointing/checkpoint-store.ts";
import { TextGeneration } from "../../src/text-generation/text-generation.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../src/persistence/layers/orchestration-command-receipts.ts";
import { OrchestrationEventStoreLive } from "../../src/persistence/layers/orchestration-event-store.ts";
import { ProjectionBotRepositoryLive } from "../../src/persistence/layers/projection-bots.ts";
import { ProjectionThreadMessageRepositoryLive } from "../../src/persistence/layers/projection-thread-messages.ts";
import { ProjectionTurnRepositoryLive } from "../../src/persistence/layers/projection-turns.ts";
import { ProjectionCheckpointRepositoryLive } from "../../src/persistence/layers/projection-checkpoints.ts";
import { ProjectionPendingApprovalRepositoryLive } from "../../src/persistence/layers/projection-pending-approvals.ts";
import { ProviderSessionRuntimeRepositoryLive } from "../../src/persistence/layers/provider-session-runtime.ts";
import { sqlitePersistenceLayer } from "../../src/persistence/layers/sqlite.ts";
import { adapterRegistryMock } from "../../src/provider/test-utils/provider-adapter-registry-mock.ts";
import { ProviderAdapterRegistry } from "../../src/provider/services/provider-adapter-registry.ts";
import { makeProviderRegistryLayer } from "../../src/provider/test-utils/provider-registry-mock.ts";
import { ProviderSessionDirectoryLive } from "../../src/provider/layers/provider-session-directory.ts";
import { ServerSettingsService } from "../../src/server-settings.ts";
import { agentControllerLayerWith } from "../../src/provider/layers/agent-controller.ts";
import { EntityMemoryRepository } from "../../src/memory/services/entity-memory-repository.ts";
import { type TestMastraHarness } from "../test-mastra-harness.integration.ts";
import { EntityMemoryRepositoryLive } from "../../src/memory/layers/entity-memory-repository.ts";
import { MemoryRevisionWriteLockLive } from "../../src/memory/services/memory-revision-write-lock.ts";
import { LegacyProviderBridgeLive } from "../../src/provider/layers/legacy-provider-bridge.ts";
import { ProviderServiceLive } from "../../src/provider/layers/provider-service.ts";
import { makeCodexAdapter } from "../../src/provider/layers/codex-adapter.ts";
import {
  NoOpProviderEventLoggers,
  ProviderEventLoggers,
} from "../../src/provider/layers/provider-event-loggers.ts";
import { CheckpointReactorLive } from "../../src/orchestration/layers/checkpoint-reactor.ts";
import * as RepositoryIdentityResolver from "../../src/project/repository-identity-resolver.ts";
import { OrchestrationEngineLive } from "../../src/orchestration/layers/orchestration-engine.ts";
import { OrchestrationProjectionPipelineLive } from "../../src/orchestration/layers/projection-pipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../../src/orchestration/layers/projection-snapshot-query.ts";
import * as ThreadBackgroundLiveness from "../../src/orchestration/thread-background-liveness.ts";
import * as ThreadPlanProgress from "../../src/orchestration/thread-plan-progress.ts";
import { RuntimeReceiptBusTest } from "../../src/orchestration/layers/runtime-receipt-bus.ts";
import { OrchestrationReactorLive } from "../../src/orchestration/layers/orchestration-reactor.ts";
import { ProviderCommandReactorLive } from "../../src/orchestration/layers/provider-command-reactor.ts";
import { ProviderRuntimeIngestionLive } from "../../src/orchestration/layers/provider-runtime-ingestion.ts";
import { ThreadDeletionReactor } from "../../src/orchestration/services/thread-deletion-reactor.ts";
import { GroupRoundReactor } from "../../src/orchestration/services/group-round-reactor.ts";
import { TaskWorkReactor } from "../../src/tasks/task-work-reactor.ts";
import { NotificationReactor } from "../../src/notifications/notification-reactor.ts";
import { type TestProviderAdapterHarness } from "../test-provider-adapter.integration.ts";
import { ServerConfig } from "../../src/config.ts";
import * as WorkspaceEntries from "../../src/workspace/workspace-entries.ts";
import * as WorkspacePaths from "../../src/workspace/workspace-paths.ts";
import * as VcsDriverRegistry from "../../src/vcs/vcs-driver-registry.ts";
import * as GitVcsDriver from "../../src/vcs/git-vcs-driver.ts";
import { GitWorkflowService } from "../../src/git/git-workflow-service.ts";
import * as VcsProcess from "../../src/vcs/vcs-process.ts";
import { BotUsageLedgerLive } from "../../src/usage/bot-usage-ledger.ts";

const decodeCodexSettings = Schema.decodeEffect(CodexSettings);

export function createIntegrationLayers({
  adapterHarness,
  mastraHarness,
  useRealCodex,
  dbPath,
  rootDir,
  workspaceDir,
}: {
  adapterHarness: TestProviderAdapterHarness | null;
  mastraHarness: TestMastraHarness | null;
  useRealCodex: boolean;
  dbPath: string;
  rootDir: string;
  workspaceDir: string;
}) {
  const fakeRegistry = adapterHarness
    ? Layer.succeed(
        ProviderAdapterRegistry,
        adapterRegistryMock({ [adapterHarness.provider]: adapterHarness.adapter }),
      )
    : null;

  const persistenceLayer = sqlitePersistenceLayer(dbPath);

  const memoryRepositoriesLayer = EntityMemoryRepositoryLive.pipe(
    Layer.provide(MemoryRevisionWriteLockLive),
    Layer.provide(persistenceLayer),
  );

  const orchestrationLayer = OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionPipelineLive),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
  );

  const providerSessionDirectoryLayer = ProviderSessionDirectoryLive.pipe(
    Layer.provide(ProviderSessionRuntimeRepositoryLive),
  );

  const realCodexRegistry = Layer.effect(
    ProviderAdapterRegistry,
    Effect.gen(function* () {
      const codexSettings = yield* decodeCodexSettings({});
      const codexAdapter = yield* makeCodexAdapter(codexSettings);

      return adapterRegistryMock({
        [ProviderDriverKind.make("codex")]: codexAdapter,
      });
    }),
  ).pipe(
    Layer.provideMerge(ServerConfig.layerTest(workspaceDir, rootDir)),
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(providerSessionDirectoryLayer),
  );

  const providerEventLoggersLayer = Layer.succeed(ProviderEventLoggers, NoOpProviderEventLoggers);

  const providerLayer = useRealCodex
    ? ProviderServiceLive.pipe(
        Layer.provide(providerSessionDirectoryLayer),
        Layer.provide(realCodexRegistry),
        Layer.provide(providerEventLoggersLayer),
      )
    : ProviderServiceLive.pipe(
        Layer.provide(providerSessionDirectoryLayer),
        Layer.provide(fakeRegistry!),
        Layer.provide(providerEventLoggersLayer),
      );

  const legacyProviderLayer = LegacyProviderBridgeLive.pipe(Layer.provide(providerLayer));

  const agentControllerLayer = Layer.unwrap(
    Effect.map(Effect.service(EntityMemoryRepository), (entityMemoryRepository) =>
      agentControllerLayerWith({
        entityMemoryRepository,
        ...(mastraHarness ? { makeMastraHarness: mastraHarness.factory } : {}),
      }),
    ),
  ).pipe(
    Layer.provide(memoryRepositoriesLayer),
    Layer.provide(legacyProviderLayer),
    Layer.provide(BotUsageLedgerLive),
    Layer.provide(ProjectionThreadMessageRepositoryLive),
    Layer.provide(ProjectionTurnRepositoryLive),
  );

  const providerRegistryLayer = makeProviderRegistryLayer();

  const checkpointStoreLayer = CheckpointStore.layer.pipe(Layer.provide(VcsDriverRegistry.layer));

  const projectionSnapshotQueryLayer = OrchestrationProjectionSnapshotQueryLive;

  const runtimeServicesLayer = Layer.mergeAll(
    projectionSnapshotQueryLayer,
    orchestrationLayer.pipe(Layer.provide(projectionSnapshotQueryLayer)),
    ProjectionBotRepositoryLive,
    ProjectionCheckpointRepositoryLive,
    ProjectionPendingApprovalRepositoryLive,
    BotUsageLedgerLive,
    checkpointStoreLayer,
    agentControllerLayer,
    RuntimeReceiptBusTest,
  ).pipe(
    Layer.provideMerge(ThreadBackgroundLiveness.layer),
    Layer.provideMerge(ThreadPlanProgress.layer),
  );

  const serverSettingsLayer = ServerSettingsService.layerTest();

  const runtimeIngestionLayer = ProviderRuntimeIngestionLive.pipe(
    Layer.provideMerge(runtimeServicesLayer),
    Layer.provideMerge(serverSettingsLayer),
  );

  const gitWorkflowLayer = Layer.mock(GitWorkflowService)({
    renameBranch: (input: {
      readonly cwd: string;
      readonly oldBranch: string;
      readonly newBranch: string;
    }) => Effect.succeed({ branch: input.newBranch }),
  });

  const textGenerationLayer = Layer.mock(TextGeneration)({
    generateBranchName: () => Effect.succeed({ branch: "update" }),
    generateThreadTitle: () => Effect.succeed({ title: "New thread" }),
  });

  const providerCommandReactorLayer = ProviderCommandReactorLive.pipe(
    Layer.provideMerge(runtimeServicesLayer),
    Layer.provideMerge(gitWorkflowLayer),
    Layer.provideMerge(textGenerationLayer),
    Layer.provideMerge(serverSettingsLayer),
  );

  const checkpointReactorLayer = CheckpointReactorLive.pipe(
    Layer.provideMerge(runtimeServicesLayer),
    Layer.provideMerge(
      Layer.mock(GitVcsDriver.GitVcsDriver)({
        statusDetailsLocal: () =>
          Effect.succeed({
            isRepo: true,
            hasOriginRemote: false,
            isDefaultBranch: true,
            branch: "main",
            upstreamRef: null,
            hasWorkingTreeChanges: false,
            workingTree: { files: [], insertions: 0, deletions: 0 },
            hasUpstream: false,
            aheadCount: 0,
            behindCount: 0,
            aheadOfDefaultCount: 0,
          }),
      }),
    ),
    Layer.provideMerge(
      WorkspaceEntries.layer.pipe(
        Layer.provide(WorkspacePaths.layer),
        Layer.provideMerge(VcsDriverRegistry.layer),
        Layer.provide(NodeServices.layer),
      ),
    ),
    Layer.provideMerge(WorkspacePaths.layer),
    Layer.provideMerge(VcsProcess.layer),
  );

  const orchestrationReactorLayer = OrchestrationReactorLive.pipe(
    Layer.provideMerge(runtimeIngestionLayer),
    Layer.provideMerge(providerCommandReactorLayer),
    Layer.provideMerge(checkpointReactorLayer),
    Layer.provideMerge(
      Layer.succeed(ThreadDeletionReactor, {
        start: () => Effect.void,
        drain: Effect.void,
        drainThrough: () => Effect.void,
      }),
    ),
    Layer.provideMerge(
      Layer.succeed(GroupRoundReactor, { start: () => Effect.void, drain: Effect.void }),
    ),
    Layer.provideMerge(
      Layer.succeed(TaskWorkReactor, { start: () => Effect.void, drain: Effect.void }),
    ),
    Layer.provideMerge(
      Layer.succeed(NotificationReactor, { start: () => Effect.void, drain: Effect.void }),
    ),
  );

  const layer = Layer.empty.pipe(
    Layer.provideMerge(runtimeServicesLayer),
    Layer.provideMerge(orchestrationReactorLayer),
    Layer.provideMerge(providerRegistryLayer),
    Layer.provide(persistenceLayer),
    Layer.provideMerge(RepositoryIdentityResolver.layer),
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(ServerConfig.layerTest(workspaceDir, rootDir)),
    Layer.provideMerge(NodeServices.layer),
  );

  return layer;
}
