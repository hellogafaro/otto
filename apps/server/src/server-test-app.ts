import { hashPassword } from "better-auth/crypto";
import * as NodeSqlite from "node:sqlite";

import { ActivityStore } from "./activity/activity-store.ts";
import { NotificationStore } from "./notifications/notification-store.ts";
import { ProviderInstanceRegistryMutator } from "./provider/services/provider-instance-registry-mutator.ts";
import {
  ProjectionLibraryRepository,
  type ProjectionLibraryRepositoryShape,
} from "./persistence/services/projection-library.ts";
import { ProjectionProjectRepository } from "./persistence/services/projection-projects.ts";
import { ProjectionTaskRepository } from "./persistence/services/projection-tasks.ts";
import { HostProcessEnvironment } from "@otto/shared/hostProcess";

import { DEFAULT_SERVER_SETTINGS, type PreviewEvent } from "@otto/contracts";

import * as Effect from "effect/Effect";

import * as FileSystem from "effect/FileSystem";

import * as Layer from "effect/Layer";

import * as Option from "effect/Option";

import * as PubSub from "effect/PubSub";

import * as Stream from "effect/Stream";

import { ChildProcessSpawner } from "effect/unstable/process";

import { FetchHttpClient, HttpRouter } from "effect/unstable/http";

import * as BackgroundPolicy from "./background/background-policy.ts";

import * as ServerConfig from "./config.ts";

import { routesLayer } from "./server.ts";

import * as CheckpointDiffQuery from "./checkpointing/checkpoint-diff-query.ts";

import * as Keybindings from "./keybindings.ts";

import * as ExternalLauncher from "./process/external-launcher.ts";

import * as RemoteOpenTargets from "./environment/remote-open-targets.ts";

import * as OrchestrationEngine from "./orchestration/services/orchestration-engine.ts";

import { ThreadDeletionReactor } from "./orchestration/services/thread-deletion-reactor.ts";

import * as ProjectionSnapshotQuery from "./orchestration/services/projection-snapshot-query.ts";

import { SqlitePersistenceMemory } from "./persistence/layers/sqlite.ts";

import { OrchestrationCommandReceiptRepository } from "./persistence/services/orchestration-command-receipts.ts";

import * as ProjectionBots from "./persistence/services/projection-bots.ts";

import * as ProjectionGroups from "./persistence/services/projection-groups.ts";
import {
  ProjectionThreadMessageRepository,
  type ProjectionThreadMessageRepositoryShape,
} from "./persistence/services/projection-thread-messages.ts";

import * as AgentController from "./provider/services/agent-controller.ts";

import * as ProviderRegistry from "./provider/services/provider-registry.ts";

import { manualOnlyProviderMaintenanceCapabilities } from "./provider/provider-maintenance.ts";

import * as ServerLifecycleEvents from "./server-lifecycle-events.ts";

import * as ServerRuntimeStartup from "./server-runtime-startup.ts";

import * as ServiceLauncherClient from "./cloud/service-launcher-client.ts";

import * as ServerSettings from "./server-settings.ts";

import * as PreviewManager from "./preview/manager.ts";

import * as PortScanner from "./preview/port-scanner.ts";

import * as BrowserTraceCollector from "./observability/browser-trace-collector.ts";

import * as RepositoryIdentityResolver from "./project/repository-identity-resolver.ts";

import * as ServerEnvironment from "./environment/server-environment.ts";

import * as WorkspaceEntries from "./workspace/workspace-entries.ts";

import * as WorkspaceFileSystem from "./workspace/workspace-file-system.ts";

import * as WorkspacePaths from "./workspace/workspace-paths.ts";

import * as GitVcsDriver from "./vcs/git-vcs-driver.ts";

import * as VcsDriver from "./vcs/vcs-driver.ts";

import * as VcsDriverRegistry from "./vcs/vcs-driver-registry.ts";

import * as GitWorkflowService from "./git/git-workflow-service.ts";

import * as ServerSecretStore from "./auth/server-secret-store.ts";

import * as ChannelDeliveryStore from "./channels/channel-delivery-store.ts";

import * as ChannelRuntime from "./channels/channel-runtime.ts";

import * as UsageService from "./usage/usage-service.ts";

import { BotUsageLedger, type BotUsageLedgerShape } from "./usage/bot-usage-ledger.ts";

