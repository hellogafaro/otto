import { subscriptionProviderMutation } from "./subscription-auth/provider-mutation.ts";
import { ProviderInstanceRegistryMutator } from "./provider/services/provider-instance-registry-mutator.ts";
import { HostProcessEnvironment } from "@otto/shared/hostProcess";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import { ActivityStore } from "./activity/activity-store.ts";
import { NotificationStore } from "./notifications/notification-store.ts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import {
  AuthAccessWriteScope,
  AuthAccessStreamError,
  AuthSessionId,
  type ChannelBinding,
  type AuthEnvironmentScope,
  CommandId,
  type EditorId,
  type OrchestrationClientOrigin,
  OrchestrationDispatchCommandError,
  OrchestrationGetSnapshotError,
  ProviderInstanceId,
  type SubscriptionProviderId,
  RpcClientId,
  EnvironmentAuthorizationError,
  ImageGenerationError,
  SubscriptionAuthError,
} from "@otto/contracts";
import { SubscriptionAuthService } from "./subscription-auth/service.ts";
import { apiKeySessionReset } from "./subscription-auth/session-reset.ts";
import { subscriptionProviderSettingsPatch } from "./subscription-auth/runtime.ts";
import { imageProviderStatuses } from "./image-generation/service.ts";
import { deriveProviderInstanceConfigMap } from "./provider/layers/provider-instance-registry-hydration.ts";
import {
  buildProviderAccessCapabilities,
  subscriptionDependentBots,
} from "./subscription-auth/snapshot.ts";
import { BotInboxService } from "./bot-inbox/service.ts";
import { syncAccessIncidents, syncConnectorIncidents } from "./bot-inbox/connector-incidents.ts";
import * as ChannelRuntime from "./channels/channel-runtime.ts";
import * as CheckpointDiffQuery from "./checkpointing/checkpoint-diff-query.ts";
import * as ServerConfig from "./config.ts";
import { OrganizationAccounts, organizationRoleScopes } from "./auth/organization-accounts.ts";
import { sessionPersonId } from "./orchestration/authenticated-command.ts";
import * as Keybindings from "./keybindings.ts";
import * as ExternalLauncher from "./process/external-launcher.ts";
import * as OrchestrationEngine from "./orchestration/services/orchestration-engine.ts";
import * as ProjectionSnapshotQuery from "./orchestration/services/projection-snapshot-query.ts";
import { ThreadDeletionReactor } from "./orchestration/services/thread-deletion-reactor.ts";
import { OrchestrationCommandReceiptRepository } from "./persistence/services/orchestration-command-receipts.ts";
import * as ProjectionBots from "./persistence/services/projection-bots.ts";
import * as ProjectionGroups from "./persistence/services/projection-groups.ts";
import { ProjectionLibraryRepository } from "./persistence/services/projection-library.ts";
import { ProjectionTaskRepository } from "./persistence/services/projection-tasks.ts";
import { ProjectionThreadMessageRepository } from "./persistence/services/projection-thread-messages.ts";
import { Memories } from "./memory/memories.ts";
import {
  observeRpcEffect as instrumentRpcEffect,
  observeRpcStream as instrumentRpcStream,
  observeRpcStreamEffect as instrumentRpcStreamEffect,
} from "./observability/rpc-instrumentation.ts";
import * as AgentController from "./provider/services/agent-controller.ts";
import * as ProviderRegistry from "./provider/services/provider-registry.ts";
import * as ProviderMaintenanceRunner from "./provider/provider-maintenance-runner.ts";
import * as ServerSelfUpdate from "./cloud/self-update.ts";
import * as ServiceLauncherClient from "./cloud/service-launcher-client.ts";
import { isRemoteInstall } from "./remote/remote-mode.ts";
import * as ServerLifecycleEvents from "./server-lifecycle-events.ts";
import * as ServerRuntimeStartup from "./server-runtime-startup.ts";
import * as ServerSettings from "./server-settings.ts";
import { TextGeneration } from "./text-generation/text-generation.ts";
import { RoutineRepository } from "./routines/repository.ts";
import { RoutineRuntime } from "./routines/runtime.ts";
import * as PreviewManager from "./preview/manager.ts";
import * as PortScanner from "./preview/port-scanner.ts";
import * as WorkspaceEntries from "./workspace/workspace-entries.ts";
import * as WorkspaceFileSystem from "./workspace/workspace-file-system.ts";
import * as GitWorkflowService from "./git/git-workflow-service.ts";
import * as ServerEnvironment from "./environment/server-environment.ts";
import * as RemoteOpenTargets from "./environment/remote-open-targets.ts";
import * as BackgroundPolicy from "./background/background-policy.ts";
import * as EnvironmentAuth from "./auth/environment-auth.ts";
import * as ServerSecretStore from "./auth/server-secret-store.ts";
import * as Composio from "./composio/composio-service.ts";
import * as GitHub from "./github/github-accounts.ts";
import { requiredScopeForRpcMethod } from "./auth/rpc-authorization.ts";
import { BotUsageLedger } from "./usage/bot-usage-ledger.ts";
import * as UsageService from "./usage/usage-service.ts";
import * as VoiceCallManager from "./voice-call/voice-call-manager.ts";
import * as SessionStore from "./auth/session-store.ts";
import {
  isOrchestrationDispatchCommandError,
  subscriptionDriverByProvider,
  subscriptionProviderForDriver,
  resolveAvailableEditorsForConfig,
  resolveFileManagerRevealKindForConfig,
  type ProviderSubscribeRefreshes,
  ORCHESTRATION_REPLAY_PAYLOAD_BUDGET_BYTES,
} from "./ws-support.ts";

