import {
  OttoUsageReservationId,
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  TurnId,
  type ProviderRuntimeEvent,
  ThreadId,
} from "@otto/contracts";

import * as Effect from "effect/Effect";

import * as PubSub from "effect/PubSub";

import { BotInboxService } from "../../../bot-inbox/service.ts";

import { recordUserActionIncident } from "../../../bot-inbox/user-action-incidents.ts";

import { BotUsageLedger } from "../../../usage/bot-usage-ledger.ts";

import { createOttoToolRuntime } from "../../otto-tool-runtime.ts";

import { type ActiveSession } from "./state.ts";

import { nowIso, eventId } from "./event-identity.ts";

export function createToolRuntime(deps: {
  readonly botInbox: BotInboxService;
  readonly sessions: Map<string, ActiveSession>;
  readonly runtimeEvents: PubSub.PubSub<ProviderRuntimeEvent>;
  readonly toolUsageKey: (input: {
    readonly threadId: string;
    readonly toolCallId: string;
  }) => string;
  readonly toolUsageStarts: Map<
    string,
    {
      persisted: boolean;
      readonly turnId: TurnId | null;
      readonly provider: ProviderDriverKind | null;
      readonly model: string | null;
    }
  >;
  readonly runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
  readonly botUsageLedger: BotUsageLedger["Service"];
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
}) {
  const toolRuntime = createOttoToolRuntime({
    onUserActionRequired: (input) => {
      recordUserActionIncident(deps.botInbox, input);
    },
    onReceipt: (receipt) => {
      const active = deps.sessions.get(String(receipt.threadId));

      if (!active) return;
      PubSub.publishUnsafe(deps.runtimeEvents, {
        eventId: eventId(),
        provider: active.provider,
        providerInstanceId: active.providerInstanceId,
        threadId: receipt.threadId,
        ...(active.activeTurn ? { turnId: active.activeTurn.turnId } : {}),
        type: "tool.receipt",
        payload: receipt,
        createdAt: receipt.createdAt,
      });
    },
    onToolStart: async (input, session) => {
      if (!session.botId) return;
      const key = deps.toolUsageKey(input);
      const active = deps.sessions.get(input.threadId);

      const started = {
        persisted: false,
        turnId: active?.activeTurn?.turnId ?? null,
        provider: active?.provider ?? null,
        model: active?.model ?? null,
      };

      deps.toolUsageStarts.set(key, started);
      await deps.runPromise(
        deps.botUsageLedger
          .recordStart({
            reservationId: OttoUsageReservationId.make(key),
            sourceKey: key,
            botId: session.botId,
            threadId: ThreadId.make(input.threadId),
            turnId: started.turnId,
            category: "tool",
            provider: started.provider,
            model: started.model,
            createdAt: nowIso(),
          })
          .pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                started.persisted = true;
              }),
            ),
            Effect.catchCause((cause) =>
              Effect.logWarning("failed to record tool start", {
                toolCallId: input.toolCallId,
                cause,
              }),
            ),
          ),
      );
    },
    onToolFinish: async (input, session) => {
      const key = deps.toolUsageKey(input);
      const started = deps.toolUsageStarts.get(key);
      deps.toolUsageStarts.delete(key);

      if (!session.botId || !started) return;
      await deps.runPromise(
        (started.persisted
          ? deps.botUsageLedger.settle({
              reservationId: OttoUsageReservationId.make(key),
              state: "reported",
              inputTokens: 0,
              outputTokens: 0,
              reasoningTokens: null,
              settledAt: nowIso(),
            })
          : deps.botUsageLedger.recordMeasurement({
              reservationId: OttoUsageReservationId.make(key),
              sourceKey: key,
              botId: session.botId,
              threadId: ThreadId.make(input.threadId),
              turnId: started.turnId,
              category: "tool",
              inputTokens: 0,
              outputTokens: 0,
              reasoningTokens: null,
              provider: started.provider,
              model: started.model,
              createdAt: nowIso(),
            })
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("failed to record tool usage", {
              toolCallId: input.toolCallId,
              cause,
            }),
          ),
        ),
      );
    },
    onProgress: ({ threadId, toolId, toolCallId, summary, authorizationUrl }) => {
      const active = deps.sessions.get(threadId);

      if (!active) return;
      PubSub.publishUnsafe(deps.runtimeEvents, {
        ...deps.baseEvent(ThreadId.make(threadId), active, active.activeTurn?.turnId),
        type: "tool.receipt",
        payload: {
          receiptId: toolCallId,
          toolId,
          phase: "progress",
          threadId: ThreadId.make(threadId),
          ...(active.toolSession.botId ? { botId: active.toolSession.botId } : {}),
          summary,
          ...(authorizationUrl ? { authorizationUrl } : {}),
          fatalToThread: false,
          createdAt: nowIso(),
        },
      });
    },
  });

  return { toolRuntime };
}
