import { createControllerState } from "./agent-controller/controller-state.ts";
import { createAuxiliaryOperations } from "./agent-controller/auxiliary-operations.ts";
import { createToolRuntime } from "./agent-controller/tool-runtime.ts";
import { createHarness } from "./agent-controller/harness.ts";
import { createWorkers } from "./agent-controller/workers.ts";
import {
  DEFAULT_MODE_ID,
  omitNullToolFields,
  mastraModelOptions,
  failureDetail,
  sessionFailureDetail,
  deleteCatalogMcpServer,
  messageText,
  permissionPolicy,
  mcpToolNeedsApproval,
  approvalDetail,
  usesMastraCode,
  disabledProviderError,
  itemType,
  ThreadIdBrand,
  approvalDecision,
  toProviderSession,
} from "./agent-controller/policy.ts";

export { usesMastraCode } from "./agent-controller/policy.ts";

import type { AgentControllerLiveOptions } from "./agent-controller/options.ts";

export type { AgentControllerLiveOptions } from "./agent-controller/options.ts";

import { createMemoryAccess, type MemoryTurn } from "./agent-controller/memory-access.ts";
import { createTurnObservations } from "./agent-controller/observations.ts";
import { createDelegation } from "./agent-controller/delegation.ts";
import { createEvents } from "./agent-controller/events.ts";
import { createTurnLifecycle } from "./agent-controller/turn-lifecycle.ts";
import { createEngineRouting } from "./agent-controller/engine-routing.ts";
import { createSessionLifecycle } from "./agent-controller/session-lifecycle.ts";
import { createTurnRequests } from "./agent-controller/turn-requests.ts";
import { createApprovals } from "./agent-controller/approvals.ts";
import { createConversation } from "./agent-controller/conversation.ts";

import { createMcpManager, type McpManager } from "@mastra/code-sdk/mcp/index";

import { type ProviderRuntimeEvent, type RuntimeMode, ThreadId } from "@otto/contracts";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schedule from "effect/Schedule";
import * as Ref from "effect/Ref";

import { ProjectionThreadMessageRepositoryLive } from "../../persistence/layers/projection-thread-messages.ts";
import { ProjectionTurnRepositoryLive } from "../../persistence/layers/projection-turns.ts";

import { createOttoChannelRuntime } from "../otto-channel-runtime.ts";
import { createOttoBotStateRuntime } from "../otto-bot-state-runtime.ts";

import {
  createOttoPluginRuntime,
  type OttoPluginRuntimeOptions,
} from "../otto-catalog-tool-handlers.ts";

import { authenticateMcpServer } from "../mcp-server-authentication.ts";

import { AgentControllerRuntimeError } from "../errors.ts";
import { AgentController } from "../services/agent-controller.ts";

import {
  type PendingTurn,
  type ActiveSession,
  type LegacyTurnMemoryState,
  type LegacyResourceIdentity,
  type WorkerOrchestration,
} from "./agent-controller/state.ts";

import { toMcpServerConfigs } from "./agent-controller/mcp-configuration.ts";

const APPROVAL_FREE_MASTRA_TOOL_NAMES: ReadonlySet<string> = new Set(["ask_user"]);