import { RoutineRepository, type RoutineRepositoryShape } from "./routines/repository.ts";

import { RoutineRuntime, type RoutineRuntimeShape } from "./routines/runtime.ts";

import {
  defaultTestMemberAccount,
  defaultTestAccount,
  TEST_EPOCH,
  defaultOrchestrationReadModel,
  defaultThreadId,
  testEnvironmentDescriptor,
} from "./server-test-fixtures.ts";

import { authTestLayer } from "./server-test-clients.ts";

// Otto: Hashing once keeps every router test from paying for scrypt.
let testPasswordHash: Promise<string> | undefined;

/**
 * Otto: Seeds a verified admin and a member in one organization, as finished setup and an
 * accepted invite leave it, so router tests sign in through the real accounts endpoint.
 */
const seedTestAccount = (dbPath: string) =>
  Effect.promise(async () => {
    testPasswordHash ??= hashPassword(defaultTestAccount.password);
    const password = await testPasswordHash;
    const database = new NodeSqlite.DatabaseSync(dbPath);
    const now = "2026-01-01T00:00:00.000Z";

    try {
      database.exec("BEGIN");
      database
        .prepare(
          `INSERT INTO organizations (id, name, slug, createdAt)
           VALUES ('organization-test', 'Test organization', 'organization', ?)`,
        )
        .run(now);

      for (const [key, account, role] of [
        ["admin", defaultTestAccount, "admin"],
        ["member", defaultTestMemberAccount, "member"],
      ] as const) {
        const userId = `user-test-${key}`;

        database
          .prepare(
            `INSERT INTO users (id, name, email, emailVerified, createdAt, updatedAt, firstName, lastName)
             VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
          )
          .run(
            userId,
            `${account.firstName} ${account.lastName}`,
            account.email,
            now,
            now,
            account.firstName,
            account.lastName,
          );
        database
          .prepare(
            `INSERT INTO accounts (id, accountId, providerId, userId, password, createdAt, updatedAt)
             VALUES (?, ?, 'credential', ?, ?, ?, ?)`,
          )
          .run(`account-test-${key}`, userId, userId, password, now, now);
        database
          .prepare(
            `INSERT INTO members (id, organizationId, userId, role, createdAt)
             VALUES (?, 'organization-test', ?, ?, ?)`,
          )
          .run(`member-test-${key}`, userId, role, now);
      }

      database.exec("COMMIT");
    } finally {
      database.close();
    }
  });

export const buildAppUnderTest = (options?: {
  /** Leaves the organization unset, for setup tests. */
  seedAccount?: boolean;
  config?: Partial<ServerConfig.ServerConfig["Service"]>;
  layers?: {
    keybindings?: Partial<Keybindings.Keybindings["Service"]>;
    providerRegistry?: Partial<ProviderRegistry.ProviderRegistry["Service"]>;
    agentController?: Partial<AgentController.AgentController["Service"]>;
    serverSettings?: Partial<ServerSettings.ServerSettingsService["Service"]>;
    externalLauncher?: Partial<ExternalLauncher.ExternalLauncher["Service"]>;
    vcsDriver?: Partial<VcsDriver.VcsDriver["Service"]>;
    vcsDriverRegistry?: Partial<VcsDriverRegistry.VcsDriverRegistry["Service"]>;
    gitVcsDriver?: Partial<GitVcsDriver.GitVcsDriver["Service"]>;
    previewManager?: Partial<PreviewManager.PreviewManager["Service"]>;
    orchestrationEngine?: Partial<OrchestrationEngine.OrchestrationEngineService["Service"]>;
    commandReceipts?: Partial<OrchestrationCommandReceiptRepository["Service"]>;
    threadDeletionReactor?: Partial<ThreadDeletionReactor["Service"]>;
    routineRepository?: Partial<RoutineRepositoryShape>;
    routineRuntime?: Partial<RoutineRuntimeShape>;
    projectionSnapshotQuery?: Partial<ProjectionSnapshotQuery.ProjectionSnapshotQuery["Service"]>;
    projectionBots?: Partial<ProjectionBots.ProjectionBotRepositoryShape>;
    projectionGroups?: Partial<ProjectionGroups.ProjectionGroupRepositoryShape>;
    projectionLibrary?: Partial<ProjectionLibraryRepositoryShape>;
    projectionThreadMessages?: Partial<ProjectionThreadMessageRepositoryShape>;
    botUsageLedger?: Partial<BotUsageLedgerShape>;
    checkpointDiffQuery?: Partial<CheckpointDiffQuery.CheckpointDiffQuery["Service"]>;
    browserTraceCollector?: Partial<BrowserTraceCollector.BrowserTraceCollector["Service"]>;
    serverLifecycleEvents?: Partial<ServerLifecycleEvents.ServerLifecycleEvents["Service"]>;
    serverRuntimeStartup?: Partial<ServerRuntimeStartup.ServerRuntimeStartup["Service"]>;
    channelDeliveryStore?: ChannelDeliveryStore.ChannelDeliveryStoreShape | null;
    channelRuntime?: Partial<ChannelRuntime.ChannelRuntimeShape> &
      Pick<ChannelRuntime.ChannelRuntimeShape, "channelBindingsForRuntime">;
    serverEnvironment?: Partial<ServerEnvironment.ServerEnvironment["Service"]>;
    repositoryIdentityResolver?: Partial<
      RepositoryIdentityResolver.RepositoryIdentityResolver["Service"]
    >;
  };
}) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;

    const tempBaseDir = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "ottoLegacy-router-test-",
    });

    const baseDir = options?.config?.baseDir ?? tempBaseDir;
    const devUrl = options?.config?.devUrl;
    const derivedPaths = yield* ServerConfig.deriveServerPaths(baseDir, devUrl);

    const config: ServerConfig.ServerConfig["Service"] = {
      logLevel: "Info",
      traceMinLevel: "Info",
      traceTimingEnabled: true,
      traceBatchWindowMs: 200,
      traceMaxBytes: 10 * 1024 * 1024,
      traceMaxFiles: 10,
      otlpTracesUrl: undefined,
      otlpMetricsUrl: undefined,
      otlpExportIntervalMs: 10_000,
      otlpServiceName: "otto-server",
      mode: "desktop",
      port: 0,
      host: "127.0.0.1",
      cwd: process.cwd(),
      baseDir,
      ...derivedPaths,
      staticDir: undefined,
      devUrl,
      devAllowedOrigins: [],
      noBrowser: true,
      startupPresentation: "browser",
      autoBootstrapProjectFromCwd: false,
      logWebSocketEvents: false,
      tailscaleServeEnabled: false,
      tailscaleServePort: 443,
      publicOrigin: undefined,
      ...options?.config,
    };

    const layerConfig = ServerConfig.layer(config);

    const defaultVcsDriver: VcsDriver.VcsDriver["Service"] = {
      capabilities: {
        kind: "git",
        supportsWorktrees: true,
        supportsBookmarks: false,
        supportsAtomicSnapshot: false,
        supportsPushDefaultRemote: true,
        ignoreClassifier: "native",
      },
      execute: () =>
        Effect.succeed({
          exitCode: ChildProcessSpawner.ExitCode(0),
          stdout: "",
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false,
        }),
      detectRepository: () => Effect.succeed(null),
      isInsideWorkTree: () => Effect.succeed(false),
      listWorkspaceFiles: () =>
        Effect.succeed({
          paths: [],
          truncated: false,
          freshness: {
            source: "live-local",
            observedAt: TEST_EPOCH,
            expiresAt: Option.none(),
          },
        }),
      listRemotes: () =>
        Effect.succeed({
          remotes: [],
          freshness: {
            source: "live-local",
            observedAt: TEST_EPOCH,
            expiresAt: Option.none(),
          },
        }),
      filterIgnoredPaths: (_cwd, relativePaths) => Effect.succeed(relativePaths),
      initRepository: () => Effect.void,
      ...options?.layers?.vcsDriver,
    };

    const vcsDriverRegistryLayer = Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
      get: () => Effect.succeed(defaultVcsDriver),
      detect: (input) =>
        defaultVcsDriver.detectRepository(input.cwd).pipe(
          Effect.flatMap((repository) =>
            repository
              ? Effect.succeed(repository)
              : defaultVcsDriver.isInsideWorkTree(input.cwd).pipe(
                  Effect.map((isInsideWorkTree) =>
                    isInsideWorkTree
                      ? {
                          kind: "git" as const,
                          rootPath: input.cwd,
                          metadataPath: null,
                          freshness: {
                            source: "live-local" as const,
                            observedAt: TEST_EPOCH,
                            expiresAt: Option.none(),
                          },
                        }
                      : null,
                  ),
                ),
          ),
          Effect.map((repository) =>
            repository
              ? ({
                  kind: repository.kind,
                  repository,
                  driver: defaultVcsDriver,
                } satisfies VcsDriverRegistry.VcsDriverHandle)
              : null,
          ),
        ),
      resolve: (input) =>
        Effect.succeed({
          kind:
            input.requestedKind === "auto" || !input.requestedKind ? "git" : input.requestedKind,
          repository: {
            kind:
              input.requestedKind === "auto" || !input.requestedKind ? "git" : input.requestedKind,
            rootPath: input.cwd,
            metadataPath: null,
            freshness: {
              source: "live-local",
              observedAt: TEST_EPOCH,
              expiresAt: Option.none(),
            },
          },
          driver: defaultVcsDriver,
        }),
      ...options?.layers?.vcsDriverRegistry,
    });

    const gitVcsDriverLayer = Layer.mock(GitVcsDriver.GitVcsDriver)({
      ...options?.layers?.gitVcsDriver,
    });

    const workspaceEntriesLayer = WorkspaceEntries.layer.pipe(
      Layer.provide(WorkspacePaths.layer),
      Layer.provideMerge(vcsDriverRegistryLayer),
    );

    const workspaceAndProjectServicesLayer = Layer.mergeAll(
      WorkspacePaths.layer,
      workspaceEntriesLayer,
      WorkspaceFileSystem.layer.pipe(
        Layer.provide(WorkspacePaths.layer),
        Layer.provide(workspaceEntriesLayer),
      ),
    );

    const gitWorkflowLayer = GitWorkflowService.layer.pipe(
      Layer.provideMerge(vcsDriverRegistryLayer),
      Layer.provideMerge(gitVcsDriverLayer),
    );

    const serviceLauncherClientLayer = ServiceLauncherClient.layer.pipe(
      Layer.provide(Layer.succeed(HostProcessEnvironment, {})),
    );

    const servedRoutesLayer = HttpRouter.serve(
      routesLayer.pipe(Layer.provide(serviceLauncherClientLayer)),
      {
        disableListenLog: true,
        disableLogger: true,
      },
    ).pipe(
      Layer.provide(
        Layer.mock(Keybindings.Keybindings)({
          loadConfigState: Effect.succeed({
            keybindings: [],
            issues: [],
          }),
          streamChanges: Stream.empty,
          ...options?.layers?.keybindings,
        }),
      ),
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(ProviderRegistry.ProviderRegistry)({
            getProviders: Effect.succeed([]),
            refresh: () => Effect.succeed([]),
            refreshInstance: () => Effect.succeed([]),
            getProviderMaintenanceCapabilitiesForInstance: (_instanceId, provider) =>
              Effect.succeed(
                manualOnlyProviderMaintenanceCapabilities({ provider, packageName: null }),
              ),
            setProviderMaintenanceActionState: () => Effect.succeed([]),
            streamChanges: Stream.empty,
            ...options?.layers?.providerRegistry,
          }),
          Layer.succeed(ProviderInstanceRegistryMutator, { reconcile: () => Effect.void }),
          Layer.mock(AgentController.AgentController)({
            uploadFeedback: () => Effect.die("Provider feedback is not stubbed in this test"),
            ...options?.layers?.agentController,
          }),
        ),
      ),
      Layer.provide(
        Layer.mock(ServerSettings.ServerSettingsService)({
          start: Effect.void,
          ready: Effect.void,
          getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
          updateSettings: () => Effect.succeed(DEFAULT_SERVER_SETTINGS),
          streamChanges: Stream.empty,
          ...options?.layers?.serverSettings,
        }),
      ),
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(ExternalLauncher.ExternalLauncher)({
            resolveAvailableEditors: () => Effect.succeed([]),
            resolveFileManagerRevealKind: () => Effect.sync((): undefined => undefined),
            ...options?.layers?.externalLauncher,
          }),
          Layer.mock(RemoteOpenTargets.RemoteOpenTargets)({
            resolveTargets: () => Effect.succeed([]),
          }),
        ),
      ),
      Layer.provide(gitVcsDriverLayer),
      Layer.provide(gitWorkflowLayer),
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(PreviewManager.PreviewManager)({
            open: () => Effect.die("PreviewManager not stubbed in this test"),
            navigate: () => Effect.die("PreviewManager not stubbed in this test"),
            resize: () => Effect.die("PreviewManager not stubbed in this test"),
            reportStatus: () => Effect.void,
            refresh: () => Effect.void,
            close: () => Effect.void,
            list: () => Effect.succeed({ sessions: [], serverEpoch: "test-server", revision: 0 }),
            streamEvents: () => Stream.empty,
            subscribeEvents: Effect.flatMap(PubSub.unbounded<PreviewEvent>(), (pubsub) =>
              PubSub.subscribe(pubsub),
            ),
            ...options?.layers?.previewManager,
          }),
          Layer.mock(PortScanner.PortDiscovery)({
            scan: () => Effect.succeed([]),
            subscribe: () => Effect.void,
            retain: Effect.void,
          }),
        ),
      ),
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(OrchestrationEngine.OrchestrationEngineService)({
            readEvents: () => Stream.empty,
            readThreadEvents: () => Stream.empty,
            getThreadReplayStats: () =>
              Effect.succeed({
                eventCount: 0,
                payloadBytes: 0,
                hasCreateEvent: false,
              }),
            dispatch: () => Effect.succeed({ sequence: 0 }),
            streamDomainEvents: Stream.empty,
            subscribeDomainEvents: Effect.succeed(Stream.empty),
            latestSequence: Effect.succeed(0),
            ...options?.layers?.orchestrationEngine,
          }),
          Layer.succeed(
            OrchestrationCommandReceiptRepository,
            OrchestrationCommandReceiptRepository.of({
              getByCommandId: () => Effect.succeed(Option.none()),
              upsert: () => Effect.void,
              ...options?.layers?.commandReceipts,
            }),
          ),
          Layer.mock(ThreadDeletionReactor)({
            start: () => Effect.void,
            drain: Effect.void,
            drainThrough: () => Effect.void,
            ...options?.layers?.threadDeletionReactor,
          }),
          Layer.succeed(
            RoutineRepository,
            RoutineRepository.of({
              listAll: Effect.succeed([]),
              list: () => Effect.succeed({ rows: [], statusCounts: [] }),
              listEnabled: Effect.succeed([]),
              getById: () => Effect.succeed(null),
              listRuns: () => Effect.succeed([]),
              listThreadRuns: () => Effect.succeed({ runs: [], nextCursor: null }),
              listAllRuns: Effect.succeed([]),
              getLatestThreadRef: () => Effect.succeed(null),
              getActiveRunByThreadRef: () => Effect.succeed(null),
              listSkillAssignments: Effect.succeed([]),
              claim: () => Effect.succeed(false),
              markDispatched: () => Effect.void,
              markBlocked: () => Effect.void,
              listRecoverable: Effect.succeed([]),
              ...options?.layers?.routineRepository,
              markSettled: options?.layers?.routineRepository?.markSettled ?? (() => Effect.void),
            } satisfies RoutineRepositoryShape),
          ),
          Layer.succeed(
            RoutineRuntime,
            RoutineRuntime.of({
              runDue: Effect.void,
              canRunNow: () => Effect.succeed(true),
              runNow: () => Effect.succeed(null),
              recover: Effect.void,
              start: Effect.void,
              ...options?.layers?.routineRuntime,
            } satisfies RoutineRuntimeShape),
          ),
        ),
      ),
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(ProjectionBots.ProjectionBotRepository, {
            upsert: () => Effect.void,
            getById: () => Effect.succeed(Option.none()),
            listAll: () => Effect.succeed([]),
            deleteById: () => Effect.void,
            ...options?.layers?.projectionBots,
          } satisfies ProjectionBots.ProjectionBotRepositoryShape),
          Layer.mock(BotUsageLedger)({
            pricingTotals: () => Effect.succeed({ complete: true, models: [] }),
            summarize: (botId) =>
              Effect.succeed({
                botId,
                consumedTokens: 0,
                reservedTokens: 0,
                measurements: {
                  input: { tokens: 0, unavailableEntries: 0 },
                  output: { tokens: 0, unavailableEntries: 0 },
                  observer: { tokens: 0, unavailableEntries: 0 },
                  reflector: { tokens: 0, unavailableEntries: 0 },
                },
                entries: [],
              }),
            ...options?.layers?.botUsageLedger,
          }),
          Layer.succeed(ProjectionGroups.ProjectionGroupRepository, {
            upsert: () => Effect.void,
            getById: () => Effect.succeed(Option.none()),
            listAll: () => Effect.succeed([]),
            deleteById: () => Effect.void,
            ...options?.layers?.projectionGroups,
          } satisfies ProjectionGroups.ProjectionGroupRepositoryShape),
          Layer.mock(ProjectionThreadMessageRepository)({
            listAttachmentMessages: () => Effect.succeed([]),
            ...options?.layers?.projectionThreadMessages,
          }),
          Layer.succeed(ActivityStore, {
            list: () => Effect.succeed({ entries: [] }),
            getComment: () => Effect.die("Activity is not part of this test."),
            removeComment: () => Effect.void,
          }),
          Layer.succeed(NotificationStore, {
            insert: () => Effect.void,
            list: () => Effect.succeed({ notifications: [], unread: 0 }),
            markRead: () => Effect.void,
          }),
          Layer.succeed(ProjectionLibraryRepository, {
            upsertFolder: () => Effect.void,
            deleteFolder: () => Effect.void,
            upsertFile: () => Effect.void,
            deleteFile: () => Effect.void,
            listFolders: () => Effect.succeed([]),
            listFiles: () => Effect.succeed([]),
            listChatThreads: () => Effect.succeed([]),
            ...options?.layers?.projectionLibrary,
          } satisfies ProjectionLibraryRepositoryShape),
          Layer.mock(ProjectionTaskRepository)({}),
          Layer.mock(ProjectionProjectRepository)({}),
          Layer.mock(ProjectionSnapshotQuery.ProjectionSnapshotQuery)({
            getCommandReadModel: () => Effect.succeed(defaultOrchestrationReadModel()),
            getSnapshot: () => Effect.succeed(defaultOrchestrationReadModel()),
            getShellSnapshot: () =>
              Effect.succeed({
                snapshotSequence: 0,
                bots: [],
                groups: [],
                delegations: [],
                projects: [],
                threads: [],
                updatedAt: "1970-01-01T00:00:00.000Z",
              }),
            getArchivedShellSnapshot: () =>
              Effect.succeed({
                snapshotSequence: 0,
                bots: [],
                groups: [],
                delegations: [],
                projects: [],
                threads: [],
                updatedAt: "1970-01-01T00:00:00.000Z",
              }),
            searchThreads: () => Effect.succeed({ matches: [] }),
            getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 0 }),
            getProjectShellById: () => Effect.succeed(Option.none()),
            getThreadShellById: () => Effect.succeed(Option.none()),
            getThreadRuntimeContext: () => Effect.die("unused"),
            getTurnStartMessage: () => Effect.die("unused"),
            getThreadDetailById: () => Effect.succeed(Option.none()),
            getThreadDetailSnapshot: () => Effect.succeed(Option.none()),
            getCounts: () => Effect.succeed({ projectCount: 0, threadCount: 0 }),
            getEventReplayStats: ({ fromSequenceExclusive, toSequenceInclusive }) =>
              Effect.succeed({
                eventCount: Math.max(0, toSequenceInclusive - fromSequenceExclusive),
                payloadBytes: 0,
              }),
            getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
            getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
            getThreadCheckpointContext: () => Effect.succeed(Option.none()),
            ...options?.layers?.projectionSnapshotQuery,
          }),
        ),
      ),
      Layer.provide(
        Layer.mock(CheckpointDiffQuery.CheckpointDiffQuery)({
          getTurnDiff: () =>
            Effect.succeed({
              threadId: defaultThreadId,
              fromTurnCount: 0,
              toTurnCount: 0,
              diff: "",
            }),
          getFullThreadDiff: () =>
            Effect.succeed({
              threadId: defaultThreadId,
              fromTurnCount: 0,
              toTurnCount: 0,
              diff: "",
            }),
          ...options?.layers?.checkpointDiffQuery,
        }),
      ),
    );

    const appLayer = servedRoutesLayer.pipe(
      Layer.provide(UsageService.layerTest),
      Layer.provide(
        Layer.mock(BrowserTraceCollector.BrowserTraceCollector)({
          record: () => Effect.void,
          ...options?.layers?.browserTraceCollector,
        }),
      ),
      Layer.provide(
        Layer.mock(ServerLifecycleEvents.ServerLifecycleEvents)({
          publish: (event) => Effect.succeed({ ...event, sequence: 1 }),
          snapshot: Effect.succeed({ sequence: 0, events: [] }),
          stream: Stream.empty,
          ...options?.layers?.serverLifecycleEvents,
        }),
      ),
      Layer.provide(
        Layer.mock(ServerRuntimeStartup.ServerRuntimeStartup)({
          awaitCommandReady: Effect.void,
          markHttpListening: Effect.void,
          enqueueCommand: (effect) => effect,
          ...options?.layers?.serverRuntimeStartup,
        }),
      ),
      Layer.provide(
        Layer.mock(BackgroundPolicy.BackgroundPolicy)({
          reportClientActivity: () => Effect.void,
          removeRpcClient: () => Effect.void,
          reportHostPowerState: () => Effect.void,
          snapshot: Effect.succeed({
            hostPower: {
              source: "unknown",
              idle: "unknown",
              idleSeconds: null,
              locked: "unknown",
              suspended: false,
              onBattery: "unknown",
              lowPowerMode: "unknown",
              thermalState: "unknown",
              stale: true,
              updatedAt: TEST_EPOCH,
            },
            leases: [],
            activeForegroundLeaseCount: 0,
            activeScopeKeys: [],
            shouldRunOpportunisticWork: false,
            updatedAt: TEST_EPOCH,
          }),
          streamChanges: Stream.empty,
          subscribe: Effect.succeed({
            latest: {
              hostPower: {
                source: "unknown",
                idle: "unknown",
                idleSeconds: null,
                locked: "unknown",
                suspended: false,
                onBattery: "unknown",
                lowPowerMode: "unknown",
                thermalState: "unknown",
                stale: true,
                updatedAt: TEST_EPOCH,
              },
              leases: [],
              activeForegroundLeaseCount: 0,
              activeScopeKeys: [],
              shouldRunOpportunisticWork: false,
              updatedAt: TEST_EPOCH,
            },
            changes: Stream.empty,
          }),
          hasDemand: () => Effect.succeed(false),
          shouldRunScopeWork: () => Effect.succeed(false),
          shouldRunOpportunisticWork: Effect.succeed(false),
        }),
      ),
      Layer.provide(
        Layer.mock(ServerEnvironment.ServerEnvironment)({
          getEnvironmentId: Effect.succeed(testEnvironmentDescriptor.environmentId),
          getDescriptor: Effect.succeed(testEnvironmentDescriptor),
          ...options?.layers?.serverEnvironment,
        }),
      ),
      Layer.provide(
        Layer.mock(RepositoryIdentityResolver.RepositoryIdentityResolver)({
          resolve: () => Effect.succeed(null),
          ...options?.layers?.repositoryIdentityResolver,
        }),
      ),
      Layer.provideMerge(authTestLayer()),
      Layer.provideMerge(ServerSecretStore.layer.pipe(Layer.provide(SqlitePersistenceMemory))),
      Layer.provideMerge(
        options?.layers?.channelRuntime
          ? Layer.mock(ChannelRuntime.ChannelRuntime)(options.layers.channelRuntime)
          : Layer.empty,
      ),
      Layer.provideMerge(
        options?.layers?.channelDeliveryStore === null
          ? Layer.empty
          : Layer.succeed(
              ChannelDeliveryStore.ChannelDeliveryStore,
              options?.layers?.channelDeliveryStore ??
                ChannelDeliveryStore.memoryChannelDeliveryStore(),
            ),
      ),
      Layer.provide(workspaceAndProjectServicesLayer),
      Layer.provideMerge(FetchHttpClient.layer),
      Layer.provide(layerConfig),
    );

    yield* Layer.build(Layer.fresh(appLayer));

    if (options?.seedAccount !== false) yield* seedTestAccount(config.dbPath);

    return config;
  });
