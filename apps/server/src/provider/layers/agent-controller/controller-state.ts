import * as BotWorkspaceIO from "../../workspace/bot-workspace-io.ts";
import { createSessionResources } from "./session-resources.ts";
import { BotInboxService } from "../../../bot-inbox/service.ts";
import { SubscriptionAuthService } from "../../../subscription-auth/service.ts";
import { createOttoMastraAuthStorage } from "./provider-access.ts";
import { createPreviewMcpSessions } from "./preview-mcp-sessions.ts";
import type { AgentControllerLiveOptions } from "./options.ts";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import {
  ProviderDriverKind,
  TurnId,
  type BotId,
  type OttoCreateRoutineInput,
  type ProviderRuntimeEvent,
  ThreadId,
} from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import { ServerConfig } from "../../../config.ts";
import { OrchestrationEngineService } from "../../../orchestration/services/orchestration-engine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/services/projection-snapshot-query.ts";
import { ProjectionThreadMessageRepository } from "../../../persistence/services/projection-thread-messages.ts";
import { ProjectionTurnRepository } from "../../../persistence/services/projection-turns.ts";
import * as McpSessionRegistry from "../../../mcp/mcp-session-registry.ts";
import * as ServerSettings from "../../../server-settings.ts";
import { BotUsageLedger } from "../../../usage/bot-usage-ledger.ts";
import type { ProviderInstanceRoutingInfo } from "../../services/provider-adapter-registry.ts";
import { type OttoChannelRuntime } from "../../otto-channel-runtime.ts";
import { type OttoBotStateRuntime } from "../../otto-bot-state-runtime.ts";
import { type OttoDelegationChildOutcome } from "../../otto-delegation-runtime.ts";
import * as OttoRuntimeSeam from "../../otto-runtime-seam.ts";
import * as PendingWaiters from "../../pending-waiters.ts";
import {
  createOttoPluginRuntime,
  type OttoPluginRuntimeOptions,
} from "../../otto-catalog-tool-handlers.ts";
import { createOttoWebFetch } from "../../otto-web-fetch.ts";
import { LegacyProviderBridge } from "../../services/legacy-provider-bridge.ts";
import { RoutineDraftDispatcher } from "../../../routines/routine-draft-dispatcher.ts";
import { Memories } from "../../../memory/memories.ts";
import { ServerSecretStore } from "../../../auth/server-secret-store.ts";
import { makeGitHubAccounts } from "../../../github/github-accounts.ts";
import { createBotGitHubLogins } from "../../bot-github-login.ts";
import { type ResolvedEngine, type ActiveSession } from "./state.ts";

