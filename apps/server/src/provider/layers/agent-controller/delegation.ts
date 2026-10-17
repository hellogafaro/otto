import type { OttoRuntimeSeam } from "../../otto-runtime-seam.ts";
import type { AgentControllerLiveOptions } from "./options.ts";
import * as NodeCrypto from "node:crypto";

import {
  CommandId,
  type BotId,
  type ProviderRuntimeEvent,
  ThreadId,
  type OttoDelegationAccessGrant,
  type OttoDelegationRecord,
  type OrchestrationReadModel,
} from "@otto/contracts";

import * as Clock from "effect/Clock";

import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import { type OttoChannelRuntime } from "../../otto-channel-runtime.ts";
import { type OttoBotStateRuntime } from "../../otto-bot-state-runtime.ts";

import {
  createOttoDelegationRuntime,
  type OttoDelegationChildOutcome,
} from "../../otto-delegation-runtime.ts";

import { OTTO_CHILD_WAIT_DEFAULT_TIMEOUT, type PendingWaiters } from "../../pending-waiters.ts";
import {
  createOttoPluginRuntime,
  type OttoPluginRuntimeOptions,
} from "../../otto-catalog-tool-handlers.ts";

import { type OttoToolSession } from "../../otto-tool-runtime.ts";

import { LegacyProviderBridge } from "../../services/legacy-provider-bridge.ts";

import { type ActiveSession } from "./state.ts";
import { delegatedUsageReceipt } from "./provider-access.ts";
import { nowIso } from "./event-identity.ts";

export function createDelegation(deps: {
  readonly runPromise: OttoRuntimeSeam["runPromise"];
  readonly fork: OttoRuntimeSeam["fork"];
  readonly wired: () => {
    readonly channelRuntime?: OttoChannelRuntime;
    readonly pluginRuntime?: ReturnType<typeof createOttoPluginRuntime>;
    readonly pluginRuntimeOptions?: OttoPluginRuntimeOptions;
    readonly botStateRuntime?: OttoBotStateRuntime;
    readonly delegationRuntime?: AgentControllerLiveOptions["delegationRuntime"];
  };
  readonly sessions: Map<string, ActiveSession>;
  readonly childWaiters: PendingWaiters<null, OttoDelegationChildOutcome, never>;
  readonly legacyProviderBridge: LegacyProviderBridge["Service"];
  readonly publish: (event: ProviderRuntimeEvent) => void;
  readonly failureDetail: (cause: unknown) => string;
}) {
  const delegationFor = (input: {
    readonly threadId: ThreadId;
    readonly botId: BotId;
    readonly parentDelegation: OttoDelegationRecord | undefined;
    readonly access: OttoDelegationAccessGrant;
    readonly activeChildDelegations: number;
  }): NonNullable<OttoToolSession["delegation"]> => {
    const delegationRuntime = deps.wired().delegationRuntime;

    const parent = () => {
      const turnId = deps.sessions.get(String(input.threadId))?.activeTurn?.turnId;

      if (!turnId || !delegationRuntime) {
        throw new Error("Bot management requires an active parent turn.");
      }

      return {
        threadId: input.threadId,
        turnId,
        botId: input.botId,
        parentDelegationId: input.parentDelegation?.delegationId ?? null,
        ancestorBotIds: input.parentDelegation?.ancestorBotIds ?? [],
        depth: input.parentDelegation?.depth ?? 0,
        access: input.access,
      };
    };

    const createAgent = delegationRuntime?.create;
    const checkAgent = delegationRuntime?.check;
    const stopAgent = delegationRuntime?.stop;

    return {
      depth: input.parentDelegation?.depth ?? 0,
      activeDelegations: input.activeChildDelegations,
      access: input.access,
      ...(createAgent ? { create: (request) => createAgent(parent(), request) } : {}),
      ...(checkAgent ? { check: (request) => checkAgent(parent(), request) } : {}),
      send: (request) => delegationRuntime!.send(parent(), request),
      ...(stopAgent ? { stop: (request) => stopAgent(parent(), request) } : {}),
    };
  };

  const makeDelegationRuntime = (input: {
    readonly readSnapshot: () => Promise<OrchestrationReadModel>;
    readonly dispatch: OttoPluginRuntimeOptions["dispatch"];
  }) =>
    createOttoDelegationRuntime({
      ...input,
      dispatch: async (command) => {
        await input.dispatch(command);
      },
      awaitChild: (threadId, deadline) =>
        deps.runPromise(
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;

            return yield* deps.childWaiters.wait(
              String(threadId),
              null,
              deadline === null
                ? {
                    timeout: OTTO_CHILD_WAIT_DEFAULT_TIMEOUT,
                    timeoutMessage: `The bot did not report back within ${Duration.toHours(OTTO_CHILD_WAIT_DEFAULT_TIMEOUT)} hours.`,
                    existsMessage: `Delegation waiter already exists for '${threadId}'.`,
                  }
                : {
                    timeout: Duration.millis(Date.parse(deadline) - now),
                    timeoutMessage: "The delegation deadline expired.",
                    existsMessage: `Delegation waiter already exists for '${threadId}'.`,
                  },
            );
          }),
        ),
      interruptChild: (threadId, turnId) =>
        input
          .dispatch({
            type: "thread.turn.interrupt",
            commandId: CommandId.make(`delegation:interrupt:${NodeCrypto.randomUUID()}`),
            threadId,
            ...(turnId ? { turnId } : {}),
            createdAt: nowIso(),
          })
          .then(() => undefined),
      providerDriverKind: (instanceId) =>
        deps.runPromise(
          deps.legacyProviderBridge.getInstanceInfo(instanceId).pipe(
            Effect.map((routing): string | null => routing.driverKind),
            Effect.orElseSucceed(() => null),
          ),
        ),
      recordUsage: async (usage) => {
        const active = deps.sessions.get(String(usage.threadId));

        if (active) deps.publish(delegatedUsageReceipt(usage, active));
      },
      onWatchError: (delegationId, cause) =>
        deps.fork(
          "Otto delegated work could not record its outcome.",
          Effect.fail(deps.failureDetail(cause)),
          { delegationId },
        ),
      onGroupResultSkipped: (delegationId, reason) =>
        deps.fork(
          "Otto could not log a skipped group result.",
          Effect.logInfo("delegated result not posted to the group chat", {
            delegationId,
            reason,
          }),
        ),
    });

  return { delegationFor, makeDelegationRuntime };
}