const make = (options?: AgentControllerLiveOptions) =>
  Effect.gen(function* () {
    const {
      config,
      fileSystem,
      path,
      legacyProviderBridge,
      botUsageLedger,
      serverSettings,
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
      unreservedMemoryCalls,
      memoryUsageByThread,
      lateWiring,
      wired,
      childWaiters,
      resolveChildWaiter,
      pendingRoutineRequests,
      clearPreviewMcpSession,
      preparePreviewMcpSession,
      sessionResources,
      authStorage,
      subscriptionAuth,
      botInbox,
      creatingRoutineReviews,
      runPromise,
      fork,
      forkPromise,
    } = yield* createControllerState(options);

    const memoryTurns = new Map<string, MemoryTurn>();

    // A turn waits on the user while any tool approval, question, or routine review
    // it opened is unanswered, or an accepted routine is still being created.
    const {
      turnStillWaiting,
      cancelPendingApproval,
      cancelAllPendingApprovals,
      adoptRun,
      failActiveTurn,
      handlePendingTurnFailure,
      admitPendingTurn,
      endTurnAdmissionGeneration,
      finishTurn,
    } = createTurnLifecycle({
      runPromise,
      forkPromise,
      fork,
      pendingRoutineRequests,
      creatingRoutineReviews,
      get publish() {
        return publish;
      },
      get baseEvent() {
        return baseEvent;
      },
      get toolRuntime() {
        return toolRuntime;
      },
      memoryUsageByThread,
      get publishSessionState() {
        return publishSessionState;
      },
      sessionFailureDetail,
      get stopSessionWithResources() {
        return stopSessionWithResources;
      },
      get memoryContext() {
        return memoryContext;
      },
      memoryTurns,
      legacyProviderBridge,
      get startPendingTurn() {
        return startPendingTurn;
      },
      get queueTurnMemory() {
        return queueTurnMemory;
      },
      get completeAssistantMessages() {
        return completeAssistantMessages;
      },
      resolveChildWaiter,
      get workerRuntime() {
        return workerRuntime;
      },
      wired,
      failureDetail,
    });

    /** Calls out to a Promise-based library and types its failure. */
    const runMastra = <A>(operation: string, run: (signal: AbortSignal) => Promise<A>) =>
      Effect.tryPromise({
        try: run,
        catch: (cause) =>
          new AgentControllerRuntimeError({
            operation,
            detail: failureDetail(cause),
            cause,
          }),
      });

    const { toolRuntime } = createToolRuntime({
      sessions,
      runtimeEvents,
      toolUsageKey,
      toolUsageStarts,
      runPromise,
      botUsageLedger,
      get baseEvent() {
        return baseEvent;
      },
    });

    const { memoryContext, memoryHandlers } = createMemoryAccess({
      runPromise,
      memories,
      get memoryEnabled() {
        return memoryEnabled;
      },
      memoryTurns,
    });

    // Image providers for the GenerateImage tool, read on every session start or reuse. An
    // unreadable settings file hides the tool rather than offering a call that can only fail
    // (ProviderService denies the MCP capability the same way). Without the service, tests
    // keep the tool visible.
    const imageToolSettings = Option.isSome(serverSettings)
      ? serverSettings.value.getSettings.pipe(
          Effect.map((settings) => settings.imageGeneration),
          Effect.orElseSucceed(() => ({ chatgptEnabled: false, grokEnabled: false })),
          Effect.map(({ chatgptEnabled, grokEnabled }) => ({ chatgptEnabled, grokEnabled })),
        )
      : Effect.succeed({ chatgptEnabled: true, grokEnabled: true });

    const memoryEnabled = () =>
      Option.isSome(serverSettings)
        ? serverSettings.value.getSettings.pipe(
            Effect.map((settings) => settings.memory.enabled),
            // Fail closed: an unreadable setting must not re-enable memory the user turned off.
            Effect.orElseSucceed(() => false),
          )
        : Effect.succeed(true);

    const legacyResourceIdentity = new Map<string, LegacyResourceIdentity>();
    const legacyTurnMemory = new Map<string, Array<LegacyTurnMemoryState>>();
    const legacyPending = (key: string) => legacyTurnMemory.get(key) ?? [];

    const addLegacyPending = (key: string, pending: LegacyTurnMemoryState) =>
      legacyTurnMemory.set(key, [...legacyPending(key), pending]);

    const removeLegacyPending = (key: string, pending: LegacyTurnMemoryState) => {
      const remaining = legacyPending(key).filter((entry) => entry !== pending);

      if (remaining.length > 0) legacyTurnMemory.set(key, remaining);
      else legacyTurnMemory.delete(key);
    };

    const hasLegacyPending = (key: string, pending: LegacyTurnMemoryState) =>
      legacyPending(key).includes(pending);

    const legacyBufferedTerminals = new Map<string, Map<string, ProviderRuntimeEvent>>();

    const { drainLegacyTerminals, queueTurnMemory } = createTurnObservations({
      forkPromise,
      hasLegacyPending,
      resolveChildWaiter,
      removeLegacyPending,
      legacyPending,
      get bundle() {
        return bundle;
      },
      legacyBufferedTerminals,
      resolvedByThread,
    });

    const { delegationFor, makeDelegationRuntime } = createDelegation({
      runPromise,
      fork,
      wired,
      sessions,
      childWaiters,
      legacyProviderBridge,
      get publish() {
        return publish;
      },
      failureDetail,
    });

    const { bundle } = yield* createHarness({
      options,
      authStorage,
      subscriptionAuth,
      modelConnections,
      config,
      sessions,
      runPromise,
      legacyProviderBridge,
      sessionResources,
      orchestrationEngine,
      routineDispatcher,
      pendingRoutineRequests,
      get publishSessionState() {
        return publishSessionState;
      },
      get publish() {
        return publish;
      },
      get baseEvent() {
        return baseEvent;
      },
      turnStillWaiting,
      toolRuntime,
      memoryUsageByThread,
      get readSessionStartContext() {
        return readSessionStartContext;
      },
      unreservedMemoryCalls,
      botUsageLedger,
    });

    yield* runMastra("init", () => bundle.controller.init());

    const publish = (event: ProviderRuntimeEvent) => {
      PubSub.publishUnsafe(runtimeEvents, event);
    };

    if (Option.isSome(orchestrationEngine) && Option.isSome(projectionSnapshotQuery)) {
      const orchestration: WorkerOrchestration = {
        readSnapshot: () => runPromise(projectionSnapshotQuery.value.getCommandReadModel()),
        dispatch: (command) => runPromise(orchestrationEngine.value.dispatch(command)),
      };

      yield* Ref.update(lateWiring, (current) => ({
        ...current,
        delegationRuntime: current.delegationRuntime ?? makeDelegationRuntime(orchestration),
        workerOrchestration: orchestration,
      }));
    }

    /** Runtime mode for each hidden worker thread's turns, keyed by child thread id. */
    const workerTurnDefaults = new Map<string, RuntimeMode>();

    const { workerRuntime, workersFor } = yield* createWorkers({
      runMastra,
      wired,
      sessions,
      workerTurnDefaults,
      runPromise,
    });

    const { baseEvent, publishSessionState, completeAssistantMessages, handleControllerEvent } =
      createEvents({
        forkPromise,
        runPromise,
        publish,
        messageText,
        itemType,
        config,
        subscriptionAuth,
        cancelPendingApproval,
        sessionResources,
        get APPROVAL_FREE_MASTRA_TOOL_NAMES() {
          return APPROVAL_FREE_MASTRA_TOOL_NAMES;
        },
        omitNullToolFields,
        mcpToolNeedsApproval,
        permissionPolicy,
        legacyProviderBridge,
        toolRuntime,
        failActiveTurn,
        wired,
        workerRuntime,
        approvalDetail,
        sessionFailureDetail,
        finishTurn,
        adoptRun,
      });

    function startPendingTurn(active: ActiveSession, pending: PendingTurn) {
      forkPromise(
        "Otto turn admission failed.",
        () => runPromise(admitPendingTurn(active, pending)),
        {
          annotations: { threadId: pending.threadId, turnId: pending.turnId },
          onFailure: (cause) => handlePendingTurnFailure(active, pending, cause),
        },
      );
    }

    const { inspectEngine, resolveEngine } = createEngineRouting({
      legacyProviderBridge,
      usesMastraCode,
      disabledProviderError,
      modelConnections,
      subscriptionAuth,
      mutationLock,
      resolvedByThread,
      sessions,
      mastraModelOptions,
      runMastra,
    });

    const { readSessionStartContext, startSession } = createSessionLifecycle({
      webFetch,
      runPromise,
      projectionSnapshotQuery,
      workerRuntime,
      wired,
      sessions,
      resolvedByThread,
      usesMastraCode,
      legacyProviderBridge,
      disabledProviderError,
      options,
      failureDetail,
      runMastra,
      imageToolSettings,
      memoryEnabled,
      memoryHandlers,
      delegationFor,
      workersFor,
      toolRuntime,
      toProviderSession,
      legacyResourceIdentity,
      sessionResources,
      get stopSessionWithResources() {
        return stopSessionWithResources;
      },
      preparePreviewMcpSession,
      clearPreviewMcpSession,
      subscriptionAuth,
      botInbox,
      deleteCatalogMcpServer,
      bundle,
      mastraModelOptions,
      DEFAULT_MODE_ID,
      permissionPolicy,
      handleControllerEvent,
      publish,
      baseEvent,
      publishSessionState,
    });

    const { sendTurn, signalTurn, interruptTurn } = createTurnRequests({
      fileSystem,
      resolvedByThread,
      sessions,
      usesMastraCode,
      legacyProviderBridge,
      disabledProviderError,
      legacyResourceIdentity,
      runMastra,
      memoryContext,
      memoryTurns,
      bundle,
      addLegacyPending,
      hasLegacyPending,
      legacyHiddenWakeByTurn,
      drainLegacyTerminals,
      removeLegacyPending,
      toolRuntime,
      config,
      options,
      admitPendingTurn,
      handlePendingTurnFailure,
      legacyPending,
      legacyTurnMemory,
      legacyBufferedTerminals,
      endTurnAdmissionGeneration,
      finishTurn,
    });

    const { respondToRequest, respondToUserInput } = createApprovals({
      sessions,
      usesMastraCode,
      resolvedByThread,
      legacyProviderBridge,
      disabledProviderError,
      pendingRoutineRequests,
      turnStillWaiting,
      publish,
      baseEvent,
      publishSessionState,
      creatingRoutineReviews,
      routineDispatcher,
      ThreadIdBrand,
      toolRuntime,
      approvalDecision,
      runMastra,
    });

    const { stopSessionWithResources, stopSession, rollbackConversation } = createConversation({
      fileSystem,
      sessions,
      legacyProviderBridge,
      legacyPending,
      legacyTurnMemory,
      legacyBufferedTerminals,
      runMastra,
      sessionResources,
      clearPreviewMcpSession,
      legacyResourceIdentity,
      usesMastraCode,
      resolvedByThread,
      toolRuntime,
      endTurnAdmissionGeneration,
      finishTurn,
      cancelAllPendingApprovals,
      publishSessionState,
      bundle,
      memoryUsageByThread,
      workerRuntime,
      workerTurnDefaults,
      projectionMessages,
      projectionTurns,
      config,
      interruptTurn,
      startSession,
    });

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        for (const [threadId, active] of sessions) {
          endTurnAdmissionGeneration(active);
          active.pendingTurns.length = 0;
          active.admittingTurn = null;
          active.session.abort();

          if (active.activeTurn) {
            finishTurn(ThreadId.make(threadId), active, "interrupted");
          }

          active.unsubscribe();
          yield* runMastra("deleteSession", () =>
            bundle.controller.deleteSession({ resourceId: threadId }),
          ).pipe(Effect.ignoreCause({ log: true }));
          yield* clearPreviewMcpSession(ThreadId.make(threadId));
          toolRuntime.unregisterSession(threadId);
        }

        for (const threadId of legacyResourceIdentity.keys()) {
          yield* clearPreviewMcpSession(ThreadId.make(threadId));
        }

        legacyTurnMemory.clear();
        legacyBufferedTerminals.clear();
        legacyResourceIdentity.clear();
        sessions.clear();
        yield* runMastra("resources.shutdown", () => sessionResources.shutdown()).pipe(
          Effect.ignoreCause({ log: true }),
        );
      }),
    );

    yield* runMastra("resources.retryFailedWorkspaceSleeps", () =>
      sessionResources.retryFailedWorkspaceSleeps(),
    ).pipe(
      Effect.ignoreCause({ log: true }),
      Effect.repeat(Schedule.spaced("30 seconds")),
      Effect.forkScoped,
    );

    const auxiliary = createAuxiliaryOperations({
      bundle,
      runMastra,
      legacyProviderBridge,
      sessions,
      runtimeEvents,
      legacyHiddenWakeByTurn,
      legacyPending,
      subscriptionAuth,
      resolvedByThread,
      legacyBufferedTerminals,
      drainLegacyTerminals,
    });

    return AgentController.of({
      readConversationMemory: auxiliary.readConversationMemory,
      clearConversationMemory: auxiliary.clearConversationMemory,
      restoreConversationMemory: auxiliary.restoreConversationMemory,
      listSessions: auxiliary.listSessions,
      get streamEvents() {
        return auxiliary.streamEvents;
      },
      configurePluginRuntime: (input: OttoPluginRuntimeOptions) =>
        Ref.update(lateWiring, (current) => ({
          ...current,
          pluginRuntimeOptions: input,
          pluginRuntime: createOttoPluginRuntime(input),
        })),
      configureDelegation: (input) =>
        Ref.update(lateWiring, (current) => ({
          ...current,
          botStateRuntime: createOttoBotStateRuntime(input),
          channelRuntime: createOttoChannelRuntime(input),
          delegationRuntime: current.delegationRuntime ?? makeDelegationRuntime(input),
          workerOrchestration: current.workerOrchestration ?? input,
        })),
      failDelegation: ({ threadId, error }) =>
        Effect.sync(() =>
          resolveChildWaiter(threadId, { state: "failed", turnId: null, error }),
        ).pipe(
          Effect.andThen(workerRuntime.childTurnFinished(threadId, { state: "failed", error })),
        ),
      dispatchDelegation: (input) =>
        Effect.tryPromise({
          try: async () => {
            const dispatchDelegation = wired().delegationRuntime?.dispatchDelegation;

            if (!dispatchDelegation) throw new Error("Bot work is not available yet.");

            return dispatchDelegation(input);
          },
          catch: (cause) =>
            new AgentControllerRuntimeError({
              operation: "dispatchDelegation",
              detail: failureDetail(cause),
              cause,
            }),
        }),
      authenticateMcpServer: ({ server, onAuthorizationUrl }) =>
        runMastra("mcp.authenticate", async (signal) => {
          const recoveryFailures: string[] = [];

          const managerSessions = sessionResources.getMcpManagerSessionsForServer(
            String(server.id),
          );

          const status = await authenticateMcpServer({
            server,
            managers: managerSessions.map(({ manager }) => manager),
            managerThreadIds: managerSessions.map(({ threadId }) => threadId),
            createManager: () =>
              (options?.makeMcpManager ?? createMcpManager)(
                path.join(config.stateDir, "bot-mcp-runtime"),
                ".otto-runtime",
                toMcpServerConfigs([server]),
              ),
            onAuthorizationUrl,
            signal,
            recordSuccess: (serverId) => subscriptionAuth.recordMcpRequestSuccess(serverId),
            recordFailure: (serverId, message) =>
              subscriptionAuth.recordMcpRequestFailure(serverId, message),
            recordRecoveryFailure: (serverId, message) => {
              recoveryFailures.push(message);
              fork("MCP session recovery failed after authentication.", Effect.fail(message), {
                serverId,
              });
            },
          });

          return { toolCount: status.toolCount, recoveryFailures };
        }),

      listMcpServerTools: ({ server }) =>
        runMastra("mcp.listTools", async () => {
          const serverId = String(server.id);

          const statusOf = (manager: McpManager) =>
            manager.getServerStatuses().find((status) => status.name === serverId);

          const toolNamesOf = (toolNames: ReadonlyArray<string>) =>
            toolNames.map((name) => name.replace(`${serverId}_`, ""));

          const live = sessionResources
            .getMcpManagerSessionsForServer(serverId)
            .map(({ manager }) => statusOf(manager))
            .find((status) => status?.connected);

          if (live) return { toolNames: toolNamesOf(live.toolNames), needsSignIn: false };

          const manager = (options?.makeMcpManager ?? createMcpManager)(
            path.join(config.stateDir, "bot-mcp-runtime"),
            ".otto-runtime",
            toMcpServerConfigs([server]),
          );

          try {
            await manager.init();
            const status = statusOf(manager);

            if (status?.needsAuth) return { toolNames: [], needsSignIn: true };

            if (!status?.connected) {
              throw new Error(status?.error ?? "The server did not connect.");
            }

            return { toolNames: toolNamesOf(status.toolNames), needsSignIn: false };
          } finally {
            await manager.disconnect().catch(() => undefined);
          }
        }),

      resolveEngine,
      inspectEngine,
      startSession,
      sendTurn,
      signalTurn,
      interruptTurn,
      respondToRequest,
      respondToUserInput,
      stopSession,

      rollbackConversation,
      uploadFeedback: legacyProviderBridge.uploadFeedback,
    });
  });

export const agentControllerLayerWith = (options?: AgentControllerLiveOptions) =>
  Layer.effect(AgentController, make(options));

export const AgentControllerLive = Layer.effect(AgentController, make()).pipe(
  Layer.provide(ProjectionThreadMessageRepositoryLive),
  Layer.provide(ProjectionTurnRepositoryLive),
);

export {
  createOttoMastraAuthStorage,
  delegatedUsageReceipt,
  mastraConnectionIssue,
  recordProviderAccessHealth,
} from "./agent-controller/provider-access.ts";

export {
  toMcpServerConfigs,
  toMcpServerConfig,
  mcpServerIdForToolName,
} from "./agent-controller/mcp-configuration.ts";
