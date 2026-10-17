import type { AuthStorage } from "@mastra/code-sdk/auth/storage";
import type { OttoToolRuntime } from "../../otto-tool-runtime.ts";
import type { AgentControllerLiveOptions } from "./options.ts";
import { failureDetail, ThreadIdBrand } from "./policy.ts";

import * as NodeCrypto from "node:crypto";

import * as Path from "effect/Path";

import {
  OttoUsageReservationId,
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeRequestId,
  RoutineId,
  TurnId,
  type BotId,
  type OttoCreateRoutineInput,
  type OttoUpdateRoutineInput,
  type ProviderRuntimeEvent,
  ThreadId,
  OTTO_CREATE_ROUTINE_TOOL_NAME,
} from "@otto/contracts";

import * as Effect from "effect/Effect";

import * as Option from "effect/Option";

import { ServerConfig } from "../../../config.ts";

import { OrchestrationEngineService } from "../../../orchestration/services/orchestration-engine.ts";

import {
  OTTO_TURN_USAGE_RESERVATION_TOKENS,
  BotUsageLedger,
} from "../../../usage/bot-usage-ledger.ts";
import { SubscriptionAuthService } from "../../../subscription-auth/service.ts";
import { makeOttoMastraHarness } from "../../otto-mastra-harness.ts";
import { chatTimeZone } from "../../otto-agent-instructions.ts";
import { abandonUnpublishedText } from "./events.ts";

import { OTTO_ROUTINE_REVIEW_TIMEOUT, type PendingWaiters } from "../../pending-waiters.ts";

import { OttoSessionResources } from "../../otto-session-resources.ts";

import { AgentControllerRuntimeError } from "../../errors.ts";

import { LegacyProviderBridge } from "../../services/legacy-provider-bridge.ts";
import { RoutineDraftDispatcher } from "../../../routines/routine-draft-dispatcher.ts";

import { type ActiveSession } from "./state.ts";

import { nowIso } from "./event-identity.ts";