export const createWsServices = (
  currentSession: EnvironmentAuth.AuthenticatedSession,
  clientOrigin: OrchestrationClientOrigin,
  voiceCalls: VoiceCallManager.VoiceCallManager["Service"],
  providerRefreshes: ProviderSubscribeRefreshes,
) =>
  Effect.gen(function* () {
    const currentSessionId = currentSession.sessionId;
    const currentPersonId = sessionPersonId(currentSession);

    const crypto = yield* Crypto.Crypto;

    const voiceCallOwnerId = yield* crypto.randomUUIDv4.pipe(Effect.orDie);

    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;

    const projectionBots = yield* ProjectionBots.ProjectionBotRepository;

    const botUsageLedger = yield* BotUsageLedger;

    const projectionGroups = yield* ProjectionGroups.ProjectionGroupRepository;

    const projectionLibrary = yield* ProjectionLibraryRepository;

    const projectionThreadMessages = yield* ProjectionThreadMessageRepository;

    const projectionTasks = yield* ProjectionTaskRepository;

    const activityStore = yield* ActivityStore;

    const notificationStore = yield* NotificationStore;

    const routineRepository = yield* RoutineRepository;

    const routineRuntime = yield* RoutineRuntime;

    const orchestrationEngine = yield* OrchestrationEngine.OrchestrationEngineService;

    const canReplayPersistedRange = Effect.fnUntraced(function* (
      afterSequence: number,
      headSequence: number,
      maxGap: number,
    ) {
      const replayGap = headSequence - afterSequence;

      if (replayGap < 0 || replayGap > maxGap) {
        return false;
      }

      const stats = yield* projectionSnapshotQuery
        .getEventReplayStats({
          fromSequenceExclusive: afterSequence,
          toSequenceInclusive: headSequence,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationGetSnapshotError({
                message: "Failed to measure orchestration replay range",
                cause,
              }),
          ),
        );

      if (stats.payloadBytes > ORCHESTRATION_REPLAY_PAYLOAD_BUDGET_BYTES) {
        yield* Effect.logDebug("orchestration replay replaced by snapshot", {
          afterSequence,
          headSequence,
          replayGap,
          eventCount: stats.eventCount,
          payloadBytes: stats.payloadBytes,
          payloadBudgetBytes: ORCHESTRATION_REPLAY_PAYLOAD_BUDGET_BYTES,
        });

        return false;
      }

      return true;
    });

    const threadDeletionReactor = yield* ThreadDeletionReactor;

    // Every command dispatched on this connection carries the connecting
    // client's origin, including server-generated bootstrap sub-commands:
    // the client's request caused them.
    const hasClientOrigin =
      clientOrigin.surface !== undefined || clientOrigin.appVersion !== undefined;

    const dispatchActor = {
      personId: currentPersonId,
      canManageGroups: currentSession.scopes.includes(AuthAccessWriteScope),
    };

    const dispatchFromClient: OrchestrationEngine.OrchestrationEngineShape["dispatch"] = (
      command,
    ) =>
      orchestrationEngine.dispatch(command, {
        actor: dispatchActor,
        ...(hasClientOrigin ? { origin: clientOrigin } : {}),
      });

    const checkpointDiffQuery = yield* CheckpointDiffQuery.CheckpointDiffQuery;

    const keybindings = yield* Keybindings.Keybindings;

    const externalLauncher = yield* ExternalLauncher.ExternalLauncher;

    const remoteOpenTargets = yield* RemoteOpenTargets.RemoteOpenTargets;

    const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;

    const previewManager = yield* PreviewManager.PreviewManager;

    const portDiscovery = yield* PortScanner.PortDiscovery;

    const agentController = yield* AgentController.AgentController;

    const memories = Option.getOrNull(yield* Effect.serviceOption(Memories));

    const providerRegistry = yield* ProviderRegistry.ProviderRegistry;

    const providerMaintenanceRunner = yield* ProviderMaintenanceRunner.ProviderMaintenanceRunner;

    const serverSelfUpdate = yield* ServerSelfUpdate.ServerSelfUpdate;

    const config = yield* ServerConfig.ServerConfig;

    const remoteDoctorTarget = {
      baseDir: config.baseDir,
      remote: isRemoteInstall({
        launcherManaged: Option.match(
          yield* Effect.serviceOption(ServiceLauncherClient.ServiceLauncherClient),
          { onNone: () => false, onSome: (launcher) => launcher.managed },
        ),
        env: process.env,
      }),
    };

    const subscriptionAuth = yield* SubscriptionAuthService.forSecretsDir(config.secretsDir, {
      checkHealthOnConnect: true,
    });

    const botInbox = BotInboxService.forSecretsDir(config.secretsDir);

    const lifecycleEvents = yield* ServerLifecycleEvents.ServerLifecycleEvents;

    const serverSettings = yield* ServerSettings.ServerSettingsService;

    const textGeneration = yield* Effect.serviceOption(TextGeneration);

    const refreshChangedSubscriptionProviders = subscriptionProviderMutation(
      subscriptionAuth,
      serverSettings,
      yield* ProviderInstanceRegistryMutator,
      providerRegistry,
    );

    const syncSubscriptionProviderSettings = Effect.gen(function* () {
      const settings = yield* serverSettings.getSettings;
      const patch = subscriptionProviderSettingsPatch(settings, subscriptionAuth.statuses());

      if (patch) yield* serverSettings.updateSettings(patch);
    }).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Failed to align provider settings with subscription connections", {
          detail: cause.message,
        }),
      ),
    );

    yield* syncSubscriptionProviderSettings;

    const resetChangedApiKeySessions = apiKeySessionReset(
      subscriptionAuth,
      agentController,
      serverSettings.getSettings.pipe(
        Effect.map(deriveProviderInstanceConfigMap),
        Effect.orElseSucceed(() => ({})),
      ),
    );

    const validateAccountInstance = Effect.fn("validateAccountInstance")(function* (
      provider: SubscriptionProviderId,
      instanceId: ProviderInstanceId | undefined,
    ) {
      if (!instanceId) return;

      const settings = yield* serverSettings.getSettings.pipe(
        Effect.mapError((cause) => new SubscriptionAuthError({ reason: cause.message })),
      );

      const instance = deriveProviderInstanceConfigMap(settings)[instanceId];
      const driver = subscriptionDriverByProvider[provider];

      if (instance?.driver !== driver) {
        return yield* new SubscriptionAuthError({
          reason: `Provider instance '${instanceId}' does not belong to ${provider}.`,
        });
      }
    });

    const startup = yield* ServerRuntimeStartup.ServerRuntimeStartup;

    const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;

    const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;

    const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;

    const backgroundPolicy = yield* BackgroundPolicy.BackgroundPolicy;

    const rpcClientIds = yield* Ref.make(new Set<RpcClientId>());

    yield* Effect.addFinalizer(() =>
      Effect.all(
        [
          Ref.get(rpcClientIds).pipe(
            Effect.flatMap((clientIds) =>
              Effect.forEach(
                clientIds,
                (clientId) => backgroundPolicy.removeRpcClient(currentSessionId, clientId),
                { discard: true },
              ),
            ),
            Effect.ignore,
          ),
          voiceCalls.hangupOwner(voiceCallOwnerId),
        ],
        { discard: true },
      ),
    );

    const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;

    const secretStore = yield* ServerSecretStore.ServerSecretStore;

    const composioService = yield* Effect.serviceOption(Composio.ComposioService);

    const composio = Option.getOrElse(composioService, () =>
      Composio.make(secretStore, Composio.inMemoryComposioAccounts(), undefined),
    );

    const github = Option.getOrElse(yield* Effect.serviceOption(GitHub.GitHubAccounts), () =>
      GitHub.make(secretStore),
    );

    const commandReceipts = yield* Effect.serviceOption(OrchestrationCommandReceiptRepository);

    const channelRuntime = yield* Effect.serviceOption(ChannelRuntime.ChannelRuntime);

    const channelBindingsForRuntime = (bindings: ReadonlyArray<ChannelBinding>) =>
      Option.match(channelRuntime, {
        onNone: () => ChannelRuntime.channelBindingsForRuntime(bindings, () => false),
        onSome: (runtime) => runtime.channelBindingsForRuntime(bindings),
      });

    const sessions = yield* SessionStore.SessionStore;

    const usage = yield* UsageService.UsageService;

    const authorizationError = (requiredScope: AuthEnvironmentScope) =>
      new EnvironmentAuthorizationError({
        message: `The authenticated token is missing required scope: ${requiredScope}.`,
        requiredScope,
      });

    const accounts = yield* OrganizationAccounts;

    const authorizeScope = (requiredScope: AuthEnvironmentScope) =>
      accounts.getPrincipal(currentSession.sessionId).pipe(
        Effect.mapError(() => authorizationError(requiredScope)),
        Effect.flatMap((principal) =>
          principal && organizationRoleScopes(principal.role).includes(requiredScope)
            ? Effect.void
            : Effect.fail(authorizationError(requiredScope)),
        ),
      );

    const getAccessHealthSnapshot = Effect.fn("getAccessHealthSnapshot")(function* () {
      yield* subscriptionAuth.reload();
      botInbox.reload();
      yield* syncSubscriptionProviderSettings;

      const [providers, bots, snapshot, settings] = yield* Effect.all([
        providerRegistry.getProviders,
        projectionBots
          .listAll()
          .pipe(Effect.mapError((cause) => new SubscriptionAuthError({ reason: cause.message }))),
        projectionSnapshotQuery
          .getShellSnapshot()
          .pipe(Effect.mapError((cause) => new SubscriptionAuthError({ reason: cause.message }))),
        serverSettings.getSettings.pipe(
          Effect.mapError((cause) => new SubscriptionAuthError({ reason: cause.message })),
        ),
      ]);

      const dependentBots = subscriptionDependentBots(
        bots.map((bot) => ({ id: bot.botId, name: bot.name, engine: bot.engine })),
        providers,
      );

      const subscriptionStatuses = subscriptionAuth.statuses(dependentBots);

      const access = buildProviderAccessCapabilities(
        subscriptionStatuses,
        providers,
        (instanceId) => subscriptionAuth.providerInstanceRequestHealth(instanceId),
        snapshot.mcpServers ?? [],
        bots.map((bot) => ({
          id: bot.botId,
          name: bot.name,
          engine: bot.engine,
          disabledMcpServerIds: bot.disabledMcpServerIds,
        })),
        (serverId) => subscriptionAuth.mcpRequestHealth(serverId),
      );

      syncConnectorIncidents(botInbox, subscriptionStatuses);
      syncAccessIncidents(botInbox, access);

      return {
        providers: subscriptionStatuses.map((status) => ({
          ...status,
          dependentBots: status.dependentBots.filter((dependent) =>
            bots.some(
              (bot) =>
                bot.botId === dependent.id &&
                bot.engine?.provider === subscriptionDriverByProvider[status.provider],
            ),
          ),
        })),
        accounts: Object.entries(deriveProviderInstanceConfigMap(settings)).flatMap(
          ([instanceId, instance]) => {
            const provider = subscriptionProviderForDriver(instance.driver);

            return provider && instanceId !== subscriptionDriverByProvider[provider]
              ? [
                  subscriptionAuth.accountStatus(
                    provider,
                    ProviderInstanceId.make(instanceId),
                    bots
                      .filter((bot) => bot.engine?.provider === instanceId)
                      .map((bot) => ({
                        id: bot.botId,
                        name: bot.name,
                        provider,
                      })),
                  ),
                ]
              : [];
          },
        ),
        access,
        linkedAccounts: subscriptionAuth.linkedAccountStatuses(),
        inbox: botInbox.list(),
      };
    });

    const getImageProviderSnapshot = Effect.fn("getImageProviderSnapshot")(function* () {
      yield* subscriptionAuth.reload();

      const settings = yield* serverSettings.getSettings.pipe(
        Effect.mapError((cause) => new ImageGenerationError({ reason: cause.message })),
      );

      return {
        providers: imageProviderStatuses({
          settings: settings.imageGeneration,
          subscriptionStatuses: subscriptionAuth.statuses(),
          chatgptAccountConnected: subscriptionAuth.hasOpenAICodexAccount(),
          requestHealth: (provider) => subscriptionAuth.imageRequestHealth(provider),
          lastGenerationAt: (provider) => subscriptionAuth.imageLastGenerationAt(provider),
        }),
      };
    });

    const authorizeEffect = <A, E, R>(
      requiredScope: AuthEnvironmentScope,
      effect: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E | EnvironmentAuthorizationError, R> =>
      authorizeScope(requiredScope).pipe(Effect.andThen(effect));

    const authorizeStream = <A, E, R>(
      requiredScope: AuthEnvironmentScope,
      stream: Stream.Stream<A, E, R>,
    ): Stream.Stream<A, E | EnvironmentAuthorizationError, R> =>
      Stream.unwrap(
        authorizeScope(requiredScope).pipe(
          Effect.as(
            stream.pipe(
              // Otto: Recheck access once per chunk; a per-item check split every batch
              // into single-event WebSocket frames.
              Stream.mapArrayEffect((chunk) =>
                authorizeScope(requiredScope).pipe(Effect.as(chunk)),
              ),
            ),
          ),
        ),
      );

    const observeRpcEffect = <A, E, R>(
      method: string,
      effect: Effect.Effect<A, E, R>,
      traceAttributes?: Parameters<typeof instrumentRpcEffect>[2],
    ) =>
      instrumentRpcEffect(
        method,
        authorizeEffect(requiredScopeForRpcMethod(method), effect),
        traceAttributes,
      );

    const observeRpcStream = <A, E, R>(
      method: string,
      stream: Stream.Stream<A, E, R>,
      traceAttributes?: Parameters<typeof instrumentRpcEffect>[2],
    ) =>
      instrumentRpcStream(
        method,
        authorizeStream(requiredScopeForRpcMethod(method), stream),
        traceAttributes,
      );

    const observeRpcStreamEffect = <A, StreamError, StreamContext, EffectError, EffectContext>(
      method: string,
      effect: Effect.Effect<
        Stream.Stream<A, StreamError, StreamContext>,
        EffectError,
        EffectContext
      >,
      traceAttributes?: Parameters<typeof instrumentRpcEffect>[2],
    ) =>
      instrumentRpcStreamEffect(
        method,
        authorizeEffect(requiredScopeForRpcMethod(method), effect).pipe(
          Effect.map((stream) => authorizeStream(requiredScopeForRpcMethod(method), stream)),
        ),
        traceAttributes,
      );

    const toDispatchCommandError = (cause: unknown, fallbackMessage: string) =>
      isOrchestrationDispatchCommandError(cause)
        ? cause
        : new OrchestrationDispatchCommandError({
            message: cause instanceof Error ? cause.message : fallbackMessage,
            cause,
          });

    const randomUUID = crypto.randomUUIDv4.pipe(
      Effect.mapError((cause) =>
        toDispatchCommandError(cause, "Failed to generate orchestration command identifier."),
      ),
    );

    const serverCommandId = (tag: string) =>
      randomUUID.pipe(Effect.map((uuid) => CommandId.make(`server:${tag}:${uuid}`)));

    const loadEnvironmentPeople = () =>
      Effect.all({
        clientSessions: serverAuth.listClientSessions(currentSessionId),
        directory: accounts.listPeople().pipe(Effect.orElseSucceed(() => [])),
      }).pipe(
        Effect.map(({ clientSessions, directory }) => {
          const currentClient = clientSessions.find(
            (session) => session.sessionId === currentSessionId,
          );

          const currentAccount = directory.find((person) => person.userId === currentPersonId);

          const hostClient = clientSessions.find((session) =>
            session.scopes.includes(AuthAccessWriteScope),
          );

          return {
            people: directory.map((person) => ({
              personId: AuthSessionId.make(person.userId),
              displayName: person.displayName,
              email: person.email,
              ...(person.image ? { image: person.image } : {}),
            })),
            current: {
              personId: currentPersonId,
              displayName:
                currentAccount?.displayName ??
                currentClient?.client.label ??
                (currentSession.scopes.includes(AuthAccessWriteScope) ? "Host" : "Paired person"),
            },
            host:
              hostClient === undefined
                ? undefined
                : {
                    personId: sessionPersonId(hostClient),
                    displayName: hostClient.client.label ?? "Host",
                  },
          };
        }),
      );

    const loadAuthAccessSnapshot = () =>
      Effect.all({
        clientSessions: serverAuth.listClientSessions(currentSessionId),
      }).pipe(
        Effect.mapError(
          (error) =>
            new AuthAccessStreamError({
              message: error.message,
            }),
        ),
      );

    const toBootstrapDispatchCommandCauseError = (cause: Cause.Cause<unknown>) => {
      const error = Cause.squash(cause);

      return isOrchestrationDispatchCommandError(error)
        ? error
        : new OrchestrationDispatchCommandError({
            message: error instanceof Error ? error.message : "Failed to start the chat.",
            cause,
          });
    };

    const loadServerConfig = Effect.gen(function* () {
      const keybindingsConfig = yield* keybindings.loadConfigState;
      const providers = yield* providerRegistry.getProviders;

      const settings = ServerSettings.redactServerSettingsForClient(
        yield* serverSettings.getSettings,
      );

      const environment = yield* serverEnvironment.getDescriptor;
      const auth = yield* serverAuth.getDescriptor();

      const availableEditors: ReadonlyArray<EditorId> = yield* resolveAvailableEditorsForConfig(
        externalLauncher.resolveAvailableEditors(),
      );

      const fileManagerRevealKind = availableEditors.includes("file-manager")
        ? yield* resolveFileManagerRevealKindForConfig(
            externalLauncher.resolveFileManagerRevealKind(),
          )
        : undefined;

      return {
        environment,
        auth,
        cwd: config.cwd,
        keybindingsConfigPath: config.keybindingsConfigPath,
        keybindings: keybindingsConfig.keybindings,
        issues: keybindingsConfig.issues,
        providers,
        availableEditors,
        // Same discovery-with-timeout treatment as editors: a slow probe
        // must not stall server.getConfig, so it degrades to no targets.
        remoteOpenTargets: yield* resolveAvailableEditorsForConfig(
          remoteOpenTargets.resolveTargets(),
        ),
        observability: {
          logsDirectoryPath: config.logsDir,
          localTracingEnabled: true,
          ...(config.otlpTracesUrl !== undefined ? { otlpTracesUrl: config.otlpTracesUrl } : {}),
          otlpTracesEnabled: config.otlpTracesUrl !== undefined,
          ...(config.otlpMetricsUrl !== undefined ? { otlpMetricsUrl: config.otlpMetricsUrl } : {}),
          otlpMetricsEnabled: config.otlpMetricsUrl !== undefined,
        },
        settings,
        shellResumeCompletionMarker: true,
        ...(fileManagerRevealKind === undefined
          ? {}
          : {
              shellRevealInFileManager: true,
              shellRevealInFileManagerKind: fileManagerRevealKind,
            }),
        threadResumeCompletionMarker: true,
        threadSnapshotPagination: true,
        boatConnectedByServer: Boolean((yield* HostProcessEnvironment).BOAT_API_KEY?.trim()),
      };
    });

    return {
      currentSession,
      clientOrigin,
      voiceCalls,
      providerRefreshes,
      currentSessionId,
      currentPersonId,
      accounts,
      crypto,
      voiceCallOwnerId,
      projectionSnapshotQuery,
      projectionBots,
      botUsageLedger,
      projectionGroups,
      projectionLibrary,
      projectionThreadMessages,
      projectionTasks,
      activityStore,
      notificationStore,
      routineRepository,
      routineRuntime,
      orchestrationEngine,
      canReplayPersistedRange,
      threadDeletionReactor,
      hasClientOrigin,
      dispatchActor,
      dispatchFromClient,
      checkpointDiffQuery,
      keybindings,
      externalLauncher,
      remoteOpenTargets,
      gitWorkflow,
      previewManager,
      portDiscovery,
      agentController,
      memories,
      providerRegistry,
      providerMaintenanceRunner,
      serverSelfUpdate,
      config,
      remoteDoctorTarget,
      subscriptionAuth,
      botInbox,
      lifecycleEvents,
      serverSettings,
      textGeneration,
      syncSubscriptionProviderSettings,
      refreshChangedSubscriptionProviders,
      resetChangedApiKeySessions,
      validateAccountInstance,
      startup,
      workspaceEntries,
      workspaceFileSystem,
      serverEnvironment,
      backgroundPolicy,
      rpcClientIds,
      serverAuth,
      secretStore,
      composioService,
      composio,
      github,
      commandReceipts,
      channelRuntime,
      channelBindingsForRuntime,
      sessions,
      usage,
      authorizationError,
      getAccessHealthSnapshot,
      getImageProviderSnapshot,
      authorizeEffect,
      authorizeStream,
      observeRpcEffect,
      observeRpcStream,
      observeRpcStreamEffect,
      toDispatchCommandError,
      randomUUID,
      serverCommandId,
      loadEnvironmentPeople,
      loadAuthAccessSnapshot,
      toBootstrapDispatchCommandCauseError,
      loadServerConfig,
    };
  });

export type WsServices = Effect.Success<ReturnType<typeof createWsServices>>;