export const createControllerState = Effect.fn("createControllerState")(function* (
  options?: AgentControllerLiveOptions,
) {
  const config = yield* ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const legacyProviderBridge = yield* LegacyProviderBridge;
  const botUsageLedger = yield* BotUsageLedger;
  const serverSettings = yield* Effect.serviceOption(ServerSettings.ServerSettingsService);
  const mcpSessionRegistry = yield* Effect.serviceOption(McpSessionRegistry.McpSessionRegistry);
  // Promise-based callers re-enter Effect only through this seam; its fibers
  // are interrupted when the layer scope closes.
  const { runPromise, fork, forkPromise } = yield* OttoRuntimeSeam.makeOttoRuntimeSeam;
  const routineDraftDispatcher = yield* Effect.serviceOption(RoutineDraftDispatcher);
  const memories = yield* Effect.serviceOption(Memories);
  const routineDispatcher = Option.getOrUndefined(routineDraftDispatcher);
  const mutationLock = yield* Semaphore.make(1);
  const runtimeEvents = yield* PubSub.unbounded<ProviderRuntimeEvent>();
  const orchestrationEngine = yield* Effect.serviceOption(OrchestrationEngineService);
  const projectionSnapshotQuery = yield* Effect.serviceOption(ProjectionSnapshotQuery);
  const projectionMessages = yield* Effect.serviceOption(ProjectionThreadMessageRepository);
  const projectionTurns = yield* Effect.serviceOption(ProjectionTurnRepository);
  const resolvedByThread = new Map<string, ResolvedEngine>();
  const webFetch = createOttoWebFetch(options?.webFetch);

  const modelConnections = new Map<
    string,
    NonNullable<ProviderInstanceRoutingInfo["mastraConnection"]>
  >();

  const sessions = new Map<string, ActiveSession>();

  // Tool calls consume no model tokens, so their entries hold no cap while they run.
  // `persisted` is false when the start write failed; finish then writes the whole entry.
  const toolUsageStarts = new Map<
    string,
    {
      persisted: boolean;
      readonly turnId: TurnId | null;
      readonly provider: ProviderDriverKind | null;
      readonly model: string | null;
    }
  >();

  // Providers only promise tool-call ids unique within a chat.
  const toolUsageKey = (input: { readonly threadId: string; readonly toolCallId: string }) =>
    `tool:${input.threadId}:${input.toolCallId}`;

  const legacyHiddenWakeByTurn = new Map<string, boolean>();

  const turnUsageByThread = new Map<string, { readonly botId: BotId; turnId: TurnId }>();

  const { clearPreviewMcpSession, preparePreviewMcpSession } = createPreviewMcpSessions({
    options,
    mcpSessionRegistry,
    serverSettings,
  });

  /**
   * Orchestration-backed runtimes. The orchestration layer is built after this
   * controller, so it hands them over through configurePluginRuntime and
   * configureDelegation.
   */
  const lateWiring = yield* Ref.make<{
    readonly channelRuntime?: OttoChannelRuntime;
    readonly pluginRuntime?: ReturnType<typeof createOttoPluginRuntime>;
    readonly pluginRuntimeOptions?: OttoPluginRuntimeOptions;
    readonly botStateRuntime?: OttoBotStateRuntime;
    readonly delegationRuntime?: AgentControllerLiveOptions["delegationRuntime"];
  }>({ delegationRuntime: options?.delegationRuntime });

  const wired = () => Ref.getUnsafe(lateWiring);

  const childWaiters = yield* PendingWaiters.makePendingWaiters<null, OttoDelegationChildOutcome>(
    "The agent controller stopped.",
  );

  const resolveChildWaiter = (threadId: ThreadId, outcome: OttoDelegationChildOutcome) => {
    childWaiters.resolve(String(threadId), outcome);
  };

  const pendingRoutineRequests = yield* PendingWaiters.makePendingWaiters<
    {
      readonly threadId: string;
      readonly input: OttoCreateRoutineInput;
      readonly timezone: string;
    },
    unknown,
    Error
  >("The agent controller stopped before the routine review finished.");

  // Accepted routine reviews whose routine is still being created, by tool call.
  const creatingRoutineReviews = new Map<string, string>();

  yield* fileSystem
    .makeDirectory(config.stateDir, { recursive: true, mode: 0o700 })
    .pipe(Effect.orDie);

  const authStorage = yield* createOttoMastraAuthStorage(config.secretsDir);
  const subscriptionAuth = yield* SubscriptionAuthService.forSecretsDir(config.secretsDir);
  const botInbox = BotInboxService.forSecretsDir(config.secretsDir);

  const { sessionResources } = createSessionResources({
    io: BotWorkspaceIO.makeBotWorkspaceIO(fileSystem, path, runPromise),
    get config() {
      return config;
    },
    get subscriptionAuth() {
      return subscriptionAuth;
    },
    get options() {
      return options;
    },
  });

  const github = Option.map(yield* Effect.serviceOption(ServerSecretStore), (store) =>
    makeGitHubAccounts(store),
  );

  const githubLogins = createBotGitHubLogins({
    turnLogin: (personId) =>
      Option.match(github, {
        onNone: () => Promise.resolve(undefined),
        onSome: (accounts) =>
          runPromise(accounts.turnLogin(personId).pipe(Effect.map(Option.getOrUndefined))),
      }),
    computer: (threadId) => sessionResources.computer(threadId),
  });

  return {
    sessionResources,
    githubLogins,
    authStorage,
    subscriptionAuth,
    botInbox,
    config,
    fileSystem,
    path,
    legacyProviderBridge,
    botUsageLedger,
    serverSettings,
    mcpSessionRegistry,
    routineDraftDispatcher,
    memories,
    routineDispatcher,
    mutationLock,
    runtimeEvents,
    orchestrationEngine,
    projectionSnapshotQuery,
    projectionMessages,
    projectionTurns,
    resolvedByThread,
    webFetch,
    modelConnections,
    sessions,
    toolUsageStarts,
    toolUsageKey,
    legacyHiddenWakeByTurn,
    turnUsageByThread,
    lateWiring,
    wired,
    childWaiters,
    resolveChildWaiter,
    pendingRoutineRequests,
    clearPreviewMcpSession,
    preparePreviewMcpSession,
    creatingRoutineReviews,
    runPromise,
    fork,
    forkPromise,
  };
});