export function createHarness(deps: {
  readonly options: AgentControllerLiveOptions | undefined;
  readonly authStorage: AuthStorage;
  readonly subscriptionAuth: SubscriptionAuthService;
  readonly modelConnections: Map<
    string,
    {
      readonly environment: NodeJS.ProcessEnv;
      readonly instanceEnvironment: NodeJS.ProcessEnv;
      readonly useSavedCredential: boolean;
    }
  >;
  readonly config: ServerConfig["Service"];
  readonly sessions: Map<string, ActiveSession>;
  readonly runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
  readonly legacyProviderBridge: LegacyProviderBridge["Service"];
  readonly sessionResources: OttoSessionResources;
  readonly orchestrationEngine: Option.Option<OrchestrationEngineService["Service"]>;
  readonly routineDispatcher: RoutineDraftDispatcher["Service"] | undefined;
  readonly pendingRoutineRequests: PendingWaiters<
    {
      readonly threadId: string;
      readonly input: OttoCreateRoutineInput;
      readonly timezone: string;
    },
    unknown,
    Error
  >;
  readonly publishSessionState: (
    threadId: ThreadId,
    active: ActiveSession,
    state: "ready" | "running" | "waiting" | "stopped" | "error",
    reason?: string,
  ) => void;
  readonly publish: (event: ProviderRuntimeEvent) => void;
  readonly baseEvent: (
    threadId: ThreadId,
    active: Pick<ActiveSession, "provider" | "providerInstanceId">,
    turnId?: TurnId,
  ) => {
    turnId?: TurnId;
    eventId: EventId;
    provider: ProviderDriverKind;
    providerInstanceId: ProviderInstanceId;
    threadId: ThreadId;
    createdAt: string;
  };
  readonly turnStillWaiting: (threadId: string, active: ActiveSession) => boolean;
  readonly toolRuntime: OttoToolRuntime;
  readonly turnUsageByThread: Map<string, { readonly botId: BotId; turnId: TurnId }>;
  readonly botUsageLedger: BotUsageLedger["Service"];
}) {
  const routineDispatcher = deps.routineDispatcher;

  return Effect.gen(function* () {
    const path = yield* Path.Path;
    const makeMastraHarness = deps.options?.makeMastraHarness ?? makeOttoMastraHarness;

    const bundle = yield* makeMastraHarness({
      authStorage: deps.authStorage,
      getKimiAccess: (instanceId, threadId) =>
        deps.subscriptionAuth.getKimiForCodingAccess(instanceId, threadId),
      getOpenCodeGoApiKey: async (instanceId, threadId) =>
        deps.subscriptionAuth.getApiKeyCredential("opencode-go", instanceId, threadId),
      getSubscriptionApiKey: (provider, instanceId, threadId) =>
        deps.subscriptionAuth.getApiKeyCredential(provider, instanceId, threadId),
      getSubscriptionOAuth: (provider, instanceId, threadId) =>
        deps.subscriptionAuth.getOAuthCredential(provider, instanceId, threadId),
      getSubscriptionAccessToken: (provider, instanceId, threadId) =>
        deps.subscriptionAuth.getAccessToken(provider, instanceId, threadId),
      getModelConnection: (providerInstanceId) => {
        const connection = deps.modelConnections.get(providerInstanceId);

        return connection ? { ...connection, instanceId: providerInstanceId } : undefined;
      },
      memoryDbPath: path.join(deps.config.stateDir, "mastra-observational-memory.sqlite"),
      getThreadTools: (threadId) => deps.sessionResources.getConnectorTools(threadId),
      onStreamRetry: (threadId) => {
        const turn = deps.sessions.get(threadId)?.activeTurn;

        if (turn) abandonUnpublishedText(turn);
      },
      ...(routineDispatcher
        ? {
            listRoutines: (threadId: string) =>
              deps.runPromise(
                routineDispatcher
                  .listForThread(ThreadIdBrand(threadId))
                  .pipe(Effect.map((routines) => ({ routines: [...routines] }))),
              ),
            deleteRoutines: (threadId: string, routineIds: ReadonlyArray<string>) =>
              deps.runPromise(
                routineDispatcher
                  .deleteForThread(
                    ThreadIdBrand(threadId),
                    routineIds.map((routineId) => RoutineId.make(routineId)),
                  )
                  .pipe(
                    Effect.map((result) => ({
                      status: result.status,
                      deletedRoutineIds: [...result.routineIds],
                    })),
                  ),
              ),
            updateRoutine: (threadId: string, routineId: string, input: OttoUpdateRoutineInput) =>
              deps.runPromise(
                routineDispatcher
                  .updateForThread(ThreadIdBrand(threadId), RoutineId.make(routineId), input)
                  .pipe(
                    Effect.map((result) => ({ status: result.status, enabled: result.enabled })),
                  ),
              ),
            setRoutinePaused: (threadId: string, routineId: string, paused: boolean) =>
              deps.runPromise(
                routineDispatcher
                  .setPausedForThread(ThreadIdBrand(threadId), RoutineId.make(routineId), paused)
                  .pipe(Effect.map((result) => ({ status: result.status }))),
              ),
            createRoutine: (threadId: string, input: OttoCreateRoutineInput) => {
              const active = deps.sessions.get(threadId);

              if (!active) {
                return Promise.reject(new Error("Send a message before creating a routine."));
              }

              // Turns the server starts itself, such as restart recovery, carry no
              // device timezone. The review card shows the timezone before approval.
              const timezone = chatTimeZone(active.toolSession.timezone);

              const requestId = `routine-${NodeCrypto.randomUUID()}`;

              return deps.runPromise(
                deps.pendingRoutineRequests
                  .wait(
                    requestId,
                    { threadId, input, timezone },
                    {
                      timeout: OTTO_ROUTINE_REVIEW_TIMEOUT,
                      timeoutMessage:
                        "The routine review expired without a response. Ask again to create the routine.",
                      onOpen: () => {
                        if (active.activeTurn) active.activeTurn.waiting = true;
                        deps.publishSessionState(ThreadIdBrand(threadId), active, "waiting");
                        deps.publish({
                          ...deps.baseEvent(
                            ThreadIdBrand(threadId),
                            active,
                            active.activeTurn?.turnId,
                          ),
                          requestId: RuntimeRequestId.make(requestId),
                          type: "request.opened",
                          payload: {
                            requestType: "dynamic_tool_call",
                            detail: "Review routine",
                            toolName: OTTO_CREATE_ROUTINE_TOOL_NAME,
                            args: { ...input, timezone },
                            options: [
                              { decision: "accept", label: "Create routine" },
                              { decision: "decline", label: "Cancel" },
                            ],
                          },
                        });
                      },
                    },
                  )
                  .pipe(
                    Effect.tapErrorTag("PendingWaiterTimeoutError", () =>
                      Effect.sync(() => {
                        // Close the review card so the chat no longer waits on the user.
                        const current = deps.sessions.get(threadId);

                        if (!current?.activeTurn) return;
                        current.activeTurn.waiting = deps.turnStillWaiting(threadId, current);
                        deps.publish({
                          ...deps.baseEvent(
                            ThreadIdBrand(threadId),
                            current,
                            current.activeTurn.turnId,
                          ),
                          requestId: RuntimeRequestId.make(requestId),
                          type: "request.resolved",
                          payload: {
                            requestType: "dynamic_tool_call" as const,
                            decision: "cancel",
                            actor: "system",
                            target: OTTO_CREATE_ROUTINE_TOOL_NAME,
                            outcome: "cancelled",
                          },
                        });
                        deps.publishSessionState(
                          ThreadIdBrand(threadId),
                          current,
                          current.activeTurn.waiting ? "waiting" : "running",
                        );
                      }),
                    ),
                  ),
              );
            },
          }
        : {}),
      toolRuntime: deps.toolRuntime,
      startCompaction: async ({ threadId, modelId }) => {
        const context = deps.turnUsageByThread.get(threadId);
        const active = deps.sessions.get(threadId);
        const botId = context?.botId ?? active?.toolSession.botId;

        if (!active || !botId) return undefined;
        const callId = `compaction:${NodeCrypto.randomUUID()}`;

        await deps.runPromise(
          deps.botUsageLedger.reserve({
            reservationId: OttoUsageReservationId.make(callId),
            sourceKey: callId,
            botId,
            threadId: ThreadIdBrand(threadId),
            turnId: context?.turnId ?? active.activeTurn?.turnId ?? null,
            category: "compaction",
            maximumTokens: OTTO_TURN_USAGE_RESERVATION_TOKENS,
            provider: active.provider,
            model: active.model ?? modelId,
            createdAt: nowIso(),
          }),
        );

        return callId;
      },
      finishCompaction: async ({ callId, usage, error }) => {
        await deps.runPromise(
          deps.botUsageLedger.settle(
            usage
              ? {
                  reservationId: OttoUsageReservationId.make(callId),
                  state: "reported",
                  inputTokens: usage.inputTokens,
                  cachedInputTokens: usage.cachedInputTokens,
                  cacheCreationTokens: usage.cacheCreationTokens,
                  outputTokens: usage.outputTokens,
                  reasoningTokens: null,
                  settledAt: nowIso(),
                }
              : {
                  reservationId: OttoUsageReservationId.make(callId),
                  state: "unavailable",
                  reason: error?.message || "Compaction usage was unavailable.",
                  settledAt: nowIso(),
                },
          ),
        );
      },
    }).pipe(
      Effect.mapError(
        (cause) =>
          new AgentControllerRuntimeError({
            operation: "construct",
            detail: failureDetail(cause),
            cause,
          }),
      ),
    );

    return { makeMastraHarness, bundle };
  });
}
